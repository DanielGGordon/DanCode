import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react'
import App from './App.jsx'

// Mock Terminal to avoid xterm.js side effects
vi.mock('./Terminal.jsx', () => ({
  default: ({ slug }) => <div data-testid="terminal" data-slug={slug || ''}>Terminal</div>,
}))

// Mock PaneLayout
vi.mock('./PaneLayout.jsx', () => ({
  default: ({ slug }) => <div data-testid="pane-layout" data-slug={slug || ''}>PaneLayout</div>,
}))

// Mock NewProjectForm
vi.mock('./NewProjectForm.jsx', () => ({
  default: ({ onCreated, onCancel }) => (
    <div data-testid="new-project-form">
      <button data-testid="mock-cancel" onClick={onCancel}>Cancel</button>
      <button data-testid="mock-create" onClick={() => onCreated({ slug: 'test', name: 'Test Project' })}>Create</button>
    </div>
  ),
}))

// Mock Sidebar
vi.mock('./Sidebar.jsx', () => ({
  default: ({ projects, currentSlug, onSelect, collapsed, onToggle }) => (
    <div data-testid="sidebar" data-current-slug={currentSlug || ''} data-project-count={projects?.length || 0} data-collapsed={collapsed ? 'true' : 'false'}>
      Sidebar
      <button data-testid="mock-sidebar-select" onClick={() => onSelect?.('sidebar-project')}>Select</button>
      <button data-testid="mock-sidebar-select-other" onClick={() => onSelect?.('sidebar-other')}>Select Other</button>
      <button data-testid="mock-sidebar-toggle" onClick={() => onToggle?.()}>Toggle</button>
    </div>
  ),
}))

// Mock CommandPalette
vi.mock('./CommandPalette.jsx', () => ({
  default: ({ open, onClose, onSelect }) => open ? (
    <div data-testid="command-palette">
      <button data-testid="mock-palette-close" onClick={onClose}>Close</button>
      <button data-testid="mock-palette-select" onClick={() => onSelect('my-project')}>Select</button>
      <button data-testid="mock-palette-select-other" onClick={() => onSelect('other-project')}>Select Other</button>
    </div>
  ) : null,
}))

// Mock localStorage
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => { store[key] = String(value) }),
    removeItem: vi.fn((key) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

function mockFetch(status, body = {}) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

beforeEach(() => {
  localStorageMock.clear()
  vi.clearAllMocks()
  cleanup()
})

describe('App', () => {
  it('is defined as a function component', () => {
    expect(typeof App).toBe('function')
  })

  it('shows login screen when no token in localStorage', () => {
    const { getByTestId, queryByTestId } = render(<App />)
    expect(getByTestId('token-input')).toBeDefined()
    expect(getByTestId('login-submit')).toBeDefined()
    expect(queryByTestId('terminal')).toBeNull()
  })

  it('shows terminal when token exists in localStorage', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)
    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })
    expect(queryByTestId('token-input')).toBeNull()
  })

  it('returns to login screen when stored token is invalid', async () => {
    localStorageMock.setItem('dancode-auth-token', 'stale-token')
    mockFetch(401, { valid: false })
    const { getByTestId, queryByTestId } = render(<App />)
    await waitFor(() => {
      expect(getByTestId('token-input')).toBeDefined()
    })
    expect(queryByTestId('terminal')).toBeNull()
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('dancode-auth-token')
  })

  it('transitions from login to terminal after successful login', async () => {
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    // Should show login
    expect(getByTestId('token-input')).toBeDefined()

    // Enter token and submit
    fireEvent.change(getByTestId('token-input'), { target: { value: 'my-token' } })
    fireEvent.click(getByTestId('login-submit'))

    // Should now show terminal after async validation
    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })
    expect(queryByTestId('token-input')).toBeNull()

    // Token should be stored in localStorage
    expect(localStorageMock.setItem).toHaveBeenCalledWith('dancode-auth-token', 'my-token')
  })

  it('returns to login screen after logout', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    // Should show terminal with logout button after validation
    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })
    expect(getByTestId('logout-button')).toBeDefined()

    // Click logout
    fireEvent.click(getByTestId('logout-button'))

    // Should return to login screen
    expect(getByTestId('token-input')).toBeDefined()
    expect(queryByTestId('terminal')).toBeNull()

    // Token should be removed from localStorage
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('dancode-auth-token')
  })

  it('shows New Project button when authenticated', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId } = render(<App />)
    await waitFor(() => {
      expect(getByTestId('new-project-button')).toBeDefined()
    })
  })

  it('opens new project form when New Project button is clicked', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    fireEvent.click(getByTestId('new-project-button'))

    expect(getByTestId('new-project-form')).toBeDefined()
    expect(queryByTestId('terminal')).toBeNull()
  })

  it('closes new project form and returns to terminal on cancel', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    fireEvent.click(getByTestId('new-project-button'))
    expect(getByTestId('new-project-form')).toBeDefined()

    fireEvent.click(getByTestId('mock-cancel'))
    expect(queryByTestId('new-project-form')).toBeNull()
    expect(getByTestId('terminal')).toBeDefined()
  })

  it('closes new project form after project is created and shows pane layout with slug', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    fireEvent.click(getByTestId('new-project-button'))
    expect(getByTestId('new-project-form')).toBeDefined()

    fireEvent.click(getByTestId('mock-create'))
    expect(queryByTestId('new-project-form')).toBeNull()
    expect(getByTestId('pane-layout')).toBeDefined()
    expect(getByTestId('pane-layout').dataset.slug).toBe('test')
  })

  it('resets new project form state on logout', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    // Open the new project form
    fireEvent.click(getByTestId('new-project-button'))
    expect(getByTestId('new-project-form')).toBeDefined()

    // Logout while form is open
    fireEvent.click(getByTestId('logout-button'))
    expect(getByTestId('token-input')).toBeDefined()

    // Log back in — should see terminal, not the form
    fireEvent.change(getByTestId('token-input'), { target: { value: 'new-token' } })
    fireEvent.click(getByTestId('login-submit'))

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })
    expect(queryByTestId('new-project-form')).toBeNull()
  })

  it('opens command palette on Ctrl+K', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    expect(queryByTestId('command-palette')).toBeNull()

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

    expect(getByTestId('command-palette')).toBeDefined()
  })

  it('closes command palette on second Ctrl+K', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(getByTestId('command-palette')).toBeDefined()

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(queryByTestId('command-palette')).toBeNull()
  })

  it('closes command palette on Escape', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(getByTestId('command-palette')).toBeDefined()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(queryByTestId('command-palette')).toBeNull()
  })

  it('switches project via command palette and shows pane layout', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    // Open palette and select a project
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.click(getByTestId('mock-palette-select'))

    expect(getByTestId('pane-layout')).toBeDefined()
    expect(getByTestId('pane-layout').dataset.slug).toBe('my-project')
  })

  it('switches between projects via command palette', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    // Select first project
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.click(getByTestId('mock-palette-select'))
    expect(getByTestId('pane-layout').dataset.slug).toBe('my-project')

    // Palette should be closed after selection
    expect(queryByTestId('command-palette')).toBeNull()

    // Open palette again and select a different project
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.click(getByTestId('mock-palette-select-other'))

    // Should show pane layout for the new project
    expect(getByTestId('pane-layout').dataset.slug).toBe('other-project')
    expect(queryByTestId('command-palette')).toBeNull()
  })

  it('renders sidebar when authenticated', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId } = render(<App />)
    await waitFor(() => {
      expect(getByTestId('sidebar')).toBeDefined()
    })
  })

  it('switches project via sidebar click and shows pane layout', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    fireEvent.click(getByTestId('mock-sidebar-select'))

    expect(getByTestId('pane-layout')).toBeDefined()
    expect(getByTestId('pane-layout').dataset.slug).toBe('sidebar-project')
  })

  it('switches between projects via sidebar', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    fireEvent.click(getByTestId('mock-sidebar-select'))
    expect(getByTestId('pane-layout').dataset.slug).toBe('sidebar-project')

    fireEvent.click(getByTestId('mock-sidebar-select-other'))
    expect(getByTestId('pane-layout').dataset.slug).toBe('sidebar-other')
  })

  it('hides new project form when switching projects via sidebar', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    fireEvent.click(getByTestId('new-project-button'))
    expect(getByTestId('new-project-form')).toBeDefined()

    fireEvent.click(getByTestId('mock-sidebar-select'))

    expect(queryByTestId('new-project-form')).toBeNull()
    expect(getByTestId('pane-layout').dataset.slug).toBe('sidebar-project')
  })

  it('main content area uses flex-1 and min-w-0 so terminals fill available width', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    const main = getByTestId('terminal').closest('main')
    expect(main.className).toContain('flex-1')
    expect(main.className).toContain('min-w-0')
  })

  it('toggles sidebar collapsed state', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('sidebar')).toBeDefined()
    })

    // Initially expanded
    expect(getByTestId('sidebar').dataset.collapsed).toBe('false')

    // Click toggle to collapse
    fireEvent.click(getByTestId('mock-sidebar-toggle'))
    expect(getByTestId('sidebar').dataset.collapsed).toBe('true')

    // Click toggle again to expand
    fireEvent.click(getByTestId('mock-sidebar-toggle'))
    expect(getByTestId('sidebar').dataset.collapsed).toBe('false')
  })

  it('persists sidebar collapsed state to localStorage on toggle', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('sidebar')).toBeDefined()
    })

    // Collapse
    fireEvent.click(getByTestId('mock-sidebar-toggle'))
    expect(localStorageMock.setItem).toHaveBeenCalledWith('dancode-sidebar-collapsed', 'true')

    // Expand
    fireEvent.click(getByTestId('mock-sidebar-toggle'))
    expect(localStorageMock.setItem).toHaveBeenCalledWith('dancode-sidebar-collapsed', 'false')
  })

  it('restores sidebar collapsed state from localStorage on mount', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    localStorageMock.setItem('dancode-sidebar-collapsed', 'true')
    mockFetch(200, { valid: true })
    const { getByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('sidebar')).toBeDefined()
    })

    expect(getByTestId('sidebar').dataset.collapsed).toBe('true')
  })

  it('defaults sidebar to expanded when no localStorage value', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('sidebar')).toBeDefined()
    })

    expect(getByTestId('sidebar').dataset.collapsed).toBe('false')
  })

  it('hides new project form when switching projects via palette', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    // Open new project form
    fireEvent.click(getByTestId('new-project-button'))
    expect(getByTestId('new-project-form')).toBeDefined()

    // Open palette and select a project while form is open
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.click(getByTestId('mock-palette-select'))

    // Form should be hidden, pane layout should show
    expect(queryByTestId('new-project-form')).toBeNull()
    expect(getByTestId('pane-layout').dataset.slug).toBe('my-project')
  })

  it('shows current project name in header bar when a project is selected', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/projects') {
        return { ok: true, status: 200, json: () => Promise.resolve([{ slug: 'sidebar-project', name: 'My Project', path: '/tmp' }]) }
      }
      return { ok: true, status: 200, json: () => Promise.resolve({}) }
    })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    // No project name shown initially
    expect(queryByTestId('header-project-name')).toBeNull()

    // Select a project via sidebar
    fireEvent.click(getByTestId('mock-sidebar-select'))

    await waitFor(() => {
      expect(getByTestId('header-project-name')).toBeDefined()
    })
    expect(getByTestId('header-project-name').textContent).toBe('My Project')
    fetchSpy.mockRestore()
  })

  it('does not show project name in header when no project is selected', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    expect(queryByTestId('header-project-name')).toBeNull()
  })

  it('opens dropdown when clicking header project name', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/projects') {
        return { ok: true, status: 200, json: () => Promise.resolve([
          { slug: 'sidebar-project', name: 'My Project', path: '/tmp' },
          { slug: 'other-proj', name: 'Other Project', path: '/tmp2' },
        ]) }
      }
      return { ok: true, status: 200, json: () => Promise.resolve({}) }
    })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    // Select a project so header name appears
    fireEvent.click(getByTestId('mock-sidebar-select'))
    await waitFor(() => {
      expect(getByTestId('header-project-name')).toBeDefined()
    })

    // Dropdown not visible yet
    expect(queryByTestId('header-dropdown')).toBeNull()

    // Click project name to open dropdown
    fireEvent.click(getByTestId('header-project-name'))
    expect(getByTestId('header-dropdown')).toBeDefined()

    fetchSpy.mockRestore()
  })

  it('dropdown lists all projects', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/projects') {
        return { ok: true, status: 200, json: () => Promise.resolve([
          { slug: 'sidebar-project', name: 'My Project', path: '/tmp' },
          { slug: 'other-proj', name: 'Other Project', path: '/tmp2' },
        ]) }
      }
      return { ok: true, status: 200, json: () => Promise.resolve({}) }
    })
    const { getByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    fireEvent.click(getByTestId('mock-sidebar-select'))
    await waitFor(() => {
      expect(getByTestId('header-project-name')).toBeDefined()
    })

    fireEvent.click(getByTestId('header-project-name'))

    // Both projects listed
    expect(getByTestId('dropdown-item-sidebar-project')).toBeDefined()
    expect(getByTestId('dropdown-item-other-proj')).toBeDefined()

    fetchSpy.mockRestore()
  })

  it('switches project when selecting from dropdown', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/projects') {
        return { ok: true, status: 200, json: () => Promise.resolve([
          { slug: 'sidebar-project', name: 'My Project', path: '/tmp' },
          { slug: 'other-proj', name: 'Other Project', path: '/tmp2' },
        ]) }
      }
      return { ok: true, status: 200, json: () => Promise.resolve({}) }
    })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    fireEvent.click(getByTestId('mock-sidebar-select'))
    await waitFor(() => {
      expect(getByTestId('header-project-name')).toBeDefined()
    })

    fireEvent.click(getByTestId('header-project-name'))
    fireEvent.click(getByTestId('dropdown-item-other-proj'))

    // Dropdown closes and project switches
    expect(queryByTestId('header-dropdown')).toBeNull()
    expect(getByTestId('pane-layout').dataset.slug).toBe('other-proj')

    fetchSpy.mockRestore()
  })

  it('closes dropdown on second click of project name', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/projects') {
        return { ok: true, status: 200, json: () => Promise.resolve([
          { slug: 'sidebar-project', name: 'My Project', path: '/tmp' },
        ]) }
      }
      return { ok: true, status: 200, json: () => Promise.resolve({}) }
    })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    fireEvent.click(getByTestId('mock-sidebar-select'))
    await waitFor(() => {
      expect(getByTestId('header-project-name')).toBeDefined()
    })

    // Open
    fireEvent.click(getByTestId('header-project-name'))
    expect(getByTestId('header-dropdown')).toBeDefined()

    // Close via toggle
    fireEvent.click(getByTestId('header-project-name'))
    expect(queryByTestId('header-dropdown')).toBeNull()

    fetchSpy.mockRestore()
  })

  it('closes dropdown when clicking outside', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/projects') {
        return { ok: true, status: 200, json: () => Promise.resolve([
          { slug: 'sidebar-project', name: 'My Project', path: '/tmp' },
        ]) }
      }
      return { ok: true, status: 200, json: () => Promise.resolve({}) }
    })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    fireEvent.click(getByTestId('mock-sidebar-select'))
    await waitFor(() => {
      expect(getByTestId('header-project-name')).toBeDefined()
    })

    // Open dropdown
    fireEvent.click(getByTestId('header-project-name'))
    expect(getByTestId('header-dropdown')).toBeDefined()

    // Click outside the dropdown
    fireEvent.mouseDown(document.body)
    expect(queryByTestId('header-dropdown')).toBeNull()

    fetchSpy.mockRestore()
  })

  it('sidebar and command palette coexist — both switch projects in the same session', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    // Both sidebar and command palette are available
    expect(getByTestId('sidebar')).toBeDefined()
    expect(queryByTestId('command-palette')).toBeNull() // palette closed by default

    // Select a project via sidebar
    fireEvent.click(getByTestId('mock-sidebar-select'))
    expect(getByTestId('pane-layout').dataset.slug).toBe('sidebar-project')

    // Sidebar still visible after selection
    expect(getByTestId('sidebar')).toBeDefined()

    // Open palette and switch to a different project
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(getByTestId('command-palette')).toBeDefined()
    expect(getByTestId('sidebar')).toBeDefined() // sidebar still rendered under palette
    fireEvent.click(getByTestId('mock-palette-select'))

    // Palette closes, project switched
    expect(queryByTestId('command-palette')).toBeNull()
    expect(getByTestId('pane-layout').dataset.slug).toBe('my-project')

    // Switch back via sidebar
    fireEvent.click(getByTestId('mock-sidebar-select-other'))
    expect(getByTestId('pane-layout').dataset.slug).toBe('sidebar-other')

    // Palette still works after sidebar usage
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(getByTestId('command-palette')).toBeDefined()
    fireEvent.click(getByTestId('mock-palette-select-other'))
    expect(getByTestId('pane-layout').dataset.slug).toBe('other-project')
    expect(queryByTestId('command-palette')).toBeNull()
  })

  it('all three switching mechanisms (palette, sidebar, dropdown) coexist and work independently', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/projects') {
        return { ok: true, status: 200, json: () => Promise.resolve([
          { slug: 'sidebar-project', name: 'My Project', path: '/tmp' },
          { slug: 'other-proj', name: 'Other Project', path: '/tmp2' },
          { slug: 'sidebar-other', name: 'Sidebar Other', path: '/tmp3' },
        ]) }
      }
      return { ok: true, status: 200, json: () => Promise.resolve({}) }
    })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('terminal')).toBeDefined()
    })

    // All three mechanisms are available from the start
    expect(getByTestId('sidebar')).toBeDefined()
    expect(queryByTestId('command-palette')).toBeNull() // palette closed by default
    expect(queryByTestId('header-dropdown')).toBeNull() // dropdown closed by default

    // 1. Switch via sidebar
    fireEvent.click(getByTestId('mock-sidebar-select'))
    expect(getByTestId('pane-layout').dataset.slug).toBe('sidebar-project')
    expect(getByTestId('sidebar')).toBeDefined() // sidebar still visible

    // 2. Switch via dropdown
    await waitFor(() => {
      expect(getByTestId('header-project-name')).toBeDefined()
    })
    fireEvent.click(getByTestId('header-project-name'))
    expect(getByTestId('header-dropdown')).toBeDefined()
    fireEvent.click(getByTestId('dropdown-item-other-proj'))
    expect(queryByTestId('header-dropdown')).toBeNull() // dropdown closes
    expect(getByTestId('pane-layout').dataset.slug).toBe('other-proj')
    expect(getByTestId('sidebar')).toBeDefined() // sidebar still visible

    // 3. Switch via command palette
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(getByTestId('command-palette')).toBeDefined()
    expect(getByTestId('sidebar')).toBeDefined() // sidebar still visible under palette
    fireEvent.click(getByTestId('mock-palette-select'))
    expect(queryByTestId('command-palette')).toBeNull() // palette closes
    expect(getByTestId('pane-layout').dataset.slug).toBe('my-project')

    // 4. Switch back via sidebar — still works after using other mechanisms
    fireEvent.click(getByTestId('mock-sidebar-select-other'))
    expect(getByTestId('pane-layout').dataset.slug).toBe('sidebar-other')

    // 5. Switch via dropdown again — still works after palette usage
    await waitFor(() => {
      expect(getByTestId('header-project-name')).toBeDefined()
    })
    fireEvent.click(getByTestId('header-project-name'))
    expect(getByTestId('header-dropdown')).toBeDefined()
    fireEvent.click(getByTestId('dropdown-item-sidebar-project'))
    expect(queryByTestId('header-dropdown')).toBeNull()
    expect(getByTestId('pane-layout').dataset.slug).toBe('sidebar-project')

    // 6. Dropdown closes when palette opens (no stale UI overlap)
    fireEvent.click(getByTestId('header-project-name'))
    expect(getByTestId('header-dropdown')).toBeDefined()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(getByTestId('command-palette')).toBeDefined()
    // Select from palette — should close dropdown too
    fireEvent.click(getByTestId('mock-palette-select-other'))
    expect(queryByTestId('command-palette')).toBeNull()
    expect(queryByTestId('header-dropdown')).toBeNull() // palette handler closes dropdown
    expect(getByTestId('pane-layout').dataset.slug).toBe('other-project')

    fetchSpy.mockRestore()
  })
})
