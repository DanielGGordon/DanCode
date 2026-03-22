import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
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

  it('shows terminal when token exists in localStorage', () => {
    localStorageMock.setItem('dancode-auth-token', 'test-token')
    const { getByTestId, queryByTestId } = render(<App />)
    expect(getByTestId('terminal')).toBeDefined()
    expect(queryByTestId('token-input')).toBeNull()
  })

  it('transitions from login to terminal after successful login', () => {
    const { getByTestId, queryByTestId } = render(<App />)

    // Should show login
    expect(getByTestId('token-input')).toBeDefined()

    // Enter token and submit
    fireEvent.change(getByTestId('token-input'), { target: { value: 'my-token' } })
    fireEvent.click(getByTestId('login-submit'))

    // Should now show terminal
    expect(getByTestId('terminal')).toBeDefined()
    expect(queryByTestId('token-input')).toBeNull()

    // Token should be stored in localStorage
    expect(localStorageMock.setItem).toHaveBeenCalledWith('dancode-auth-token', 'my-token')
  })
})
