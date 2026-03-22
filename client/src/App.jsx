import { useState, useEffect, useCallback, useRef } from 'react'
import Terminal from './Terminal.jsx'
import PaneLayout from './PaneLayout.jsx'
import LoginScreen from './LoginScreen.jsx'
import NewProjectForm from './NewProjectForm.jsx'
import CommandPalette from './CommandPalette.jsx'
import Sidebar from './Sidebar.jsx'

const TOKEN_KEY = 'dancode-auth-token'
const SIDEBAR_KEY = 'dancode-sidebar-collapsed'

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))
  const [validating, setValidating] = useState(() => !!localStorage.getItem(TOKEN_KEY))
  const [showNewProject, setShowNewProject] = useState(false)
  const [selectedSlug, setSelectedSlug] = useState(null)
  const [selectedProjectName, setSelectedProjectName] = useState(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [projects, setProjects] = useState([])
  const [tmuxStatus, setTmuxStatus] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === 'true')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)

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

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [dropdownOpen])

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
    setSelectedProjectName(null)
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
    setSelectedProjectName(project.name || null)
    fetchProjects()
    fetchTmuxStatus()
  }

  function handlePaletteSelect(slug) {
    setPaletteOpen(false)
    setDropdownOpen(false)
    setSelectedSlug(slug)
    setSelectedProjectName(Array.isArray(projects) ? projects.find((p) => p.slug === slug)?.name || null : null)
    setShowNewProject(false)
  }

  function handleDropdownSelect(slug) {
    setDropdownOpen(false)
    setSelectedSlug(slug)
    setSelectedProjectName(Array.isArray(projects) ? projects.find((p) => p.slug === slug)?.name || null : null)
    setShowNewProject(false)
  }

  function handleSidebarSelect(slug) {
    setSelectedSlug(slug)
    setSelectedProjectName(Array.isArray(projects) ? projects.find((p) => p.slug === slug)?.name || null : null)
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
        {selectedProjectName && (
          <div className="relative ml-3 border-l border-base01/30 pl-3" ref={dropdownRef}>
            <button
              data-testid="header-project-name"
              onClick={() => setDropdownOpen((prev) => !prev)}
              className="text-sm text-base0 hover:text-base1 transition-colors cursor-pointer flex items-center gap-1"
            >
              {selectedProjectName}
              <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor"><path d="M3 5l3 3 3-3z" /></svg>
            </button>
            {dropdownOpen && (
              <ul data-testid="header-dropdown" className="absolute top-full left-0 mt-1 min-w-48 bg-base02 border border-base01/30 rounded shadow-lg z-50 py-1">
                {Array.isArray(projects) && projects.map((p) => (
                  <li key={p.slug}>
                    <button
                      data-testid={`dropdown-item-${p.slug}`}
                      onClick={() => handleDropdownSelect(p.slug)}
                      className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                        p.slug === selectedSlug
                          ? 'text-base1 font-semibold bg-base03/50'
                          : 'text-base0 hover:bg-base03/30 hover:text-base1'
                      }`}
                    >
                      {p.slug === selectedSlug && <span className="mr-1.5">✓</span>}
                      {p.name || p.slug}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
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
          onToggle={() => setSidebarCollapsed((prev) => {
            const next = !prev
            localStorage.setItem(SIDEBAR_KEY, String(next))
            return next
          })}
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
