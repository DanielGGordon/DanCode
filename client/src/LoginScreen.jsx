import { useState, useEffect } from 'react'

export default function LoginScreen({ onLogin }) {
  const [setupComplete, setSetupComplete] = useState(null) // null = loading
  const [phase, setPhase] = useState('loading') // loading | setup | totp-enroll | login

  // Setup form state
  const [setupUsername, setSetupUsername] = useState('')
  const [setupPassword, setSetupPassword] = useState('')
  const [setupConfirm, setSetupConfirm] = useState('')

  // TOTP enrollment state (shown after setup)
  const [qrCodeUrl, setQrCodeUrl] = useState('')
  const [totpSecret, setTotpSecret] = useState('')
  const [enrollCode, setEnrollCode] = useState('')

  // Login form state
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')

  const [error, setError] = useState('')

  useEffect(() => {
    async function checkSetup() {
      try {
        const res = await fetch('/api/auth/setup/status')
        const data = await res.json()
        setSetupComplete(data.setupComplete)
        setPhase(data.setupComplete ? 'login' : 'setup')
      } catch {
        setError('Unable to reach server')
        setPhase('login')
      }
    }
    checkSetup()
  }, [])

  async function handleSetup(e) {
    e.preventDefault()
    setError('')

    if (!setupUsername.trim()) {
      setError('Username is required')
      return
    }
    if (setupPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (setupPassword !== setupConfirm) {
      setError('Passwords do not match')
      return
    }

    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: setupUsername.trim(), password: setupPassword }),
      })
      if (res.ok) {
        const data = await res.json()
        setQrCodeUrl(data.qrCodeDataUrl)
        setTotpSecret(data.totpSecret)
        setPhase('totp-enroll')
      } else {
        const data = await res.json()
        setError(data.error || 'Setup failed')
      }
    } catch {
      setError('Unable to reach server')
    }
  }

  async function handleEnrollVerify(e) {
    e.preventDefault()
    setError('')

    if (!enrollCode.trim() || enrollCode.trim().length !== 6) {
      setError('Enter the 6-digit code from your authenticator app')
      return
    }

    // Verify the TOTP code works by logging in
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: setupUsername.trim(),
          password: setupPassword,
          totpCode: enrollCode.trim(),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        onLogin(data.token)
      } else {
        setError('Code did not match. Make sure your authenticator app is synced and try again.')
      }
    } catch {
      setError('Unable to reach server')
    }
  }

  async function handleLogin(e) {
    e.preventDefault()
    setError('')

    if (!username.trim() || !password || !totpCode.trim()) {
      setError('All fields are required')
      return
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password,
          totpCode: totpCode.trim(),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        onLogin(data.token)
      } else {
        setError('Invalid credentials')
      }
    } catch {
      setError('Unable to reach server')
    }
  }

  if (phase === 'loading') {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-base03">
        <p className="text-base01">Loading...</p>
      </div>
    )
  }

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-base03">
      {phase === 'setup' && (
        <form
          onSubmit={handleSetup}
          className="flex flex-col gap-4 p-8 rounded-lg bg-base02 border border-base01/30 shadow-lg w-full max-w-sm"
        >
          <h1 className="text-xl font-semibold text-base1 text-center">DanCode</h1>
          <p className="text-sm text-base0 text-center">Create your account</p>
          <input
            type="text"
            value={setupUsername}
            onChange={(e) => setSetupUsername(e.target.value)}
            placeholder="Username"
            autoComplete="username"
            data-testid="setup-username"
            className="px-3 py-2 rounded bg-base03 border border-base01/50 text-base0 placeholder-base01 focus:outline-none focus:border-blue"
          />
          <input
            type="password"
            value={setupPassword}
            onChange={(e) => setSetupPassword(e.target.value)}
            placeholder="Password (min 8 characters)"
            autoComplete="new-password"
            data-testid="setup-password"
            className="px-3 py-2 rounded bg-base03 border border-base01/50 text-base0 placeholder-base01 focus:outline-none focus:border-blue"
          />
          <input
            type="password"
            value={setupConfirm}
            onChange={(e) => setSetupConfirm(e.target.value)}
            placeholder="Confirm password"
            autoComplete="new-password"
            data-testid="setup-confirm"
            className="px-3 py-2 rounded bg-base03 border border-base01/50 text-base0 placeholder-base01 focus:outline-none focus:border-blue"
          />
          {error && (
            <p data-testid="login-error" className="text-sm text-red text-center">{error}</p>
          )}
          <button
            type="submit"
            data-testid="setup-submit"
            className="px-4 py-2 rounded bg-blue text-base3 font-medium hover:bg-blue/80 transition-colors"
          >
            Create Account
          </button>
        </form>
      )}

      {phase === 'totp-enroll' && (
        <form
          onSubmit={handleEnrollVerify}
          className="flex flex-col gap-4 p-8 rounded-lg bg-base02 border border-base01/30 shadow-lg w-full max-w-sm"
        >
          <h1 className="text-xl font-semibold text-base1 text-center">DanCode</h1>
          <p className="text-sm text-base0 text-center">
            Scan this QR code with your authenticator app
          </p>
          {qrCodeUrl && (
            <div className="flex justify-center">
              <img src={qrCodeUrl} alt="TOTP QR Code" data-testid="totp-qr" className="rounded" />
            </div>
          )}
          <p className="text-xs text-base01 text-center break-all">
            Manual entry: <code className="text-base0">{totpSecret}</code>
          </p>
          <input
            type="text"
            value={enrollCode}
            onChange={(e) => setEnrollCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            data-testid="enroll-totp"
            className="px-3 py-2 rounded bg-base03 border border-base01/50 text-base0 placeholder-base01 focus:outline-none focus:border-blue text-center text-lg tracking-widest"
          />
          {error && (
            <p data-testid="login-error" className="text-sm text-red text-center">{error}</p>
          )}
          <button
            type="submit"
            data-testid="enroll-submit"
            className="px-4 py-2 rounded bg-blue text-base3 font-medium hover:bg-blue/80 transition-colors"
          >
            Verify & Sign In
          </button>
        </form>
      )}

      {phase === 'login' && (
        <form
          onSubmit={handleLogin}
          className="flex flex-col gap-4 p-8 rounded-lg bg-base02 border border-base01/30 shadow-lg w-full max-w-sm"
        >
          <h1 className="text-xl font-semibold text-base1 text-center">DanCode</h1>
          <p className="text-sm text-base0 text-center">Sign in to continue</p>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="username"
            data-testid="login-username"
            className="px-3 py-2 rounded bg-base03 border border-base01/50 text-base0 placeholder-base01 focus:outline-none focus:border-blue"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            data-testid="login-password"
            className="px-3 py-2 rounded bg-base03 border border-base01/50 text-base0 placeholder-base01 focus:outline-none focus:border-blue"
          />
          <input
            type="text"
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit authenticator code"
            inputMode="numeric"
            autoComplete="one-time-code"
            data-testid="login-totp"
            className="px-3 py-2 rounded bg-base03 border border-base01/50 text-base0 placeholder-base01 focus:outline-none focus:border-blue text-center text-lg tracking-widest"
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
      )}
    </div>
  )
}
