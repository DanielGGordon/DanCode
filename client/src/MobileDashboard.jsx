import { useState, useRef, useCallback, useEffect } from 'react'

/**
 * MobileDashboard — project card grid for mobile devices.
 *
 * - Tap a project card to see its terminals listed
 * - Long-press (500ms) a project card for quick actions:
 *   "Open CLI Terminal" and "Open Claude Terminal"
 * - "New Project" button at the top
 * - Activity indicators based on lastActivity timestamps
 * - Pull-to-refresh to update activity status
 */

const LONG_PRESS_MS = 500
const ACTIVE_THRESHOLD_MS = 60 * 1000 // 60 seconds

function isActive(lastActivity) {
  if (!lastActivity) return false
  return Date.now() - new Date(lastActivity).getTime() < ACTIVE_THRESHOLD_MS
}

function timeAgo(isoString) {
  if (!isoString) return 'no activity'
  const diff = Date.now() - new Date(isoString).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

const POLL_INTERVAL_MS = 30000

export default function MobileDashboard({
  projects,
  projectTerminals,
  onSelectProject,
  onQuickAction,
  onNewProject,
  onLogout,
  onRefresh,
}) {
  const [quickMenu, setQuickMenu] = useState(null) // { slug, x, y }
  const [refreshing, setRefreshing] = useState(false)
  const longPressTimer = useRef(null)
  const longPressTriggered = useRef(false)
  const menuRef = useRef(null)
  const scrollRef = useRef(null)
  const pullStartY = useRef(null)
  const [pullDistance, setPullDistance] = useState(0)
  const pollIntervalRef = useRef(null)

  // Visibility-aware polling: pause when tab is hidden, resume when visible
  useEffect(() => {
    function startPolling() {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = setInterval(() => {
        onRefresh?.()
      }, POLL_INTERVAL_MS)
    }

    function stopPolling() {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        stopPolling()
      } else {
        onRefresh?.()
        startPolling()
      }
    }

    // Start polling initially (only if visible)
    if (document.visibilityState !== 'hidden') {
      startPolling()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stopPolling()
    }
  }, [onRefresh])

  // Close quick menu on outside tap
  useEffect(() => {
    if (!quickMenu) return
    const handleOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setQuickMenu(null)
      }
    }
    document.addEventListener('touchstart', handleOutside)
    document.addEventListener('mousedown', handleOutside)
    return () => {
      document.removeEventListener('touchstart', handleOutside)
      document.removeEventListener('mousedown', handleOutside)
    }
  }, [quickMenu])

  const handleTouchStart = useCallback((e, slug) => {
    longPressTriggered.current = false
    const touch = e.touches[0]
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true
      setQuickMenu({ slug, x: touch.clientX, y: touch.clientY })
    }, LONG_PRESS_MS)
  }, [])

  const handleTouchEnd = useCallback((slug) => {
    clearTimeout(longPressTimer.current)
    if (!longPressTriggered.current) {
      onSelectProject?.(slug)
    }
  }, [onSelectProject])

  const handleTouchMove = useCallback(() => {
    clearTimeout(longPressTimer.current)
  }, [])

  const handleQuickAction = useCallback((slug, action) => {
    setQuickMenu(null)
    onQuickAction?.(slug, action)
  }, [onQuickAction])

  // Pull-to-refresh handlers
  const handlePullStart = useCallback((e) => {
    if (scrollRef.current && scrollRef.current.scrollTop <= 0) {
      pullStartY.current = e.touches[0].clientY
    }
  }, [])

  const handlePullMove = useCallback((e) => {
    if (pullStartY.current === null) return
    const dy = e.touches[0].clientY - pullStartY.current
    if (dy > 0 && scrollRef.current && scrollRef.current.scrollTop <= 0) {
      setPullDistance(Math.min(dy * 0.5, 80))
      if (dy > 20) e.preventDefault()
    }
  }, [])

  const handlePullEnd = useCallback(async () => {
    if (pullDistance > 50 && onRefresh) {
      setRefreshing(true)
      try {
        await onRefresh()
      } finally {
        setRefreshing(false)
      }
    }
    setPullDistance(0)
    pullStartY.current = null
  }, [pullDistance, onRefresh])

  // Find the most recent activity across all terminals for a project
  function getProjectActivity(slug) {
    const terms = projectTerminals?.[slug]
    if (!terms || terms.length === 0) return null
    let latest = null
    for (const t of terms) {
      if (t.lastActivity && (!latest || new Date(t.lastActivity) > new Date(latest))) {
        latest = t.lastActivity
      }
    }
    return latest
  }

  function getProjectTerminalLabels(slug) {
    const terms = projectTerminals?.[slug]
    if (!terms) return []
    return terms.map((t) => ({ label: t.label, active: isActive(t.lastActivity) }))
  }

  return (
    <div data-testid="mobile-dashboard" className="flex flex-col h-full bg-base03">
      {/* Header */}
      <div className="flex items-center px-4 py-3 bg-base02 border-b border-base01/30">
        <h1 className="text-base font-medium text-base1">DanCode</h1>
        <button
          data-testid="mobile-new-project"
          onClick={onNewProject}
          className="ml-auto px-3 py-1.5 text-xs font-medium text-blue border border-blue/50 rounded"
          style={{ minHeight: '44px', touchAction: 'manipulation' }}
        >
          + New Project
        </button>
        <button
          data-testid="mobile-logout"
          onClick={onLogout}
          className="ml-2 px-3 py-1.5 text-xs text-base01 hover:text-base0"
          style={{ minHeight: '44px', touchAction: 'manipulation' }}
        >
          Logout
        </button>
      </div>

      {/* Pull-to-refresh indicator */}
      {(pullDistance > 0 || refreshing) && (
        <div
          data-testid="pull-to-refresh-indicator"
          className="flex items-center justify-center bg-base02 text-base01 text-xs transition-all"
          style={{ height: refreshing ? 40 : pullDistance }}
        >
          {refreshing ? 'Refreshing...' : pullDistance > 50 ? 'Release to refresh' : 'Pull to refresh'}
        </div>
      )}

      {/* Project cards */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4"
        onTouchStart={handlePullStart}
        onTouchMove={handlePullMove}
        onTouchEnd={handlePullEnd}
      >
        {(!projects || projects.length === 0) ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-base01 text-sm">No projects yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            {projects.map((p) => {
              const latestActivity = getProjectActivity(p.slug)
              const active = isActive(latestActivity)
              const termLabels = getProjectTerminalLabels(p.slug)

              return (
                <div
                  key={p.slug}
                  data-testid={`project-card-${p.slug}`}
                  className="bg-base02 border border-base01/30 rounded-lg p-4 cursor-pointer active:bg-base03 transition-colors select-none"
                  onTouchStart={(e) => handleTouchStart(e, p.slug)}
                  onTouchEnd={() => handleTouchEnd(p.slug)}
                  onTouchMove={handleTouchMove}
                  onClick={() => {
                    if (!longPressTriggered.current) onSelectProject?.(p.slug)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setQuickMenu({ slug: p.slug, x: e.clientX, y: e.clientY })
                  }}
                >
                  <div className="flex items-center gap-2">
                    <div
                      data-testid={`activity-indicator-${p.slug}`}
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        active ? 'bg-green animate-pulse-dot' : 'bg-base01'
                      }`}
                      title={active ? 'Active' : 'Idle'}
                    />
                    <div className="text-sm font-medium text-base1 truncate">{p.name || p.slug}</div>
                  </div>
                  <div className="text-xs text-base01 mt-1 truncate">{p.path || p.slug}</div>
                  {/* Terminal labels */}
                  {termLabels.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {termLabels.map((t, i) => (
                        <span
                          key={i}
                          data-testid={`terminal-label-${p.slug}-${i}`}
                          className={`text-xs px-1.5 py-0.5 rounded ${
                            t.active ? 'bg-green/20 text-green' : 'bg-base01/20 text-base01'
                          }`}
                        >
                          {t.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Last activity timestamp */}
                  {latestActivity && (
                    <div data-testid={`last-activity-${p.slug}`} className="text-xs text-base01/70 mt-1">
                      {timeAgo(latestActivity)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Long-press quick action menu */}
      {quickMenu && (
        <div
          ref={menuRef}
          data-testid="quick-action-menu"
          className="fixed z-50 min-w-48 bg-base02 border border-base01/30 rounded-lg shadow-lg py-1"
          style={{
            left: Math.min(quickMenu.x, window.innerWidth - 200),
            top: Math.min(quickMenu.y, window.innerHeight - 120),
          }}
        >
          <button
            data-testid="quick-action-cli"
            onClick={() => handleQuickAction(quickMenu.slug, 'cli')}
            className="w-full text-left px-4 py-3 text-sm text-base0 hover:bg-base03/50 hover:text-base1 transition-colors"
            style={{ minHeight: '44px' }}
          >
            Open CLI Terminal
          </button>
          <div className="border-t border-base01/30" />
          <button
            data-testid="quick-action-claude"
            onClick={() => handleQuickAction(quickMenu.slug, 'claude')}
            className="w-full text-left px-4 py-3 text-sm text-base0 hover:bg-base03/50 hover:text-base1 transition-colors"
            style={{ minHeight: '44px' }}
          >
            Open Claude Terminal
          </button>
        </div>
      )}
    </div>
  )
}
