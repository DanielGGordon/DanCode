import { useState } from 'react'

export default function LoginScreen({ onLogin }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    const trimmed = token.trim()
    if (!trimmed) {
      setError('Please enter a token')
      return
    }
    setError('')
    onLogin(trimmed)
  }

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-base03">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 p-8 rounded-lg bg-base02 border border-base01/30 w-full max-w-sm"
      >
        <h1 className="text-xl font-semibold text-base1 text-center">DanCode</h1>
        <p className="text-sm text-base0 text-center">Enter your auth token to continue</p>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Auth token"
          data-testid="token-input"
          className="px-3 py-2 rounded bg-base03 border border-base01/50 text-base0 placeholder-base01 focus:outline-none focus:border-blue"
        />
        {error && (
          <p data-testid="login-error" className="text-sm text-red text-center">{error}</p>
        )}
        <button
          type="submit"
          data-testid="login-submit"
          className="px-4 py-2 rounded bg-blue text-base3 font-medium hover:bg-blue/80 transition-colors"
        >
          Sign In
        </button>
      </form>
    </div>
  )
}
