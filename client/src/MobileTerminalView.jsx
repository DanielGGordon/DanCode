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
 * - Shortcut bar hides when keyboard is dismissed
 *
 * Props:
 *   token         — auth token
 *   terminal      — { id, label } terminal metadata
 *   projectSlug   — project slug for terminal
 *   onBack        — callback to return to dashboard/project view
 *   terminals     — array of all terminals for tab switching
 *   onSwitchTerminal — callback(terminalId) to switch active terminal
 */
export default function MobileTerminalView({
  token,
  terminal,
  projectSlug,
  onBack,
  terminals = [],
  onSwitchTerminal,
}) {
  const [inputMode, setInputMode] = useState(false)
  const [connectionState, setConnectionState] = useState('connecting')
  const terminalRef = useRef(null)
  const containerRef = useRef(null)

  // Track keyboard visibility via visualViewport resize
  useEffect(() => {
    if (!window.visualViewport) return

    const handleResize = () => {
      // Keyboard shown when visual viewport height is significantly less than window height
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
    // Focus the terminal to trigger soft keyboard
    if (terminalRef.current) {
      terminalRef.current.focus()
    }
  }, [])

  const handleConnectionStateChange = useCallback((_id, state) => {
    setConnectionState(state)
  }, [])

  // Send a key sequence to the terminal
  const handleShortcutSend = useCallback((seq) => {
    if (terminalRef.current) {
      terminalRef.current.sendInput(seq)
    }
  }, [])

  // Handle paste shortcut
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && terminalRef.current) {
        terminalRef.current.sendInput(text)
      }
    } catch {
      // Clipboard API not available or denied — ignore
    }
  }, [])

  return (
    <div
      data-testid="mobile-terminal-view"
      className="fixed inset-0 flex flex-col bg-base03 z-40"
      ref={containerRef}
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

      {/* Shortcut bar — only visible in input mode */}
      {inputMode && (
        <ShortcutBar
          onSend={handleShortcutSend}
          onPaste={handlePaste}
        />
      )}
    </div>
  )
}
