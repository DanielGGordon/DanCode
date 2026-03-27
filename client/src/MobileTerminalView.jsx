import { useState, useEffect, useCallback, useRef } from 'react'
import Terminal from './Terminal.jsx'
import ShortcutBar from './ShortcutBar.jsx'

/**
 * MobileTerminalView — full-screen mobile terminal experience.
 *
 * Design principles:
 * - Read-first: soft keyboard hidden by default, terminal output scrollable
 * - Thin top bar with back button and terminal label (no sidebar, no header)
 * - Tap terminal area or keyboard icon to enter input mode (show keyboard)
 * - Shortcut bar appears above keyboard when in input mode
 * - Swipe left/right between terminals within the same project
 * - Dot indicators show which terminal is active
 * - Swipe from left edge opens project drawer
 *
 * Props:
 *   token         — auth token
 *   terminal      — { id, label } terminal metadata
 *   projectSlug   — project slug for terminal
 *   onBack        — callback to return to terminal list
 *   terminals     — array of all terminals for tab/swipe switching
 *   onSwitchTerminal — callback(terminalId) to switch active terminal
 *   projects      — array of all projects (for project drawer)
 *   onSwitchProject — callback(slug) to switch project from drawer
 */

const SWIPE_THRESHOLD = 50
const EDGE_ZONE = 30

export default function MobileTerminalView({
  token,
  terminal,
  projectSlug,
  onBack,
  terminals = [],
  onSwitchTerminal,
  projects = [],
  onSwitchProject,
}) {
  const [inputMode, setInputMode] = useState(false)
  const [connectionState, setConnectionState] = useState('connecting')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const terminalRef = useRef(null)
  const containerRef = useRef(null)
  const swipeStartRef = useRef(null)
  const swipeEdgeRef = useRef(false)

  // Track keyboard visibility via visualViewport resize
  useEffect(() => {
    if (!window.visualViewport) return

    const handleResize = () => {
      const keyboardVisible = window.visualViewport.height < window.innerHeight * 0.75
      if (!keyboardVisible && inputMode) {
        setInputMode(false)
      }
    }

    window.visualViewport.addEventListener('resize', handleResize)
    return () => window.visualViewport.removeEventListener('resize', handleResize)
  }, [inputMode])

  const handleEnterInputMode = useCallback(() => {
    setInputMode(true)
    if (terminalRef.current) {
      terminalRef.current.focus()
    }
  }, [])

  const handleConnectionStateChange = useCallback((_id, state) => {
    setConnectionState(state)
  }, [])

  const handleShortcutSend = useCallback((seq) => {
    if (terminalRef.current) {
      terminalRef.current.sendInput(seq)
    }
  }, [])

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && terminalRef.current) {
        terminalRef.current.sendInput(text)
      }
    } catch {
      // Clipboard API not available or denied
    }
  }, [])

  // Swipe gesture handlers for terminal switching and project drawer
  const handleTouchStart = useCallback((e) => {
    const touch = e.touches[0]
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY }
    swipeEdgeRef.current = touch.clientX < EDGE_ZONE
  }, [])

  const handleTouchEnd = useCallback((e) => {
    if (!swipeStartRef.current) return
    const touch = e.changedTouches[0]
    const dx = touch.clientX - swipeStartRef.current.x
    const dy = touch.clientY - swipeStartRef.current.y

    // Only process horizontal swipes (more horizontal than vertical)
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dy) > Math.abs(dx)) {
      swipeStartRef.current = null
      return
    }

    // Swipe from left edge opens project drawer
    if (swipeEdgeRef.current && dx > 0) {
      setDrawerOpen(true)
      swipeStartRef.current = null
      return
    }

    // Swipe between terminals
    if (terminals.length > 1 && onSwitchTerminal) {
      const currentIdx = terminals.findIndex((t) => t.id === terminal.id)
      if (dx < -SWIPE_THRESHOLD && currentIdx < terminals.length - 1) {
        // Swipe left → next terminal
        onSwitchTerminal(terminals[currentIdx + 1].id)
      } else if (dx > SWIPE_THRESHOLD && currentIdx > 0) {
        // Swipe right → previous terminal
        onSwitchTerminal(terminals[currentIdx - 1].id)
      }
    }

    swipeStartRef.current = null
  }, [terminals, terminal, onSwitchTerminal])

  const currentIdx = terminals.findIndex((t) => t.id === terminal.id)

  return (
    <div
      data-testid="mobile-terminal-view"
      className="fixed inset-0 flex flex-col bg-base03 z-40"
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Thin top bar */}
      <div
        data-testid="mobile-top-bar"
        className="flex items-center px-2 py-1.5 bg-base02 border-b border-base01/30 shrink-0"
      >
        <button
          data-testid="mobile-back-button"
          onClick={onBack}
          className="px-2 py-1 text-sm text-blue hover:text-blue/80 transition-colors"
          style={{ minWidth: '44px', minHeight: '44px', touchAction: 'manipulation' }}
        >
          &#8592; Back
        </button>

        {/* Tab strip for multiple terminals */}
        {terminals.length > 1 ? (
          <div className="flex gap-1 mx-2 overflow-x-auto flex-1 min-w-0" data-testid="mobile-tab-strip">
            {terminals.map((t) => (
              <button
                key={t.id}
                data-testid={`mobile-tab-${t.id}`}
                onClick={() => onSwitchTerminal?.(t.id)}
                className={`shrink-0 px-2 py-1 text-xs font-medium rounded transition-colors ${
                  t.id === terminal.id
                    ? 'text-base1 bg-base03 border border-blue/50'
                    : 'text-base01 border border-base01/30'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : (
          <span data-testid="mobile-terminal-label" className="text-xs font-medium text-base1 ml-2 truncate flex-1">
            {terminal.label}
          </span>
        )}

        {/* Keyboard toggle button */}
        <button
          data-testid="keyboard-toggle"
          onClick={handleEnterInputMode}
          className={`shrink-0 px-2 py-1 text-sm rounded transition-colors ${
            inputMode
              ? 'text-blue bg-blue/10 border border-blue/50'
              : 'text-base01 hover:text-base0 border border-base01/30'
          }`}
          style={{ minWidth: '44px', minHeight: '44px', touchAction: 'manipulation' }}
          title="Toggle keyboard"
        >
          &#9000;
        </button>
      </div>

      {/* Terminal area — takes remaining space */}
      <div
        className="flex-1 min-h-0"
        onClick={handleEnterInputMode}
        data-testid="mobile-terminal-area"
      >
        <Terminal
          ref={terminalRef}
          token={token}
          terminalId={terminal.id}
          projectSlug={projectSlug}
          focused={inputMode}
          readFirst={!inputMode}
          onFocus={() => setInputMode(true)}
          onConnectionStateChange={handleConnectionStateChange}
        />
      </div>

      {/* Dot indicators for terminal pagination */}
      {terminals.length > 1 && (
        <div data-testid="dot-indicators" className="flex justify-center gap-2 py-2 bg-base02 border-t border-base01/30">
          {terminals.map((t, i) => (
            <button
              key={t.id}
              data-testid={`dot-${i}`}
              onClick={() => onSwitchTerminal?.(t.id)}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                i === currentIdx ? 'bg-blue' : 'bg-base01/50'
              }`}
              aria-label={`Terminal ${i + 1}: ${t.label}`}
            />
          ))}
        </div>
      )}

      {/* Shortcut bar — only visible in input mode */}
      {inputMode && (
        <ShortcutBar
          onSend={handleShortcutSend}
          onPaste={handlePaste}
        />
      )}

      {/* Project drawer overlay */}
      {drawerOpen && (
        <div
          data-testid="project-drawer-overlay"
          className="fixed inset-0 z-50 flex"
          onClick={() => setDrawerOpen(false)}
        >
          <div
            data-testid="project-drawer"
            className="w-64 h-full bg-base02 border-r border-base01/30 shadow-lg overflow-y-auto animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-base01/30">
              <h2 className="text-sm font-medium text-base1">Projects</h2>
            </div>
            <div className="py-2">
              {projects.map((p) => (
                <button
                  key={p.slug}
                  data-testid={`drawer-project-${p.slug}`}
                  onClick={() => {
                    setDrawerOpen(false)
                    onSwitchProject?.(p.slug)
                  }}
                  className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                    p.slug === projectSlug
                      ? 'text-base1 bg-base03/50 font-medium'
                      : 'text-base0 hover:bg-base03/30'
                  }`}
                  style={{ minHeight: '44px' }}
                >
                  {p.name || p.slug}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1" />
        </div>
      )}
    </div>
  )
}
