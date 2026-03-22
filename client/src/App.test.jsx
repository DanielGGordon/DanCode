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
      <button data-testid="mock-create" onClick={() => onCreated({ slug: 'test' })}>Create</button>
    </div>
  ),
}))

// Mock CommandPalette
vi.mock('./CommandPalette.jsx', () => ({
  default: ({ open, onClose, onSelect }) => open ? (
    <div data-testid="command-palette">
      <button data-testid="mock-palette-close" onClick={onClose}>Close</button>
      <button data-testid="mock-palette-select" onClick={() => onSelect('my-project')}>Select</button>
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
})
