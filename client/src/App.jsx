import { useState, useEffect } from 'react'
import Terminal from './Terminal.jsx'
import LoginScreen from './LoginScreen.jsx'
import NewProjectForm from './NewProjectForm.jsx'

const TOKEN_KEY = 'dancode-auth-token'

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))
  const [validating, setValidating] = useState(() => !!localStorage.getItem(TOKEN_KEY))
  const [showNewProject, setShowNewProject] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false

    async function validate() {
      try {
        const res = await fetch('/api/auth/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        if (!cancelled) {
          if (!res.ok) {
            localStorage.removeItem(TOKEN_KEY)
            setToken(null)
          }
          setValidating(false)
        }
      } catch {
        if (!cancelled) {
          localStorage.removeItem(TOKEN_KEY)
          setToken(null)
          setValidating(false)
        }
      }
    }

    validate()
    return () => { cancelled = true }
  }, [])

  function handleLogin(value) {
    localStorage.setItem(TOKEN_KEY, value)
    setToken(value)
    setValidating(false)
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
  }

  if (validating) {
    return null
  }

  if (!token) {
    return <LoginScreen onLogin={handleLogin} />
  }

  function handleProjectCreated(project) {
    setShowNewProject(false)
  }

  return (
    <div className="w-screen h-screen flex flex-col">
      <header className="flex items-center px-4 py-2 bg-base02 border-b border-base01/30">
        <h1 className="text-sm font-semibold text-base1 tracking-wide">DanCode</h1>
        <button
          onClick={() => setShowNewProject(true)}
          data-testid="new-project-button"
          className="ml-4 text-xs text-blue hover:text-blue/80 transition-colors"
        >
          + New Project
        </button>
        <button
          onClick={handleLogout}
          data-testid="logout-button"
          className="ml-auto text-xs text-base01 hover:text-base0 transition-colors"
        >
          Logout
        </button>
      </header>
      <main className="flex-1 min-h-0">
        {showNewProject ? (
          <NewProjectForm
            token={token}
            onCreated={handleProjectCreated}
            onCancel={() => setShowNewProject(false)}
          />
        ) : (
          <Terminal token={token} />
        )}
      </main>
    </div>
  )
}

export default App
