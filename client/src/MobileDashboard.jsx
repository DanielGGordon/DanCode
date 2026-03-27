import { useState, useRef, useCallback, useEffect } from 'react'

/**
 * MobileDashboard — project card grid for mobile devices.
 *
 * - Tap a project card to open its terminal view
 * - Long-press (500ms) a project card for quick actions:
 *   "Open CLI Terminal" and "Open Claude Terminal"
 * - "New Project" button at the top
 */

const LONG_PRESS_MS = 500

export default function MobileDashboard({
  projects,
  onSelectProject,
  onQuickAction,
  onNewProject,
  onLogout,
}) {
  const [quickMenu, setQuickMenu] = useState(null) // { slug, x, y }
  const longPressTimer = useRef(null)
  const longPressTriggered = useRef(false)
  const menuRef = useRef(null)

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

      {/* Project cards */}
      <div className="flex-1 overflow-y-auto p-4">
        {(!projects || projects.length === 0) ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-base01 text-sm">No projects yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            {projects.map((p) => (
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
                <div className="text-sm font-medium text-base1 truncate">{p.name || p.slug}</div>
                <div className="text-xs text-base01 mt-1 truncate">{p.path || p.slug}</div>
              </div>
            ))}
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
