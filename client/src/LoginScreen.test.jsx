import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react'
import LoginScreen from './LoginScreen.jsx'

beforeEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
})

// Mock fetch to first return setupComplete status, then handle subsequent calls
function mockSetupComplete(subsequentStatus, subsequentBody = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    if (url === '/api/auth/setup/status') {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ setupComplete: true }),
      })
    }
    return Promise.resolve({
      ok: subsequentStatus >= 200 && subsequentStatus < 300,
      status: subsequentStatus,
      json: () => Promise.resolve(subsequentBody),
    })
  })
}

describe('LoginScreen', () => {
  it('renders login form with username, password, and TOTP inputs', async () => {
    mockSetupComplete(200)
    const { getByTestId } = render(<LoginScreen onLogin={() => {}} />)

    await waitFor(() => {
      expect(getByTestId('login-username')).toBeDefined()
    })
    expect(getByTestId('login-password')).toBeDefined()
    expect(getByTestId('login-totp')).toBeDefined()
    expect(getByTestId('login-submit')).toBeDefined()
  })

  it('calls onLogin with token on successful login', async () => {
    const fetchSpy = mockSetupComplete(200, { token: 'session-token-123' })
    const onLogin = vi.fn()
    const { getByTestId } = render(<LoginScreen onLogin={onLogin} />)

    await waitFor(() => {
      expect(getByTestId('login-username')).toBeDefined()
    })

    fireEvent.change(getByTestId('login-username'), { target: { value: 'admin' } })
    fireEvent.change(getByTestId('login-password'), { target: { value: 'password123' } })
    fireEvent.change(getByTestId('login-totp'), { target: { value: '123456' } })
    fireEvent.click(getByTestId('login-submit'))

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith('session-token-123')
    })

    // Verify login API was called
    const loginCall = fetchSpy.mock.calls.find(([url]) => url === '/api/auth/login')
    expect(loginCall).toBeDefined()
    const body = JSON.parse(loginCall[1].body)
    expect(body.username).toBe('admin')
    expect(body.totpCode).toBe('123456')
  })

  it('shows error when submitting with empty fields', async () => {
    mockSetupComplete(200)
    const onLogin = vi.fn()
    const { getByTestId } = render(<LoginScreen onLogin={onLogin} />)

    await waitFor(() => {
      expect(getByTestId('login-submit')).toBeDefined()
    })

    fireEvent.click(getByTestId('login-submit'))

    await waitFor(() => {
      expect(getByTestId('login-error')).toBeDefined()
    })
    expect(onLogin).not.toHaveBeenCalled()
  })

  it('does not show error initially', async () => {
    mockSetupComplete(200)
    const { queryByTestId } = render(<LoginScreen onLogin={() => {}} />)

    await waitFor(() => {
      expect(queryByTestId('login-submit')).not.toBeNull()
    })
    expect(queryByTestId('login-error')).toBeNull()
  })

  it('shows error on invalid credentials', async () => {
    mockSetupComplete(401, { error: 'Invalid credentials' })
    const onLogin = vi.fn()
    const { getByTestId } = render(<LoginScreen onLogin={onLogin} />)

    await waitFor(() => {
      expect(getByTestId('login-username')).toBeDefined()
    })

    fireEvent.change(getByTestId('login-username'), { target: { value: 'admin' } })
    fireEvent.change(getByTestId('login-password'), { target: { value: 'wrong' } })
    fireEvent.change(getByTestId('login-totp'), { target: { value: '000000' } })
    fireEvent.click(getByTestId('login-submit'))

    await waitFor(() => {
      expect(getByTestId('login-error').textContent).toBe('Invalid credentials')
    })
    expect(onLogin).not.toHaveBeenCalled()
  })

  it('shows error when server is unreachable on login', async () => {
    let first = true
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (url === '/api/auth/setup/status') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ setupComplete: true }),
        })
      }
      return Promise.reject(new Error('Network error'))
    })
    const onLogin = vi.fn()
    const { getByTestId } = render(<LoginScreen onLogin={onLogin} />)

    await waitFor(() => {
      expect(getByTestId('login-username')).toBeDefined()
    })

    fireEvent.change(getByTestId('login-username'), { target: { value: 'admin' } })
    fireEvent.change(getByTestId('login-password'), { target: { value: 'pass' } })
    fireEvent.change(getByTestId('login-totp'), { target: { value: '123456' } })
    fireEvent.click(getByTestId('login-submit'))

    await waitFor(() => {
      expect(getByTestId('login-error').textContent).toBe('Unable to reach server')
    })
    expect(onLogin).not.toHaveBeenCalled()
  })

  it('shows loading state initially', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {})) // never resolves
    const { container } = render(<LoginScreen onLogin={() => {}} />)
    expect(container.textContent).toContain('Loading...')
  })
})
