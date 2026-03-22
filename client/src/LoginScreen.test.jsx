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

function mockFetch(status, body = {}) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

describe('LoginScreen', () => {
  it('renders a token input and submit button', () => {
    const { getByTestId } = render(<LoginScreen onLogin={() => {}} />)
    expect(getByTestId('token-input')).toBeDefined()
    expect(getByTestId('login-submit')).toBeDefined()
  })

  it('calls onLogin with trimmed token on successful validation', async () => {
    const fetchSpy = mockFetch(200, { valid: true })
    const onLogin = vi.fn()
    const { getByTestId } = render(<LoginScreen onLogin={onLogin} />)

    fireEvent.change(getByTestId('token-input'), { target: { value: '  my-token  ' } })
    fireEvent.click(getByTestId('login-submit'))

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith('my-token')
    })

    expect(fetchSpy).toHaveBeenCalledWith('/api/auth/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'my-token' }),
    })
  })

  it('shows error when submitting empty token', () => {
    const onLogin = vi.fn()
    const { getByTestId } = render(<LoginScreen onLogin={onLogin} />)

    fireEvent.click(getByTestId('login-submit'))

    expect(getByTestId('login-error')).toBeDefined()
    expect(onLogin).not.toHaveBeenCalled()
  })

  it('does not show error initially', () => {
    const { queryByTestId } = render(<LoginScreen onLogin={() => {}} />)
    expect(queryByTestId('login-error')).toBeNull()
  })

  it('clears error on valid submission', async () => {
    mockFetch(200, { valid: true })
    const onLogin = vi.fn()
    const { getByTestId, queryByTestId } = render(<LoginScreen onLogin={onLogin} />)

    // Trigger error first
    fireEvent.click(getByTestId('login-submit'))
    expect(getByTestId('login-error')).toBeDefined()

    // Now enter valid token and submit
    fireEvent.change(getByTestId('token-input'), { target: { value: 'valid-token' } })
    fireEvent.click(getByTestId('login-submit'))

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith('valid-token')
    })
    expect(queryByTestId('login-error')).toBeNull()
  })

  it('shows error on invalid token (401)', async () => {
    mockFetch(401, { error: 'Invalid token' })
    const onLogin = vi.fn()
    const { getByTestId } = render(<LoginScreen onLogin={onLogin} />)

    fireEvent.change(getByTestId('token-input'), { target: { value: 'bad-token' } })
    fireEvent.click(getByTestId('login-submit'))

    await waitFor(() => {
      expect(getByTestId('login-error').textContent).toBe('Invalid token')
    })
    expect(onLogin).not.toHaveBeenCalled()
  })

  it('shows error when server is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))
    const onLogin = vi.fn()
    const { getByTestId } = render(<LoginScreen onLogin={onLogin} />)

    fireEvent.change(getByTestId('token-input'), { target: { value: 'some-token' } })
    fireEvent.click(getByTestId('login-submit'))

    await waitFor(() => {
      expect(getByTestId('login-error').textContent).toBe('Unable to reach server')
    })
    expect(onLogin).not.toHaveBeenCalled()
  })
})
