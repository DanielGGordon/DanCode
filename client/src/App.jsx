import { useState, useEffect, useCallback } from 'react'
import Terminal from './Terminal.jsx'
import PaneLayout from './PaneLayout.jsx'
import LoginScreen from './LoginScreen.jsx'
import NewProjectForm from './NewProjectForm.jsx'
import CommandPalette from './CommandPalette.jsx'
import Sidebar from './Sidebar.jsx'

const TOKEN_KEY = 'dancode-auth-token'

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))
  const [validating, setValidating] = useState(() => !!localStorage.getItem(TOKEN_KEY))
  const [showNewProject, setShowNewProject] = useState(false)
  const [selectedSlug, setSelectedSlug] = useState(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [projects, setProjects] = useState([])
  const [tmuxStatus, setTmuxStatus] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

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

  // Fetch projects when authenticated
  const fetchProjects = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/projects', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setProjects(data)
      }
    } catch {}
  }, [token])

  // Fetch tmux session status for all projects
  const fetchTmuxStatus = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/tmux-status', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setTmuxStatus(data)
      } else {
        setTmuxStatus({})
      }
    } catch {
      setTmuxStatus({})
    }
  }, [token])

  useEffect(() => {
    fetchProjects()
    fetchTmuxStatus()
  }, [fetchProjects, fetchTmuxStatus])

  // Ctrl+K keyboard shortcut for command palette
  useEffect(() => {
    if (!token) return

    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        const tag = document.activeElement?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return
        e.preventDefault()
        setPaletteOpen((prev) => !prev)
      }
      if (e.key === 'Escape' && paletteOpen) {
        setPaletteOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [token, paletteOpen])

  function handleLogin(value) {
    localStorage.setItem(TOKEN_KEY, value)
    setToken(value)
    setValidating(false)
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setShowNewProject(false)
    setSelectedSlug(null)
    setProjects([])
    setTmuxStatus(null)
  }

  if (validating) {
    return null
  }

  if (!token) {
    return <LoginScreen onLogin={handleLogin} />
  }

  function handleProjectCreated(project) {
    setShowNewProject(false)
    setSelectedSlug(project.slug)
    fetchProjects()
    fetchTmuxStatus()
  }

  function handlePaletteSelect(slug) {
    setPaletteOpen(false)
    setSelectedSlug(slug)
    setShowNewProject(false)
  }

  function handleSidebarSelect(slug) {
    setSelectedSlug(slug)
    setShowNewProject(false)
  }

  return (
    <div className="w-screen h-screen flex flex-col">
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        projects={projects}
        currentSlug={selectedSlug}
        onSelect={handlePaletteSelect}
      />
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
      <div className="flex flex-1 min-h-0">
        <Sidebar
          projects={projects}
          currentSlug={selectedSlug}
          onSelect={handleSidebarSelect}
          tmuxStatus={tmuxStatus}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((prev) => !prev)}
        />
        <main className="flex-1 min-h-0 min-w-0">
          {showNewProject ? (
            <NewProjectForm
              token={token}
              onCreated={handleProjectCreated}
              onCancel={() => setShowNewProject(false)}
            />
          ) : selectedSlug ? (
            <PaneLayout key={selectedSlug} token={token} slug={selectedSlug} />
          ) : (
            <Terminal token={token} />
          )}
        </main>
      </div>
    </div>
  )
}

export default App
