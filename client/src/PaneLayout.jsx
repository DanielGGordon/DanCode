import { useState, useCallback, useEffect, useRef } from 'react'
import Terminal from './Terminal.jsx'

export const ALL_PANES = [
  { index: 0, label: 'CLI' },
  { index: 1, label: 'Claude' },
  { index: 2, label: 'Ralph' },
]

export const MOBILE_BREAKPOINT = 768

export default function PaneLayout({ token, slug, panes: panesProp }) {
  const [fetchedPanes, setFetchedPanes] = useState(null)
  const [focusedPane, setFocusedPane] = useState(0)
  const [layoutMode, setLayoutMode] = useState('split')
  const [hiddenPanes, setHiddenPanes] = useState(new Set())
  const [showTmuxBar, setShowTmuxBar] = useState(false)
  const [tmuxSessionName, setTmuxSessionName] = useState(null)
  const [loading, setLoading] = useState(!panesProp)
  const [fetchError, setFetchError] = useState(null)
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
  )
  const loadedRef = useRef(false)
  const saveTimerRef = useRef(null)

  const [fetchAttempt, setFetchAttempt] = useState(0)
  const panes = panesProp || fetchedPanes || ALL_PANES

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

  // Load saved layout preferences and panes from project config
  useEffect(() => {
    if (!slug || !token) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(!panesProp)
    setFetchError(null)
    fetch(`/api/projects/${slug}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load project (${res.status})`)
        return res.json()
      })
      .then(async (project) => {
        if (cancelled || !project) return
        if (project.tmuxSession) {
          setTmuxSessionName(project.tmuxSession)
        }
        if (typeof project.showTmuxCommands === 'boolean') {
          setShowTmuxBar(project.showTmuxCommands)
        }
        if (project.layout) {
          if (project.layout.mode === 'split' || project.layout.mode === 'tabs') {
            setLayoutMode(project.layout.mode)
          }
          if (Array.isArray(project.layout.hiddenPanes)) {
            setHiddenPanes(new Set(project.layout.hiddenPanes))
          }
        }
        // Fetch actual panes from the server for all projects
        if (!panesProp) {
          try {
            const panesRes = await fetch(`/api/projects/${slug}/panes`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (cancelled) return
            if (panesRes.ok) {
              const data = await panesRes.json()
              if (!cancelled && Array.isArray(data) && data.length > 0) {
                setFetchedPanes(data)
                setFocusedPane(data[0].index)
              }
            }
          } catch {}
        }
      })
      .catch((err) => {
        if (!cancelled && !panesProp) {
          setFetchError(err.message || 'Failed to load project configuration')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
          setTimeout(() => { loadedRef.current = true }, 0)
        }
      })
    return () => { cancelled = true }
  }, [slug, token, panesProp, fetchAttempt])

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
          layout: { mode: layoutMode, hiddenPanes: [...hiddenPanes] },
          showTmuxCommands: showTmuxBar,
        }),
      }).catch(() => {})
    }, 300)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [layoutMode, hiddenPanes, showTmuxBar, slug, token])

  const effectiveLayout = isMobile ? 'tabs' : layoutMode

  const visiblePanes = panes.filter(({ index }) => !hiddenPanes.has(index))

  // If focused pane becomes hidden, switch focus to first visible pane
  useEffect(() => {
    if (hiddenPanes.has(focusedPane) && visiblePanes.length > 0) {
      setFocusedPane(visiblePanes[0].index)
    }
  }, [hiddenPanes, focusedPane, visiblePanes])

  const handlePaneClick = useCallback((index) => {
    setFocusedPane(index)
  }, [])

  const toggleLayout = useCallback(() => {
    setLayoutMode((prev) => (prev === 'split' ? 'tabs' : 'split'))
  }, [])

  const togglePaneVisibility = useCallback((index) => {
    setHiddenPanes((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
        return next
      }
      // Don't hide if it's the last visible pane
      const visibleCount = panes.length - next.size
      if (visibleCount <= 1) return prev
      next.add(index)
      return next
    })
  }, [panes])

  if (loading) {
    return (
      <div data-testid="pane-layout" className="flex flex-col w-full h-full">
        <div data-testid="pane-loading" className="flex flex-col items-center justify-center flex-1 gap-3">
          <div className="w-6 h-6 border-2 border-base01/30 border-t-blue rounded-full animate-spin" />
          <span className="text-xs text-base01">Loading project…</span>
        </div>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div data-testid="pane-layout" className="flex flex-col w-full h-full">
        <div data-testid="pane-fetch-error" className="flex items-center justify-center flex-1 p-6">
          <div className="flex flex-col items-center gap-3 p-6 rounded-lg bg-base02 border border-base01/30 shadow-lg max-w-sm text-center">
            <div className="text-red text-lg font-semibold">Failed to Load Project</div>
            <p className="text-base0 text-sm">{fetchError}</p>
            <button
              data-testid="pane-retry-button"
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
    <div data-testid="pane-layout" className="flex flex-col w-full h-full animate-fade-in">
      {/* Layout toolbar */}
      <div className="flex items-center px-2 py-1 bg-base02 border-b border-base01/30">
        {effectiveLayout === 'tabs' && (
          <div className="flex gap-1 mr-2" data-testid="tab-bar">
            {visiblePanes.map(({ index, label }) => {
              const isActive = focusedPane === index
              return (
                <button
                  key={index}
                  data-testid={`tab-${index}`}
                  onClick={() => setFocusedPane(index)}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    isActive
                      ? 'text-base1 bg-base03 border border-blue/50'
                      : 'text-base01 bg-base02 border border-base01/30 hover:text-base0'
                  }`}
                >
                  {label}
                  {showTmuxBar && (
                    <code
                      data-testid={`pane-tmux-hint-${index}`}
                      className="text-base01 font-mono ml-2"
                    >
                      Ctrl+B, {index}
                    </code>
                  )}
                </button>
              )
            })}
          </div>
        )}
        <div className="flex gap-1 mr-2" data-testid="visibility-toggles">
          {panes.map(({ index, label }) => {
            const isVisible = !hiddenPanes.has(index)
            const isLastVisible = isVisible && visiblePanes.length <= 1
            return (
              <button
                key={index}
                data-testid={`visibility-${index}`}
                onClick={() => togglePaneVisibility(index)}
                disabled={isLastVisible}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  isVisible
                    ? 'text-base1 bg-base03 border border-blue/50'
                    : 'text-base01 bg-base02 border border-base01/30 hover:text-base0'
                } ${isLastVisible ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {label}
              </button>
            )
          })}
        </div>
        <div className="flex gap-1 ml-auto">
          <button
            data-testid="tmux-bar-toggle"
            onClick={() => setShowTmuxBar((prev) => !prev)}
            className={`px-2 py-1 text-xs border rounded transition-colors ${
              showTmuxBar
                ? 'text-base1 bg-base03 border-blue/50'
                : 'text-base01 border-base01/30 hover:text-base0'
            }`}
          >
            tmux
          </button>
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

      {/* Tmux attach command bar */}
      {showTmuxBar && (
        <div
          data-testid="tmux-bar"
          className="flex items-center px-3 py-1.5 bg-base03 border-b border-base01/30 text-xs transition-all duration-150"
        >
          <span className="text-base01 mr-2">$</span>
          <code className="text-green font-mono select-all">
            tmux attach -t {tmuxSessionName || `dancode-${slug}`}
          </code>
        </div>
      )}

      {/* Pane content */}
      {effectiveLayout === 'split' ? (
        <div key="split" className="flex flex-row flex-1 min-h-0 animate-fade-in">
          {panes.map(({ index, label }) => {
            const isFocused = focusedPane === index
            const isHidden = hiddenPanes.has(index)
            return (
              <div
                key={index}
                data-testid={`pane-${index}`}
                className={`flex-1 min-w-0 flex flex-col border-r last:border-r-0 transition-[border-color] duration-150 ${
                  isFocused ? 'border-blue/50' : 'border-base01/30'
                } ${isHidden ? 'hidden' : ''}`}
                onClick={() => handlePaneClick(index)}
              >
                <div
                  className={`px-3 py-1 text-xs font-medium border-b select-none flex items-center justify-between transition-colors duration-150 ${
                    isFocused
                      ? 'text-base1 bg-base02 border-blue/50'
                      : 'text-base01 bg-base02 border-base01/30'
                  }`}
                >
                  <span>{label}</span>
                  {showTmuxBar && (
                    <code
                      data-testid={`pane-tmux-hint-${index}`}
                      className="text-base01 font-mono ml-2"
                    >
                      Ctrl+B, {index}
                    </code>
                  )}
                </div>
                <div className="flex-1 min-h-0">
                  <Terminal
                    token={token}
                    slug={slug}
                    pane={index}
                    focused={isFocused}
                    onFocus={() => setFocusedPane(index)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div key="tabs" className="flex-1 min-h-0 flex flex-col animate-fade-in" data-testid="tabbed-content">
          {panes.map(({ index, label }) => {
            const isActive = focusedPane === index
            const isHidden = hiddenPanes.has(index)
            return (
              <div
                key={index}
                data-testid={`pane-${index}`}
                className={`flex-1 min-h-0 flex flex-col ${isActive && !isHidden ? '' : 'hidden'}`}
              >
                <Terminal
                  token={token}
                  slug={slug}
                  pane={index}
                  focused={isActive}
                  onFocus={() => setFocusedPane(index)}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
