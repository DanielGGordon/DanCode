import { useState, useCallback, useEffect, useRef } from 'react'
import Terminal from './Terminal.jsx'

export const MOBILE_BREAKPOINT = 768

export default function TerminalLayout({ token, slug }) {
  const [terminals, setTerminals] = useState([])
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [layoutMode, setLayoutMode] = useState('split')
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
  )
  const loadedRef = useRef(false)
  const saveTimerRef = useRef(null)
  const editInputRef = useRef(null)
  const [fetchAttempt, setFetchAttempt] = useState(0)

  // Responsive breakpoint
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = (e) => setIsMobile(e.matches)
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange)
    } else {
      mql.addListener(onChange)
    }
    setIsMobile(mql.matches)
    return () => {
      if (mql.removeEventListener) {
        mql.removeEventListener('change', onChange)
      } else {
        mql.removeListener(onChange)
      }
    }
  }, [])

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  // Load project config and terminals
  useEffect(() => {
    if (!slug || !token) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setFetchError(null)

    async function load() {
      try {
        // Load project config for layout preferences
        const projRes = await fetch(`/api/projects/${slug}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!projRes.ok) throw new Error(`Failed to load project (${projRes.status})`)
        const project = await projRes.json()

        if (cancelled) return

        if (project.layout) {
          if (project.layout.mode === 'split' || project.layout.mode === 'tabs') {
            setLayoutMode(project.layout.mode)
          }
          if (typeof project.layout.activeTab === 'number') {
            setFocusedIndex(project.layout.activeTab)
          }
        }

        // Load terminals for this project
        const termRes = await fetch(`/api/terminals?project=${slug}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!termRes.ok) throw new Error(`Failed to load terminals (${termRes.status})`)
        const termData = await termRes.json()

        if (cancelled) return

        // Order terminals by project.terminals array if available
        if (Array.isArray(project.terminals) && project.terminals.length > 0) {
          const ordered = []
          for (const id of project.terminals) {
            const t = termData.find((td) => td.id === id)
            if (t) ordered.push(t)
          }
          // Add any terminals not in the order list
          for (const t of termData) {
            if (!ordered.find((o) => o.id === t.id)) ordered.push(t)
          }
          setTerminals(ordered)
        } else {
          setTerminals(termData)
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(err.message || 'Failed to load project')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          setTimeout(() => { loadedRef.current = true }, 0)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [slug, token, fetchAttempt])

  // Save layout preferences when they change (debounced)
  useEffect(() => {
    if (!loadedRef.current || !slug || !token) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      fetch(`/api/projects/${slug}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          layout: { mode: layoutMode, activeTab: focusedIndex },
          terminals: terminals.map((t) => t.id),
        }),
      }).catch(() => {})
    }, 300)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [layoutMode, focusedIndex, terminals, slug, token])

  const effectiveLayout = isMobile ? 'tabs' : layoutMode

  const handleTerminalClick = useCallback((index) => {
    setFocusedIndex(index)
  }, [])

  const handlePaneMouseDown = useCallback((e) => {
    if (e.ctrlKey) e.preventDefault()
  }, [])

  const toggleLayout = useCallback(() => {
    setLayoutMode((prev) => (prev === 'split' ? 'tabs' : 'split'))
  }, [])

  // Add a new terminal
  const handleAddTerminal = useCallback(async () => {
    if (!slug || !token) return
    const label = `Terminal ${terminals.length + 1}`
    try {
      const res = await fetch('/api/terminals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ projectSlug: slug, label }),
      })
      if (res.ok) {
        const newTerm = await res.json()
        setTerminals((prev) => [...prev, newTerm])
        setFocusedIndex(terminals.length)
      }
    } catch {}
  }, [slug, token, terminals.length])

  // Close a terminal with confirmation
  const handleCloseTerminal = useCallback(async (id) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id)
      return
    }
    setConfirmDeleteId(null)
    try {
      const res = await fetch(`/api/terminals/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        setTerminals((prev) => {
          const next = prev.filter((t) => t.id !== id)
          return next
        })
        setFocusedIndex((prev) => Math.min(prev, terminals.length - 2))
      }
    } catch {}
  }, [token, confirmDeleteId, terminals.length])

  // Start inline editing
  const handleStartEdit = useCallback((id, currentLabel) => {
    setEditingId(id)
    setEditValue(currentLabel)
  }, [])

  // Save inline edit
  const handleSaveEdit = useCallback(async (id) => {
    const trimmed = editValue.trim()
    if (!trimmed) {
      setEditingId(null)
      return
    }
    try {
      const res = await fetch(`/api/terminals/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ label: trimmed }),
      })
      if (res.ok) {
        const updated = await res.json()
        setTerminals((prev) =>
          prev.map((t) => (t.id === id ? { ...t, label: updated.label } : t))
        )
      }
    } catch {}
    setEditingId(null)
  }, [token, editValue])

  // Cancel inline edit
  const handleCancelEdit = useCallback(() => {
    setEditingId(null)
  }, [])

  if (loading) {
    return (
      <div data-testid="terminal-layout" className="flex flex-col w-full h-full">
        <div data-testid="terminal-loading" className="flex flex-col items-center justify-center flex-1 gap-3">
          <div className="w-6 h-6 border-2 border-base01/30 border-t-blue rounded-full animate-spin" />
          <span className="text-xs text-base01">Loading project...</span>
        </div>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div data-testid="terminal-layout" className="flex flex-col w-full h-full">
        <div data-testid="terminal-fetch-error" className="flex items-center justify-center flex-1 p-6">
          <div className="flex flex-col items-center gap-3 p-6 rounded-lg bg-base02 border border-base01/30 shadow-lg max-w-sm text-center">
            <div className="text-red text-lg font-semibold">Failed to Load Project</div>
            <p className="text-base0 text-sm">{fetchError}</p>
            <button
              data-testid="terminal-retry-button"
              onClick={() => setFetchAttempt((n) => n + 1)}
              className="mt-2 px-4 py-2 text-sm font-medium text-base1 bg-blue/20 border border-blue/50 rounded hover:bg-blue/30 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="terminal-layout" data-slug={slug} className="flex flex-col w-full h-full animate-fade-in">
      {/* Layout toolbar */}
      <div className="flex items-center px-2 py-1 bg-base02 border-b border-base01/30">
        {effectiveLayout === 'tabs' && (
          <div className="flex gap-1 mr-2" data-testid="tab-bar">
            {terminals.map((term, index) => {
              const isActive = focusedIndex === index
              return (
                <button
                  key={term.id}
                  data-testid={`tab-${index}`}
                  onClick={() => setFocusedIndex(index)}
                  onDoubleClick={() => handleStartEdit(term.id, term.label)}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    isActive
                      ? 'text-base1 bg-base03 border border-blue/50'
                      : 'text-base01 bg-base02 border border-base01/30 hover:text-base0'
                  }`}
                >
                  {editingId === term.id ? (
                    <input
                      ref={editInputRef}
                      data-testid={`tab-edit-${index}`}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit(term.id)
                        if (e.key === 'Escape') handleCancelEdit()
                      }}
                      onBlur={() => handleSaveEdit(term.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-base03 text-base1 text-xs px-1 py-0 rounded border border-blue/50 outline-none w-20"
                    />
                  ) : (
                    term.label
                  )}
                </button>
              )
            })}
          </div>
        )}
        <button
          data-testid="add-terminal-button"
          onClick={handleAddTerminal}
          className="px-2 py-1 text-xs text-blue hover:text-blue/80 border border-base01/30 rounded transition-colors mr-auto"
        >
          +
        </button>
        <div className="flex gap-1 ml-auto">
          {!isMobile && (
            <button
              data-testid="layout-toggle"
              onClick={toggleLayout}
              className="px-2 py-1 text-xs text-base01 hover:text-base0 border border-base01/30 rounded transition-colors"
            >
              {layoutMode === 'split' ? 'Tabs' : 'Split'}
            </button>
          )}
        </div>
      </div>

      {/* Terminal content */}
      {effectiveLayout === 'split' ? (
        <div key="split" className="flex flex-row flex-1 min-h-0 animate-fade-in">
          {terminals.map((term, index) => {
            const isFocused = focusedIndex === index
            return (
              <div
                key={term.id}
                data-testid={`terminal-pane-${index}`}
                className={`flex-1 min-w-0 flex flex-col border-r last:border-r-0 transition-all duration-150 ${
                  isFocused
                    ? 'border-blue/50 border-l-8 border-l-blue'
                    : 'border-base01/30 border-l-8 border-l-transparent opacity-60'
                }`}
                onClick={() => handleTerminalClick(index)}
                onMouseDown={handlePaneMouseDown}
              >
                <div
                  className={`px-3 py-1 text-xs font-medium border-b select-none flex items-center justify-between transition-colors duration-150 ${
                    isFocused
                      ? 'text-base1 bg-blue/10 border-blue/50'
                      : 'text-base01 bg-base02 border-base01/30'
                  }`}
                >
                  {editingId === term.id ? (
                    <input
                      ref={editInputRef}
                      data-testid={`pane-edit-${index}`}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit(term.id)
                        if (e.key === 'Escape') handleCancelEdit()
                      }}
                      onBlur={() => handleSaveEdit(term.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-base03 text-base1 text-xs px-1 py-0 rounded border border-blue/50 outline-none w-24"
                    />
                  ) : (
                    <span onDoubleClick={() => handleStartEdit(term.id, term.label)}>{term.label}</span>
                  )}
                  <button
                    data-testid={`close-terminal-${index}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCloseTerminal(term.id)
                    }}
                    className="text-base01 hover:text-red text-xs ml-2 transition-colors"
                    title={confirmDeleteId === term.id ? 'Click again to confirm' : 'Close terminal'}
                  >
                    {confirmDeleteId === term.id ? 'Confirm?' : '\u00d7'}
                  </button>
                </div>
                <div className="flex-1 min-h-0">
                  <Terminal
                    token={token}
                    terminalId={term.id}
                    focused={isFocused}
                    onFocus={() => setFocusedIndex(index)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div key="tabs" className="flex-1 min-h-0 flex flex-col animate-fade-in" data-testid="tabbed-content">
          {terminals.map((term, index) => {
            const isActive = focusedIndex === index
            return (
              <div
                key={term.id}
                data-testid={`terminal-pane-${index}`}
                className={`flex-1 min-h-0 flex flex-col ${isActive ? '' : 'hidden'}`}
              >
                <div
                  className="px-3 py-1 text-xs font-medium border-b select-none flex items-center justify-between text-base1 bg-blue/10 border-blue/50"
                >
                  {editingId === term.id ? (
                    <input
                      ref={editInputRef}
                      data-testid={`pane-edit-${index}`}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit(term.id)
                        if (e.key === 'Escape') handleCancelEdit()
                      }}
                      onBlur={() => handleSaveEdit(term.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-base03 text-base1 text-xs px-1 py-0 rounded border border-blue/50 outline-none w-24"
                    />
                  ) : (
                    <span onDoubleClick={() => handleStartEdit(term.id, term.label)}>{term.label}</span>
                  )}
                  <button
                    data-testid={`close-terminal-${index}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCloseTerminal(term.id)
                    }}
                    className="text-base01 hover:text-red text-xs ml-2 transition-colors"
                    title={confirmDeleteId === term.id ? 'Click again to confirm' : 'Close terminal'}
                  >
                    {confirmDeleteId === term.id ? 'Confirm?' : '\u00d7'}
                  </button>
                </div>
                <Terminal
                  token={token}
                  terminalId={term.id}
                  focused={isActive}
                  onFocus={() => setFocusedIndex(index)}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* Confirm delete dialog */}
      {confirmDeleteId && (
        <div
          data-testid="confirm-delete-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center bg-base03/70"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            className="flex flex-col gap-3 p-6 rounded-lg bg-base02 border border-base01/30 shadow-lg max-w-sm text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-base1 font-semibold">Close Terminal?</div>
            <p className="text-base0 text-sm">
              This will kill the terminal process. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                data-testid="confirm-delete-cancel"
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 text-sm rounded border border-base01/50 text-base0 hover:bg-base03 transition-colors"
              >
                Cancel
              </button>
              <button
                data-testid="confirm-delete-yes"
                onClick={() => handleCloseTerminal(confirmDeleteId)}
                className="px-4 py-2 text-sm rounded bg-red/80 text-base3 font-medium hover:bg-red transition-colors"
              >
                Close Terminal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
