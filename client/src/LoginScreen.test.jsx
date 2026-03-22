import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import LoginScreen from './LoginScreen.jsx'

beforeEach(() => {
  cleanup()
})

describe('LoginScreen', () => {
  it('renders a token input and submit button', () => {
    const { getByTestId } = render(<LoginScreen onLogin={() => {}} />)
    expect(getByTestId('token-input')).toBeDefined()
    expect(getByTestId('login-submit')).toBeDefined()
  })

  it('calls onLogin with trimmed token on submit', () => {
    const onLogin = vi.fn()
    const { getByTestId } = render(<LoginScreen onLogin={onLogin} />)

    fireEvent.change(getByTestId('token-input'), { target: { value: '  my-token  ' } })
    fireEvent.click(getByTestId('login-submit'))

    expect(onLogin).toHaveBeenCalledWith('my-token')
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

  it('clears error on valid submission', () => {
    const onLogin = vi.fn()
    const { getByTestId, queryByTestId } = render(<LoginScreen onLogin={onLogin} />)

    // Trigger error first
    fireEvent.click(getByTestId('login-submit'))
    expect(getByTestId('login-error')).toBeDefined()

    // Now enter valid token and submit
    fireEvent.change(getByTestId('token-input'), { target: { value: 'valid-token' } })
    fireEvent.click(getByTestId('login-submit'))

    expect(queryByTestId('login-error')).toBeNull()
    expect(onLogin).toHaveBeenCalledWith('valid-token')
  })
})
