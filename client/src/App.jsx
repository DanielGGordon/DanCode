import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import LoginScreen from './LoginScreen.jsx'
import NewProjectForm from './NewProjectForm.jsx'
import CommandPalette from './CommandPalette.jsx'
import Sidebar from './Sidebar.jsx'
import ResizeHandle from './ResizeHandle.jsx'

// Post-auth components loaded via React.lazy for code splitting
const TerminalLayout = lazy(() => import('./TerminalLayout.jsx'))
const FileExplorer = lazy(() => import('./FileExplorer.jsx'))
const MobileDashboard = lazy(() => import('./MobileDashboard.jsx'))
const MobileTerminalList = lazy(() => import('./MobileTerminalList.jsx'))
const MobileTerminalView = lazy(() => import('./MobileTerminalView.jsx'))

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center w-full h-full bg-base03">
      <div className="w-6 h-6 border-2 border-base01/30 border-t-blue rounded-full animate-spin" />
    </div>
  )
}

const TOKEN_KEY = 'dancode-auth-token'
const SIDEBAR_KEY = 'dancode-sidebar-collapsed'
const FILE_EXPLORER_KEY = 'dancode-file-explorer-collapsed'
const FILE_EXPLORER_WIDTH_KEY = 'dancode-file-explorer-width'
const MOBILE_BREAKPOINT = 480
const TABLET_MAX = 1024
const MIN_EXPLORER_WIDTH = 120
const MAX_EXPLORER_WIDTH = 600

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < TABLET_MAX
  )
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${TABLET_MAX - 1}px)`)
    const onChange = (e) => setIsMobile(e.matches)
    mql.addEventListener('change', onChange)
    setIsMobile(mql.matches)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return isMobile
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))
  const [validating, setValidating] = useState(() => !!localStorage.getItem(TOKEN_KEY))
  const [showNewProject, setShowNewProject] = useState(false)
  const [selectedSlug, setSelectedSlug] = useState(null)
  const [selectedProjectName, setSelectedProjectName] = useState(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [projects, setProjects] = useState([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === 'true')
  const [fileExplorerCollapsed, setFileExplorerCollapsed] = useState(() => localStorage.getItem(FILE_EXPLORER_KEY) !== 'false')
  const [fileExplorerWidth, setFileExplorerWidth] = useState(() => {
    const saved = localStorage.getItem(FILE_EXPLORER_WIDTH_KEY)
    return saved ? Number(saved) : 224
  })
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)
  const fileExplorerRef = useRef(null)
  const terminalLayoutRef = useRef(null)
  const isMobile = useIsMobile()

  // Mobile-specific state
  const [mobileView, setMobileView] = useState('dashboard') // 'dashboard' | 'terminals' | 'terminal'
  const [mobileTerminal, setMobileTerminal] = useState(null) // { id, label }
  const [mobileTerminals, setMobileTerminals] = useState([]) // all terminals for current project
  const [projectTerminals, setProjectTerminals] = useState({}) // { [slug]: [...terminals with lastActivity] }

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
        return data
      }
    } catch {}
    return null
  }, [token])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  // Fetch terminal activity data for all projects (mobile dashboard)
  const fetchAllTerminalActivity = useCallback(async () => {
    if (!token || !isMobile) return
    try {
      const res = await fetch('/api/terminals', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const allTerminals = await res.json()
        const grouped = {}
        for (const t of allTerminals) {
          if (!grouped[t.projectSlug]) grouped[t.projectSlug] = []
          grouped[t.projectSlug].push(t)
        }
        setProjectTerminals(grouped)
      }
    } catch {}
  }, [token, isMobile])

  useEffect(() => {
    fetchAllTerminalActivity()
    // Refresh activity every 30 seconds
    if (isMobile && token) {
      const interval = setInterval(fetchAllTerminalActivity, 30000)
      return () => clearInterval(interval)
    }
  }, [fetchAllTerminalActivity, isMobile, token])

  // Persist file explorer width
  useEffect(() => {
    if (!fileExplorerCollapsed) {
      localStorage.setItem(FILE_EXPLORER_WIDTH_KEY, String(fileExplorerWidth))
    }
  }, [fileExplorerWidth, fileExplorerCollapsed])

  const handleExplorerResize = useCallback((pos) => {
    const el = fileExplorerRef.current
    if (!el) return
    const left = el.getBoundingClientRect().left
    const newWidth = Math.max(MIN_EXPLORER_WIDTH, Math.min(MAX_EXPLORER_WIDTH, pos - left))
    setFileExplorerWidth(newWidth)
  }, [])

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

  // Global keyboard shortcuts
  useEffect(() => {
    if (!token) return

    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        const tag = document.activeElement?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return
        e.preventDefault()
        e.stopPropagation()
        setPaletteOpen((prev) => !prev)
      }
      if (e.key === 'Escape' && paletteOpen) {
        e.preventDefault()
        e.stopPropagation()
        setPaletteOpen(false)
      }
      if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && Array.isArray(projects) && projects.length > 1) {
        e.preventDefault()
        e.stopPropagation()
        const currentIndex = projects.findIndex((p) => p.slug === selectedSlug)
        let nextIndex
        if (e.key === 'ArrowRight') {
          nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % projects.length
        } else {
          nextIndex = currentIndex <= 0 ? projects.length - 1 : currentIndex - 1
        }
        const next = projects[nextIndex]
        setSelectedSlug(next.slug)
        setSelectedProjectName(next.name || null)
        setShowNewProject(false)
        setPaletteOpen(false)
        setDropdownOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [token, paletteOpen, projects, selectedSlug])

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
    setMobileTerminal(null)
    setMobileTerminals([])
    setMobileView('dashboard')
    setProjectTerminals({})
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

  async function handleRenameProject(slug, newName) {
    try {
      const res = await fetch(`/api/projects/${slug}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: newName }),
      })
      if (res.ok) {
        if (selectedSlug === slug) {
          setSelectedProjectName(newName)
        }
        fetchProjects()
      }
    } catch {}
  }

  async function handleDeleteProject(slug) {
    try {
      const res = await fetch(`/api/projects/${slug}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        if (selectedSlug === slug) {
          setSelectedSlug(null)
          setSelectedProjectName(null)
        }
        fetchProjects()
      }
    } catch {}
  }

  // Mobile: tap project card → show terminal list
  async function handleMobileSelectProject(slug) {
    setSelectedSlug(slug)
    setSelectedProjectName(Array.isArray(projects) ? projects.find((p) => p.slug === slug)?.name || null : null)
    try {
      const res = await fetch(`/api/terminals?project=${slug}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const terms = await res.json()
        setMobileTerminals(terms)
        setMobileView('terminals')
      }
    } catch {}
  }

  // Mobile: tap terminal in list → open terminal view
  function handleMobileSelectTerminal(terminal) {
    setMobileTerminal(terminal)
    setMobileView('terminal')
  }

  // Mobile: long-press quick action to open a specific terminal type
  async function handleMobileQuickAction(slug, action) {
    setSelectedSlug(slug)
    setSelectedProjectName(Array.isArray(projects) ? projects.find((p) => p.slug === slug)?.name || null : null)
    try {
      const res = await fetch(`/api/terminals?project=${slug}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const terms = await res.json()
        setMobileTerminals(terms)
        const target = action === 'claude'
          ? terms.find((t) => /claude/i.test(t.label))
          : terms.find((t) => /cli/i.test(t.label))
        setMobileTerminal(target || terms[0] || null)
        setMobileView('terminal')
      }
    } catch {}
  }

  // Mobile: back from terminal view → terminal list
  function handleMobileBackFromTerminal() {
    setMobileTerminal(null)
    setMobileView('terminals')
  }

  // Mobile: back from terminal list → dashboard
  function handleMobileBackFromList() {
    setMobileTerminals([])
    setSelectedSlug(null)
    setSelectedProjectName(null)
    setMobileView('dashboard')
  }

  // Mobile: switch between terminals in the mobile view
  function handleMobileSwitchTerminal(terminalId) {
    const t = mobileTerminals.find((term) => term.id === terminalId)
    if (t) setMobileTerminal(t)
  }

  // Mobile: switch project from drawer
  async function handleMobileSwitchProject(slug) {
    setSelectedSlug(slug)
    setSelectedProjectName(Array.isArray(projects) ? projects.find((p) => p.slug === slug)?.name || null : null)
    try {
      const res = await fetch(`/api/terminals?project=${slug}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const terms = await res.json()
        setMobileTerminals(terms)
        if (terms.length > 0) {
          setMobileTerminal(terms[0])
          setMobileView('terminal')
        } else {
          setMobileView('terminals')
        }
      }
    } catch {}
  }

  // Mobile: pull-to-refresh on dashboard
  async function handleMobileRefresh() {
    await fetchProjects()
    await fetchAllTerminalActivity()
  }

  // --- Mobile layout ---
  if (isMobile) {
    // Show mobile terminal view
    if (mobileView === 'terminal' && mobileTerminal && selectedSlug) {
      return (
        <Suspense fallback={<LoadingFallback />}>
          <MobileTerminalView
            token={token}
            terminal={mobileTerminal}
            projectSlug={selectedSlug}
            onBack={handleMobileBackFromTerminal}
            terminals={mobileTerminals}
            onSwitchTerminal={handleMobileSwitchTerminal}
            projects={projects}
            onSwitchProject={handleMobileSwitchProject}
          />
        </Suspense>
      )
    }

    // Show terminal list for selected project
    if (mobileView === 'terminals' && selectedSlug) {
      return (
        <Suspense fallback={<LoadingFallback />}>
          <MobileTerminalList
            projectName={selectedProjectName}
            terminals={mobileTerminals}
            onSelectTerminal={handleMobileSelectTerminal}
            onBack={handleMobileBackFromList}
          />
        </Suspense>
      )
    }

    // Show new project form on mobile
    if (showNewProject) {
      return (
        <div className="w-screen h-screen flex flex-col bg-base03">
          <NewProjectForm
            token={token}
            onCreated={(project) => {
              handleProjectCreated(project)
              handleMobileSelectProject(project.slug)
            }}
            onCancel={() => setShowNewProject(false)}
          />
        </div>
      )
    }

    // Mobile dashboard
    return (
      <Suspense fallback={<LoadingFallback />}>
        <MobileDashboard
          projects={projects}
          projectTerminals={projectTerminals}
          onSelectProject={handleMobileSelectProject}
          onQuickAction={handleMobileQuickAction}
          onNewProject={() => setShowNewProject(true)}
          onLogout={handleLogout}
          onRefresh={handleMobileRefresh}
        />
      </Suspense>
    )
  }

  // --- Desktop layout ---
  return (
    <div className="w-screen h-screen flex flex-col">
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        projects={projects}
        currentSlug={selectedSlug}
        onSelect={handlePaletteSelect}
      />
      <header className="flex items-center px-4 py-1.5 bg-base03 border-b border-base01/30">
        <h1 className="text-sm font-medium text-base0 tracking-wide">DanCode</h1>
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
                      {p.slug === selectedSlug && <span className="mr-1.5">{'\u2713'}</span>}
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
          onDelete={handleDeleteProject}
          onRename={handleRenameProject}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((prev) => {
            const next = !prev
            localStorage.setItem(SIDEBAR_KEY, String(next))
            return next
          })}
        />
        {selectedSlug && !showNewProject && (
          <>
            <div ref={fileExplorerRef} className="shrink-0 h-full">
              <Suspense fallback={<LoadingFallback />}>
                <FileExplorer
                  token={token}
                  slug={selectedSlug}
                  collapsed={fileExplorerCollapsed}
                  width={fileExplorerCollapsed ? undefined : fileExplorerWidth}
                  onToggle={() => setFileExplorerCollapsed((prev) => {
                    const next = !prev
                    localStorage.setItem(FILE_EXPLORER_KEY, String(!next))
                    return next
                  })}
                  onOpenTerminalHere={(dirPath) => {
                    if (terminalLayoutRef.current) {
                      terminalLayoutRef.current.addTerminalWithCwd(dirPath)
                    }
                  }}
                  onInsertPath={(path) => {
                    if (terminalLayoutRef.current) {
                      terminalLayoutRef.current.insertIntoFocusedTerminal(path)
                    }
                  }}
                  onOpenFile={(filePath) => {
                    if (terminalLayoutRef.current) {
                      terminalLayoutRef.current.openFile(filePath)
                    }
                  }}
                />
              </Suspense>
            </div>
            {!fileExplorerCollapsed && (
              <ResizeHandle
                direction="vertical"
                onDrag={handleExplorerResize}
              />
            )}
          </>
        )}
        <main className="flex-1 min-h-0 min-w-0">
          {showNewProject ? (
            <NewProjectForm
              token={token}
              onCreated={handleProjectCreated}
              onCancel={() => setShowNewProject(false)}
            />
          ) : selectedSlug ? (
            <Suspense fallback={<LoadingFallback />}>
              <TerminalLayout ref={terminalLayoutRef} key={selectedSlug} token={token} slug={selectedSlug} />
            </Suspense>
          ) : (
            <div data-testid="welcome-screen" className="flex items-center justify-center h-full">
              <div className="text-center">
                <h2 className="text-lg text-base01 font-medium">Select a project or create a new one</h2>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
