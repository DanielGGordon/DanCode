/**
 * MobileTerminalList — shows all terminals for a selected project.
 *
 * - Tap a terminal to enter full-screen terminal view
 * - Back button returns to dashboard
 * - Activity indicator per terminal (active/idle)
 * - Shows terminal label and last activity time
 */

const ACTIVE_THRESHOLD_MS = 60 * 1000

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

export default function MobileTerminalList({
  projectName,
  terminals,
  onSelectTerminal,
  onBack,
}) {
  return (
    <div data-testid="mobile-terminal-list" className="flex flex-col h-full bg-base03">
      {/* Header */}
      <div className="flex items-center px-2 py-2 bg-base02 border-b border-base01/30">
        <button
          data-testid="terminal-list-back"
          onClick={onBack}
          className="px-2 py-1 text-sm text-blue hover:text-blue/80 transition-colors"
          style={{ minWidth: '44px', minHeight: '44px', touchAction: 'manipulation' }}
        >
          &#8592; Back
        </button>
        <h2 className="text-sm font-medium text-base1 ml-2 truncate">{projectName || 'Terminals'}</h2>
      </div>

      {/* Terminal list */}
      <div className="flex-1 overflow-y-auto p-4">
        {(!terminals || terminals.length === 0) ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-base01 text-sm">No terminals found for this project.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {terminals.map((t) => {
              const active = isActive(t.lastActivity)
              return (
                <button
                  key={t.id}
                  data-testid={`terminal-item-${t.id}`}
                  onClick={() => onSelectTerminal?.(t)}
                  className="bg-base02 border border-base01/30 rounded-lg p-4 text-left cursor-pointer active:bg-base03 transition-colors"
                  style={{ minHeight: '44px', touchAction: 'manipulation' }}
                >
                  <div className="flex items-center gap-2">
                    <div
                      data-testid={`terminal-activity-${t.id}`}
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        active ? 'bg-green animate-pulse-dot' : 'bg-base01'
                      }`}
                    />
                    <span className="text-sm font-medium text-base1">{t.label}</span>
                    <span className="text-xs text-base01 ml-auto">{timeAgo(t.lastActivity)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
