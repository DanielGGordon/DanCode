import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react'
import App from './App.jsx'

// Mock Terminal to avoid xterm.js side effects
vi.mock('./Terminal.jsx', () => ({
  default: () => <div data-testid="terminal">Terminal</div>,
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
})
