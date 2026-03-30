import { useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle, Fragment, useMemo } from 'react'
import Terminal from './Terminal.jsx'
import FileViewer from './FileViewer.jsx'
import ShortcutBar from './ShortcutBar.jsx'
import ResizeHandle from './ResizeHandle.jsx'

export const MOBILE_BREAKPOINT = 768
const TABLET_MAX = 1024
const MIN_PANE_PCT = 10

/**
 * Returns Tailwind classes for a connection state indicator dot.
 */
function connectionDotClasses(state) {
  switch (state) {
    case 'connected':
      return 'bg-green'
    case 'reconnecting':
      return 'bg-yellow animate-pulse-dot'
    case 'disconnected':
    case 'session-exit':
      return 'bg-red'
    default:
      return 'bg-base01'
  }
}

function getFileName(filePath) {
  return filePath.split('/').pop() || filePath
}

const TerminalLayout = forwardRef(function TerminalLayout({ token, slug }, ref) {
  const [terminals, setTerminals] = useState([])
  const [openFiles, setOpenFiles] = useState([]) // [{ id, filePath, label }]
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [layoutMode, setLayoutMode] = useState('split')
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [connectionStates, setConnectionStates] = useState({})
  const [splitDirection, setSplitDirection] = useState('row') // 'row' (side-by-side) | 'column' (stacked)
  const [paneSizes, setPaneSizes] = useState(null) // null = equal, or array of percentages
  const splitContainerRef = useRef(null)
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
  )
  const [isTablet, setIsTablet] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= MOBILE_BREAKPOINT && window.innerWidth < TABLET_MAX
  )
  const [showTabletShortcuts, setShowTabletShortcuts] = useState(false)
  const loadedRef = useRef(false)
  const saveTimerRef = useRef(null)
  const editInputRef = useRef(null)
  const terminalRefs = useRef({})
  const [fetchAttempt, setFetchAttempt] = useState(0)

  // Unified pane list: terminals first, then open files
  const allPanes = useMemo(() => [
    ...terminals.map((t) => ({ ...t, paneType: 'terminal' })),
    ...openFiles.map((f) => ({ ...f, paneType: 'file' })),
  ], [terminals, openFiles])

  // Responsive breakpoints
  useEffect(() => {
    const mobileMql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const tabletMql = window.matchMedia(`(min-width: ${MOBILE_BREAKPOINT}px) and (max-width: ${TABLET_MAX - 1}px)`)
    const onMobileChange = (e) => setIsMobile(e.matches)
    const onTabletChange = (e) => setIsTablet(e.matches)
    mobileMql.addEventListener('change', onMobileChange)
    tabletMql.addEventListener('change', onTabletChange)
    setIsMobile(mobileMql.matches)
    setIsTablet(tabletMql.matches)
    return () => {
      mobileMql.removeEventListener('change', onMobileChange)
      tabletMql.removeEventListener('change', onTabletChange)
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
          if (project.layout.direction === 'row' || project.layout.direction === 'column') {
            setSplitDirection(project.layout.direction)
          }
          if (Array.isArray(project.layout.sizes)) {
            setPaneSizes(project.layout.sizes)
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
          layout: { mode: layoutMode, activeTab: focusedIndex, direction: splitDirection, sizes: paneSizes },
          terminals: terminals.map((t) => t.id),
        }),
      }).catch(() => {})
    }, 300)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [layoutMode, focusedIndex, terminals, slug, token, splitDirection, paneSizes])

  // Reset pane sizes when pane count changes
  useEffect(() => {
    if (paneSizes && paneSizes.length !== allPanes.length) {
      setPaneSizes(null)
    }
  }, [allPanes.length, paneSizes])

  const effectiveLayout = isMobile ? 'tabs' : layoutMode

  const handlePaneClick = useCallback((index) => {
    setFocusedIndex(index)
  }, [])

  const handlePaneMouseDown = useCallback((e) => {
    if (e.ctrlKey) e.preventDefault()
  }, [])

  const toggleLayout = useCallback(() => {
    setLayoutMode((prev) => (prev === 'split' ? 'tabs' : 'split'))
  }, [])

  const toggleDirection = useCallback(() => {
    setSplitDirection((prev) => (prev === 'row' ? 'column' : 'row'))
  }, [])

  const applyPreset = useCallback((primaryPct) => {
    const count = allPanes.length
    if (count < 2) return
    const remainingPct = 100 - primaryPct
    const otherPct = remainingPct / (count - 1)
    setPaneSizes([primaryPct, ...Array(count - 1).fill(otherPct)])
  }, [allPanes.length])

  const resetSizes = useCallback(() => {
    setPaneSizes(null)
  }, [])

  const handleResizeDrag = useCallback((handleIndex, position) => {
    const container = splitContainerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const isRow = splitDirection === 'row'
    const totalSize = isRow ? rect.width : rect.height
    const offset = isRow ? rect.left : rect.top

    const pct = ((position - offset) / totalSize) * 100
    const count = allPanes.length
    const currentSizes = paneSizes && paneSizes.length === count
      ? paneSizes
      : Array(count).fill(100 / count)

    // Calculate cumulative boundaries
    const cumulative = [0]
    for (let i = 0; i < currentSizes.length; i++) {
      cumulative.push(cumulative[i] + currentSizes[i])
    }

    const minPos = cumulative[handleIndex] + MIN_PANE_PCT
    const maxPos = cumulative[handleIndex + 2] - MIN_PANE_PCT
    const clampedPct = Math.max(minPos, Math.min(maxPos, pct))

    const newSizes = [...currentSizes]
    newSizes[handleIndex] = clampedPct - cumulative[handleIndex]
    newSizes[handleIndex + 1] = cumulative[handleIndex + 2] - clampedPct

    setPaneSizes(newSizes)
  }, [splitDirection, allPanes.length, paneSizes])

  // Track connection state per terminal
  const handleConnectionStateChange = useCallback((terminalId, state) => {
    setConnectionStates((prev) => {
      if (prev[terminalId] === state) return prev
      return { ...prev, [terminalId]: state }
    })
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
        // Focus the new terminal (index = current terminals + openFiles)
        setFocusedIndex(terminals.length + openFiles.length)
      }
    } catch {}
  }, [slug, token, terminals.length, openFiles.length])

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
        setFocusedIndex((prev) => Math.min(prev, allPanes.length - 2))
      }
    } catch {}
  }, [token, confirmDeleteId, allPanes.length])

  // Close a file viewer pane (no confirmation needed)
  const handleCloseFile = useCallback((fileId) => {
    setOpenFiles((prev) => prev.filter((f) => f.id !== fileId))
    setFocusedIndex((prev) => Math.min(prev, allPanes.length - 2))
  }, [allPanes.length])

  // Close any pane by type
  const handleClosePane = useCallback((pane) => {
    if (pane.paneType === 'terminal') {
      handleCloseTerminal(pane.id)
    } else {
      handleCloseFile(pane.id)
    }
  }, [handleCloseTerminal, handleCloseFile])

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
    // Check if it's a terminal or a file pane
    const isTerminal = terminals.some((t) => t.id === id)
    if (isTerminal) {
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
    } else {
      // File pane label edit
      setOpenFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, label: trimmed } : f))
      )
    }
    setEditingId(null)
  }, [token, editValue, terminals])

  // Cancel inline edit
  const handleCancelEdit = useCallback(() => {
    setEditingId(null)
  }, [])

  // Store terminal ref by id
  const setTerminalRef = useCallback((id, r) => {
    terminalRefs.current[id] = r
  }, [])

  // Add terminal with custom cwd (used by file explorer "Open terminal here")
  const handleAddTerminalWithCwd = useCallback(async (cwd) => {
    if (!slug || !token) return
    const label = `Terminal ${terminals.length + 1}`
    try {
      const res = await fetch('/api/terminals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ projectSlug: slug, label, cwd }),
      })
      if (res.ok) {
        const newTerm = await res.json()
        setTerminals((prev) => [...prev, newTerm])
        setFocusedIndex(terminals.length + openFiles.length)
      }
    } catch {}
  }, [slug, token, terminals.length, openFiles.length])

  // Open a file in the viewer (or focus if already open)
  const handleOpenFile = useCallback((filePath) => {
    // Check if already open
    const existingIndex = allPanes.findIndex(
      (p) => p.paneType === 'file' && p.filePath === filePath
    )
    if (existingIndex >= 0) {
      setFocusedIndex(existingIndex)
      return
    }
    const newFile = {
      id: self.crypto?.randomUUID?.() || (Math.random().toString(36).slice(2) + Date.now().toString(36)),
      filePath,
      label: getFileName(filePath),
    }
    setOpenFiles((prev) => {
      const next = [...prev, newFile]
      // Focus the new file pane — index is terminals.length + new openFiles index
      setFocusedIndex(terminals.length + next.length - 1)
      // Reset pane sizes so the new pane gets space
      setPaneSizes(null)
      return next
    })
  }, [allPanes, terminals.length])

  // Insert text into focused terminal (used by file explorer drag/double-click)
  const insertIntoFocusedTerminal = useCallback((text) => {
    // Find a focused terminal pane
    const focused = allPanes[focusedIndex]
    if (focused && focused.paneType === 'terminal' && terminalRefs.current[focused.id]) {
      terminalRefs.current[focused.id].sendInput(text)
      return
    }
    // Fallback: find the first terminal
    const firstTerminal = allPanes.find((p) => p.paneType === 'terminal')
    if (firstTerminal && terminalRefs.current[firstTerminal.id]) {
      terminalRefs.current[firstTerminal.id].sendInput(text)
    }
  }, [allPanes, focusedIndex])

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    addTerminalWithCwd: handleAddTerminalWithCwd,
    insertIntoFocusedTerminal,
    openFile: handleOpenFile,
  }), [handleAddTerminalWithCwd, insertIntoFocusedTerminal, handleOpenFile])

  // Handle file drop from file explorer onto terminal panes
  const handleFileDrop = useCallback((e, paneIndex) => {
    const filePath = e.dataTransfer.getData('application/x-dancode-file')
    if (filePath) {
      e.preventDefault()
      const pane = allPanes[paneIndex]
      if (pane && pane.paneType === 'terminal' && terminalRefs.current[pane.id]) {
        terminalRefs.current[pane.id].sendInput(filePath)
      }
    }
  }, [allPanes])

  const handleFileDragOver = useCallback((e) => {
    if (e.dataTransfer.types.includes('application/x-dancode-file')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  // Tablet shortcut bar: send key sequence to focused terminal
  const handleShortcutSend = useCallback((seq) => {
    const focused = allPanes[focusedIndex]
    if (focused && focused.paneType === 'terminal' && terminalRefs.current[focused.id]) {
      terminalRefs.current[focused.id].sendInput(seq)
    }
  }, [allPanes, focusedIndex])

  const handleShortcutPaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      const focused = allPanes[focusedIndex]
      if (text && focused && focused.paneType === 'terminal' && terminalRefs.current[focused.id]) {
        terminalRefs.current[focused.id].sendInput(text)
      }
    } catch {}
  }, [allPanes, focusedIndex])

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

  // Render a pane header
  function renderPaneHeader(pane, index, isFocused) {
    const isFile = pane.paneType === 'file'
    const state = isFile ? null : (connectionStates[pane.id] || 'connecting')
    const isConfirmingDelete = !isFile && confirmDeleteId === pane.id

    return (
      <div
        className={`px-3 py-1 text-xs font-medium border-b select-none flex items-center justify-between transition-colors duration-150 ${
          isFocused
            ? 'text-base1 bg-blue/10 border-blue/50'
            : 'text-base01 bg-base02 border-base01/30'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {isFile ? (
            <span className="text-[10px] shrink-0">{'\u{1F4C4}'}</span>
          ) : (
            <span
              data-testid={`connection-dot-${index}`}
              className={`inline-block w-2 h-2 rounded-full shrink-0 ${connectionDotClasses(state)}`}
            />
          )}
          {editingId === pane.id ? (
            <input
              ref={editInputRef}
              data-testid={`pane-edit-${index}`}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveEdit(pane.id)
                if (e.key === 'Escape') handleCancelEdit()
              }}
              onBlur={() => handleSaveEdit(pane.id)}
              onClick={(e) => e.stopPropagation()}
              className="bg-base03 text-base1 text-xs px-1 py-0 rounded border border-blue/50 outline-none w-24"
            />
          ) : (
            <span
              className="truncate"
              title={isFile ? pane.filePath : pane.label}
              onDoubleClick={() => handleStartEdit(pane.id, pane.label)}
            >
              {pane.label}
            </span>
          )}
        </div>
        <button
          data-testid={`close-${isFile ? 'file' : 'terminal'}-${index}`}
          onClick={(e) => {
            e.stopPropagation()
            handleClosePane(pane)
          }}
          className="text-base01 hover:text-red text-xs ml-2 transition-colors"
          title={isConfirmingDelete ? 'Click again to confirm' : (isFile ? 'Close file' : 'Close terminal')}
        >
          {isConfirmingDelete ? 'Confirm?' : '\u00d7'}
        </button>
      </div>
    )
  }

  // Render pane content
  function renderPaneContent(pane, index, isFocused) {
    if (pane.paneType === 'file') {
      return (
        <div className="flex-1 min-h-0">
          <FileViewer
            token={token}
            slug={slug}
            filePath={pane.filePath}
            focused={isFocused}
            onFocus={() => setFocusedIndex(index)}
          />
        </div>
      )
    }
    return (
      <div className="flex-1 min-h-0">
        <Terminal
          ref={(r) => setTerminalRef(pane.id, r)}
          token={token}
          terminalId={pane.id}
          projectSlug={slug}
          focused={isFocused}
          onFocus={() => setFocusedIndex(index)}
          onConnectionStateChange={handleConnectionStateChange}
        />
      </div>
    )
  }

  return (
    <div data-testid="terminal-layout" data-slug={slug} className="flex flex-col w-full h-full animate-fade-in">
      {/* Layout toolbar */}
      <div className="flex items-center px-2 py-1 bg-base02 border-b border-base01/30">
        {effectiveLayout === 'tabs' && (
          <div className="flex gap-1 mr-2" data-testid="tab-bar">
            {allPanes.map((pane, index) => {
              const isActive = focusedIndex === index
              const isFile = pane.paneType === 'file'
              const state = isFile ? null : (connectionStates[pane.id] || 'connecting')
              return (
                <button
                  key={pane.id}
                  data-testid={`tab-${index}`}
                  onClick={() => setFocusedIndex(index)}
                  onDoubleClick={() => handleStartEdit(pane.id, pane.label)}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors flex items-center gap-1.5 ${
                    isActive
                      ? 'text-base1 bg-base03 border border-blue/50'
                      : 'text-base01 bg-base02 border border-base01/30 hover:text-base0'
                  }`}
                >
                  {isFile ? (
                    <span className="text-[10px] shrink-0">{'\u{1F4C4}'}</span>
                  ) : (
                    <span
                      data-testid={`connection-dot-${index}`}
                      className={`inline-block w-2 h-2 rounded-full shrink-0 ${connectionDotClasses(state)}`}
                    />
                  )}
                  {editingId === pane.id ? (
                    <input
                      ref={editInputRef}
                      data-testid={`tab-edit-${index}`}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit(pane.id)
                        if (e.key === 'Escape') handleCancelEdit()
                      }}
                      onBlur={() => handleSaveEdit(pane.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-base03 text-base1 text-xs px-1 py-0 rounded border border-blue/50 outline-none w-20"
                    />
                  ) : (
                    pane.label
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
          {!isMobile && effectiveLayout === 'split' && allPanes.length >= 2 && (
            <>
              <button
                data-testid="direction-toggle"
                onClick={toggleDirection}
                className="px-2 py-1 text-xs text-base01 hover:text-base0 border border-base01/30 rounded transition-colors"
                title={splitDirection === 'row' ? 'Stack vertically' : 'Split horizontally'}
              >
                {splitDirection === 'row' ? '\u2195' : '\u2194'}
              </button>
              <button
                data-testid="preset-equal"
                onClick={resetSizes}
                className="px-2 py-1 text-xs text-base01 hover:text-base0 border border-base01/30 rounded transition-colors"
                title="Equal split"
              >
                Equal
              </button>
              <button
                data-testid="preset-75-25"
                onClick={() => applyPreset(75)}
                className="px-2 py-1 text-xs text-base01 hover:text-base0 border border-base01/30 rounded transition-colors"
                title="75/25 split"
              >
                75/25
              </button>
              <button
                data-testid="preset-25-75"
                onClick={() => applyPreset(25)}
                className="px-2 py-1 text-xs text-base01 hover:text-base0 border border-base01/30 rounded transition-colors"
                title="25/75 split"
              >
                25/75
              </button>
            </>
          )}
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

      {/* Pane content */}
      {effectiveLayout === 'split' ? (
        <div
          key="split"
          ref={splitContainerRef}
          className={`flex ${splitDirection === 'row' ? 'flex-row' : 'flex-col'} flex-1 min-h-0 animate-fade-in`}
        >
          {(() => {
            const sizes = paneSizes && paneSizes.length === allPanes.length
              ? paneSizes
              : Array(allPanes.length).fill(100 / allPanes.length)
            const isRow = splitDirection === 'row'

            return allPanes.map((pane, index) => {
              const size = sizes[index]
              const isFocused = focusedIndex === index

              return (
                <Fragment key={pane.id}>
                  {index > 0 && (
                    <ResizeHandle
                      direction={isRow ? 'vertical' : 'horizontal'}
                      onDrag={(pos) => handleResizeDrag(index - 1, pos)}
                    />
                  )}
                  <div
                    data-testid={`terminal-pane-${index}`}
                    className={`flex flex-col overflow-hidden transition-opacity duration-150 ${
                      isFocused ? '' : 'opacity-60'
                    }`}
                    style={{
                      flexBasis: `${size}%`,
                      flexGrow: 0,
                      flexShrink: 1,
                      [isRow ? 'minWidth' : 'minHeight']: 0,
                    }}
                    onClick={() => handlePaneClick(index)}
                    onMouseDown={handlePaneMouseDown}
                    onDragOver={pane.paneType === 'terminal' ? handleFileDragOver : undefined}
                    onDrop={pane.paneType === 'terminal' ? (e) => handleFileDrop(e, index) : undefined}
                  >
                    {renderPaneHeader(pane, index, isFocused)}
                    {renderPaneContent(pane, index, isFocused)}
                  </div>
                </Fragment>
              )
            })
          })()}
        </div>
      ) : (
        <div key="tabs" className="flex-1 min-h-0 flex flex-col animate-fade-in" data-testid="tabbed-content">
          {allPanes.map((pane, index) => {
            const isActive = focusedIndex === index
            return (
              <div
                key={pane.id}
                data-testid={`terminal-pane-${index}`}
                className={`flex-1 min-h-0 flex flex-col ${isActive ? '' : 'hidden'}`}
                onDragOver={pane.paneType === 'terminal' ? handleFileDragOver : undefined}
                onDrop={pane.paneType === 'terminal' ? (e) => handleFileDrop(e, index) : undefined}
              >
                {renderPaneHeader(pane, index, true)}
                {renderPaneContent(pane, index, isActive)}
              </div>
            )
          })}
        </div>
      )}

      {/* Tablet shortcut bar toggle + bar */}
      {isTablet && (
        <div className="shrink-0">
          {showTabletShortcuts ? (
            <div className="flex items-center">
              <div className="flex-1 min-w-0">
                <ShortcutBar onSend={handleShortcutSend} onPaste={handleShortcutPaste} />
              </div>
              <button
                data-testid="tablet-shortcut-toggle"
                onClick={() => setShowTabletShortcuts(false)}
                className="shrink-0 px-2 py-1 text-xs text-base01 hover:text-base0 border-t border-l border-base01/30 bg-base02"
                style={{ minHeight: '44px' }}
              >
                Hide
              </button>
            </div>
          ) : (
            <div className="flex justify-end px-2 py-1 bg-base02 border-t border-base01/30">
              <button
                data-testid="tablet-shortcut-toggle"
                onClick={() => setShowTabletShortcuts(true)}
                className="px-3 py-1 text-xs text-base01 hover:text-base0 border border-base01/30 rounded"
                style={{ minHeight: '44px' }}
              >
                Shortcuts
              </button>
            </div>
          )}
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
})

export default TerminalLayout
