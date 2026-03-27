import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react'
import App from './App.jsx'

// Mock Terminal to avoid xterm.js side effects
vi.mock('./Terminal.jsx', () => ({
  default: ({ terminalId }) => <div data-testid="terminal" data-terminal-id={terminalId || ''}>Terminal</div>,
}))

// Mock TerminalLayout
vi.mock('./TerminalLayout.jsx', () => ({
  default: ({ slug }) => <div data-testid="terminal-layout" data-slug={slug || ''}>TerminalLayout</div>,
}))

// Mock LoginScreen
vi.mock('./LoginScreen.jsx', () => ({
  default: ({ onLogin }) => (
    <div data-testid="login-screen">
      <input data-testid="token-input" onChange={() => {}} />
      <button data-testid="login-submit" onClick={() => onLogin('test-token')}>Login</button>
    </div>
  ),
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
    expect(getByTestId('login-screen')).toBeDefined()
    expect(queryByTestId('welcome-screen')).toBeNull()
  })

  it('shows welcome screen when token exists in localStorage', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)
    await waitFor(() => {
      expect(getByTestId('welcome-screen')).toBeDefined()
    })
    expect(queryByTestId('token-input')).toBeNull()
  })

  it('returns to login screen when stored token is invalid', async () => {
    localStorageMock.setItem('dancode-auth-token', 'stale-token')
    mockFetch(401, { valid: false })
    const { getByTestId, queryByTestId } = render(<App />)
    await waitFor(() => {
      expect(getByTestId('login-screen')).toBeDefined()
    })
    expect(queryByTestId('welcome-screen')).toBeNull()
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('dancode-auth-token')
  })

  it('transitions from login to welcome screen after successful login', async () => {
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    expect(getByTestId('login-screen')).toBeDefined()

    fireEvent.click(getByTestId('login-submit'))

    await waitFor(() => {
      expect(getByTestId('welcome-screen')).toBeDefined()
    })
    expect(queryByTestId('login-screen')).toBeNull()
    expect(localStorageMock.setItem).toHaveBeenCalledWith('dancode-auth-token', 'test-token')
  })

  it('returns to login screen after logout', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('welcome-screen')).toBeDefined()
    })
    expect(getByTestId('logout-button')).toBeDefined()

    fireEvent.click(getByTestId('logout-button'))

    expect(getByTestId('login-screen')).toBeDefined()
    expect(queryByTestId('welcome-screen')).toBeNull()
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
      expect(getByTestId('welcome-screen')).toBeDefined()
    })

    fireEvent.click(getByTestId('new-project-button'))

    expect(getByTestId('new-project-form')).toBeDefined()
    expect(queryByTestId('welcome-screen')).toBeNull()
  })

  it('closes new project form and returns to welcome screen on cancel', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('welcome-screen')).toBeDefined()
    })

    fireEvent.click(getByTestId('new-project-button'))
    expect(getByTestId('new-project-form')).toBeDefined()

    fireEvent.click(getByTestId('mock-cancel'))
    expect(queryByTestId('new-project-form')).toBeNull()
    expect(getByTestId('welcome-screen')).toBeDefined()
  })

  it('closes new project form after project is created and shows terminal layout with slug', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('welcome-screen')).toBeDefined()
    })

    fireEvent.click(getByTestId('new-project-button'))
    expect(getByTestId('new-project-form')).toBeDefined()

    fireEvent.click(getByTestId('mock-create'))
    expect(queryByTestId('new-project-form')).toBeNull()
    expect(getByTestId('terminal-layout')).toBeDefined()
    expect(getByTestId('terminal-layout').dataset.slug).toBe('test')
  })

  it('resets new project form state on logout', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('welcome-screen')).toBeDefined()
    })

    fireEvent.click(getByTestId('new-project-button'))
    expect(getByTestId('new-project-form')).toBeDefined()

    fireEvent.click(getByTestId('logout-button'))
    expect(getByTestId('login-screen')).toBeDefined()

    fireEvent.click(getByTestId('login-submit'))

    await waitFor(() => {
      expect(getByTestId('welcome-screen')).toBeDefined()
    })
    expect(queryByTestId('new-project-form')).toBeNull()
  })

  it('opens command palette on Ctrl+K', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('welcome-screen')).toBeDefined()
    })

    expect(queryByTestId('command-palette')).toBeNull()
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(getByTestId('command-palette')).toBeDefined()
  })

  it('closes command palette on second Ctrl+K', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('welcome-screen')).toBeDefined()
    })

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(getByTestId('command-palette')).toBeDefined()

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(queryByTestId('command-palette')).toBeNull()
  })

  it('closes command palette on Escape', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('welcome-screen')).toBeDefined()
    })

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(getByTestId('command-palette')).toBeDefined()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(queryByTestId('command-palette')).toBeNull()
  })

  it('switches project via command palette and shows terminal layout', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('welcome-screen')).toBeDefined()
    })

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    fireEvent.click(getByTestId('mock-palette-select'))

    expect(getByTestId('terminal-layout')).toBeDefined()
    expect(getByTestId('terminal-layout').dataset.slug).toBe('my-project')
  })

  it('switches between projects via command palette', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('welcome-screen')).toBeDefined()
    })

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    fireEvent.click(getByTestId('mock-palette-select'))
    expect(getByTestId('terminal-layout').dataset.slug).toBe('my-project')
    expect(queryByTestId('command-palette')).toBeNull()

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    fireEvent.click(getByTestId('mock-palette-select-other'))
    expect(getByTestId('terminal-layout').dataset.slug).toBe('other-project')
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

  it('switches project via sidebar click and shows terminal layout', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('welcome-screen')).toBeDefined()
    })

    fireEvent.click(getByTestId('mock-sidebar-select'))

    expect(getByTestId('terminal-layout')).toBeDefined()
    expect(getByTestId('terminal-layout').dataset.slug).toBe('sidebar-project')
  })

  it('switches between projects via sidebar', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('welcome-screen')).toBeDefined()
    })

    fireEvent.click(getByTestId('mock-sidebar-select'))
    expect(getByTestId('terminal-layout').dataset.slug).toBe('sidebar-project')

    fireEvent.click(getByTestId('mock-sidebar-select-other'))
    expect(getByTestId('terminal-layout').dataset.slug).toBe('sidebar-other')
  })

  it('hides new project form when switching projects via sidebar', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId, queryByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('welcome-screen')).toBeDefined()
    })

    fireEvent.click(getByTestId('new-project-button'))
    expect(getByTestId('new-project-form')).toBeDefined()

    fireEvent.click(getByTestId('mock-sidebar-select'))

    expect(queryByTestId('new-project-form')).toBeNull()
    expect(getByTestId('terminal-layout').dataset.slug).toBe('sidebar-project')
  })

  it('toggles sidebar collapsed state', async () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    mockFetch(200, { valid: true })
    const { getByTestId } = render(<App />)

    await waitFor(() => {
      expect(getByTestId('sidebar')).toBeDefined()
    })

    expect(getByTestId('sidebar').dataset.collapsed).toBe('false')

    fireEvent.click(getByTestId('mock-sidebar-toggle'))
    expect(getByTestId('sidebar').dataset.collapsed).toBe('true')

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

    fireEvent.click(getByTestId('mock-sidebar-toggle'))
    expect(localStorageMock.setItem).toHaveBeenCalledWith('dancode-sidebar-collapsed', 'true')

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
      expect(getByTestId('welcome-screen')).toBeDefined()
    })

    expect(queryByTestId('header-project-name')).toBeNull()

    fireEvent.click(getByTestId('mock-sidebar-select'))

    await waitFor(() => {
      expect(getByTestId('header-project-name')).toBeDefined()
    })
    expect(getByTestId('header-project-name').textContent).toBe('My Project')
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
      expect(getByTestId('welcome-screen')).toBeDefined()
    })

    fireEvent.click(getByTestId('mock-sidebar-select'))
    await waitFor(() => {
      expect(getByTestId('header-project-name')).toBeDefined()
    })

    fireEvent.click(getByTestId('header-project-name'))
    fireEvent.click(getByTestId('dropdown-item-other-proj'))

    expect(queryByTestId('header-dropdown')).toBeNull()
    expect(getByTestId('terminal-layout').dataset.slug).toBe('other-proj')

    fetchSpy.mockRestore()
  })

  it('all three switching mechanisms coexist and work independently', async () => {
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
      expect(getByTestId('welcome-screen')).toBeDefined()
    })

    // 1. Switch via sidebar
    fireEvent.click(getByTestId('mock-sidebar-select'))
    expect(getByTestId('terminal-layout').dataset.slug).toBe('sidebar-project')

    // 2. Switch via dropdown
    await waitFor(() => {
      expect(getByTestId('header-project-name')).toBeDefined()
    })
    fireEvent.click(getByTestId('header-project-name'))
    fireEvent.click(getByTestId('dropdown-item-other-proj'))
    expect(getByTestId('terminal-layout').dataset.slug).toBe('other-proj')

    // 3. Switch via command palette
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    fireEvent.click(getByTestId('mock-palette-select'))
    expect(getByTestId('terminal-layout').dataset.slug).toBe('my-project')

    // 4. Switch back via sidebar
    fireEvent.click(getByTestId('mock-sidebar-select-other'))
    expect(getByTestId('terminal-layout').dataset.slug).toBe('sidebar-other')

    fetchSpy.mockRestore()
  })
})
