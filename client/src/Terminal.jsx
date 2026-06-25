import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { io } from 'socket.io-client'
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  readTerminalFontSize,
  writeTerminalFontSize,
  stepZoom,
} from './terminalZoom.js'

// xterm.js is dynamically imported on first use for code splitting
let xtermCache = null
export function loadXterm() {
  if (xtermCache) return Promise.resolve(xtermCache)
  return Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
    import('@xterm/xterm/css/xterm.css'),
  ]).then(([xtermMod, fitMod]) => {
    xtermCache = { XTerm: xtermMod.Terminal, FitAddon: fitMod.FitAddon }
    return xtermCache
  })
}

// Maps a (ctrl|meta)+key combo to a zoom action, or null if not a zoom key.
function zoomActionFromKey(e) {
  if (!(e.ctrlKey || e.metaKey)) return null
  if (e.key === '=' || e.key === '+') return 'in'
  if (e.key === '-' || e.key === '_') return 'out'
  if (e.key === '0') return 'reset'
  return null
}

/**
 * Connection state values:
 * - 'connecting': socket is being established
 * - 'connected': socket connected and receiving data
 * - 'reconnecting': auto-reconnecting after disconnect (up to 30s)
 * - 'disconnected': reconnection failed after 30s timeout
 * - 'session-exit': PTY process exited
 */

const DEFAULT_FONT_SIZE = DEFAULT_TERMINAL_FONT_SIZE
const MIN_FONT_SIZE = MIN_TERMINAL_FONT_SIZE
const MAX_FONT_SIZE = MAX_TERMINAL_FONT_SIZE
const RECONNECT_TIMEOUT_MS = 30000

// Synchronous copy that works in user-gesture handlers even on
// non-secure origins (plain http on a public IP). Tries the modern
// async navigator.clipboard first when available, but falls back to
// a hidden-textarea + execCommand so we still copy reliably from
// http://<lan-or-public-ip>/. The execCommand path is the load-bearing
// one for Claude-session selections inside an alt-screen buffer where
// the mouse-tracking + redraw cycle keeps wiping the visible selection.
function copyToClipboardSync(text) {
  if (!text) return false
  // Try the async API but DON'T await it — we still want the synchronous
  // fallback to run inside the same gesture so at least one path wins.
  try { navigator.clipboard?.writeText?.(text) } catch {}
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none'
  document.body.appendChild(textarea)
  const prevActive = document.activeElement
  textarea.focus()
  textarea.select()
  let ok = false
  try { ok = document.execCommand('copy') } catch {}
  document.body.removeChild(textarea)
  if (prevActive && typeof prevActive.focus === 'function') prevActive.focus()
  return ok
}
// Kept for backward-compat with existing call sites.
const fallbackCopy = (text) => copyToClipboardSync(text)

// Wrap-aware selection text. xterm.getSelection() returns one \n per visible
// row, which mangles copies from width-wrapped output (Claude messages,
// long logs) by injecting newlines and trailing whitespace at the wrap
// columns. We walk the buffer range and only emit \n when the next row
// is NOT a continuation (isWrapped=false), then trim trailing whitespace
// from each logical line.
export function getSelectionText(term) {
  if (!term) return ''
  const pos = typeof term.getSelectionPosition === 'function' ? term.getSelectionPosition() : null
  const raw = term.getSelection ? term.getSelection() : ''
  const buf = term.buffer?.active
  if (!pos || !buf) return raw
  const { start, end } = pos
  let out = ''
  for (let y = start.y; y <= end.y; y++) {
    const line = buf.getLine(y)
    if (!line) continue
    const lineLen = line.length
    const startCol = y === start.y ? start.x : 0
    const endCol = y === end.y ? end.x : lineLen
    let text
    try {
      text = line.translateToString(false, startCol, endCol)
    } catch {
      text = ''
    }
    out += text
    if (y < end.y) {
      const next = buf.getLine(y + 1)
      // Only insert a newline when the next row is a *fresh* logical line.
      if (!next || !next.isWrapped) out += '\n'
    }
  }
  return out
    .split('\n')
    .map((l) => l.replace(/[  ]+$/, ''))
    .join('\n')
}

const Terminal = forwardRef(function Terminal({
  token,
  terminalId,
  projectSlug,
  focused,
  readFirst,
  onFocus,
  onConnectionStateChange,
  claudeSessionId,
  claudeActive,
}, ref) {
  const containerRef = useRef(null)
  const termRef = useRef(null)
  const fitAddonRef = useRef(null)
  const socketRef = useRef(null)
  // Restore the persisted per-terminal font size on mount (falls back to default).
  const fontSizeRef = useRef(readTerminalFontSize(terminalId))
  const [connectionState, setConnectionState] = useState('connecting')
  const [exitCode, setExitCode] = useState(null)
  // Phase 7: per-terminal dismissal of the Resume Claude button.
  const [resumeDismissed, setResumeDismissed] = useState(false)
  const reconnectTimerRef = useRef(null)
  const hasConnectedRef = useRef(false)
  const stateRef = useRef('connecting')
  // Initialize synchronously from cache if available (avoids async render cycle)
  const xtermModsRef = useRef(xtermCache)
  const [xtermReady, setXtermReady] = useState(xtermCache !== null)

  // Load xterm modules on mount (skipped if already cached)
  useEffect(() => {
    if (xtermModsRef.current) return
    let cancelled = false
    loadXterm().then((mods) => {
      if (!cancelled) {
        xtermModsRef.current = mods
        setXtermReady(true)
      }
    })
    return () => { cancelled = true }
  }, [])

  // Helper to update both state and ref synchronously
  const updateState = useCallback((newState) => {
    stateRef.current = newState
    setConnectionState(newState)
  }, [])

  // Expose imperative methods for parent components (MobileTerminalView shortcut bar)
  useImperativeHandle(ref, () => ({
    sendInput: (data) => {
      if (socketRef.current?.connected) {
        socketRef.current.emit('input', data)
      }
    },
    focus: () => {
      if (termRef.current) {
        termRef.current.focus()
      }
    },
    setFontSize: (size) => {
      const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size))
      if (termRef.current && clamped !== fontSizeRef.current) {
        fontSizeRef.current = clamped
        termRef.current.options.fontSize = clamped
        if (fitAddonRef.current) fitAddonRef.current.fit()
        writeTerminalFontSize(terminalId, clamped)
        if (socketRef.current?.connected) {
          socketRef.current.emit('resize', { cols: termRef.current.cols, rows: termRef.current.rows })
        }
      }
    },
    getFontSize: () => fontSizeRef.current,
  }))

  // Notify parent of connection state changes
  useEffect(() => {
    if (onConnectionStateChange && terminalId) {
      onConnectionStateChange(terminalId, connectionState)
    }
  }, [connectionState, terminalId, onConnectionStateChange])

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }, [])

  const connect = useCallback(() => {
    const container = containerRef.current
    if (!container || !terminalId || !xtermModsRef.current) return
    const { XTerm, FitAddon } = xtermModsRef.current

    // Clean up any previous terminal
    if (termRef.current) {
      termRef.current.dispose()
      termRef.current = null
    }
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
    clearReconnectTimer()

    let disposed = false
    let resizeObserver = null

    updateState('connecting')
    setExitCode(null)
    hasConnectedRef.current = false

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      fontSize: fontSizeRef.current,
      // Generous scrollback so the disk-backed replay (~50KB; up to ~25k
      // lines of short output like `yes`) is fully retained client-side.
      scrollback: 100_000,
      theme: {
        background: '#002b36',
        foreground: '#839496',
        cursor: '#93a1a1',
        selectionBackground: '#264f78',
        black: '#073642',
        red: '#dc322f',
        green: '#859900',
        yellow: '#b58900',
        blue: '#268bd2',
        magenta: '#d33682',
        cyan: '#2aa198',
        white: '#eee8d5',
        brightBlack: '#586e75',
        brightRed: '#cb4b16',
        brightGreen: '#586e75',
        brightYellow: '#657b83',
        brightBlue: '#839496',
        brightMagenta: '#6c71c4',
        brightCyan: '#93a1a1',
        brightWhite: '#fdf6e3',
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)

    termRef.current = term
    fitAddonRef.current = fitAddon

    // Expose for E2E inspection (read xterm buffer via Playwright). Harmless
    // in production: only the live instance is exposed under its id.
    if (typeof window !== 'undefined') {
      if (!window.__dancodeTerminals) window.__dancodeTerminals = new Map()
      window.__dancodeTerminals.set(terminalId, term)
    }

    // Auto-copy on mouse-up: when the user finishes a (Shift+)drag inside
    // an alt-screen TUI like Claude, the very next redraw clears the
    // visible selection — so by the time they press Ctrl+C there's
    // nothing to copy. We:
    //   1) Track every selection change into lastSelectionText so we
    //      keep a stable copy of what was last selected, even if Claude
    //      redraws and wipes the visible highlight before mouseup fires.
    //   2) Listen for mouseup at the DOCUMENT level (capture phase) so
    //      we still see it when the user releases the button outside
    //      the terminal pane (common when dragging upward into header
    //      bars or onto the page chrome).
    //   3) Only act on a mouseup if the drag started inside our
    //      container — so other terminals / UI controls don't trigger a
    //      copy from this terminal's selection.
    let lastSelectionText = ''
    const selectionDisposable = term.onSelectionChange
      ? term.onSelectionChange(() => {
          const s = getSelectionText(term)
          if (s) lastSelectionText = s
        })
      : null

    let dragStartedInTerm = false
    const handleDocMouseDown = (e) => {
      dragStartedInTerm = container.contains(e.target)
    }
    const handleDocMouseUp = () => {
      if (!dragStartedInTerm) return
      dragStartedInTerm = false
      if (!termRef.current) return
      const sel = getSelectionText(termRef.current) || lastSelectionText
      if (sel) copyToClipboardSync(sel)
    }
    document.addEventListener('mousedown', handleDocMouseDown, true)
    document.addEventListener('mouseup', handleDocMouseUp, true)

    // Intercept Ctrl+C/V and per-terminal zoom keys before xterm sends them
    // to the PTY. The container-level keydown listener (below) does the
    // actual zoom; this just prevents xterm from also writing the keys.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !(e.ctrlKey || e.metaKey)) return true

      if (zoomActionFromKey(e)) return false

      if (e.key === 'c') {
        const selection = getSelectionText(term) || lastSelectionText
        if (selection) {
          fallbackCopy(selection)
          term.clearSelection()
          return false
        }
        return true // no selection — send SIGINT
      }

      if (e.key === 'v') {
        return false // let browser fire native paste event
      }

      return true
    })

    // Defer socket connection so StrictMode cleanup can cancel it
    const connectTimer = setTimeout(() => {
      if (disposed) return

      fitAddon.fit()

      const socket = io(`/terminal/${terminalId}`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      })

      socketRef.current = socket

      socket.on('connect', () => {
        if (disposed) return
        // On reconnect, clear terminal so ring buffer replay doesn't duplicate
        if (hasConnectedRef.current && termRef.current) {
          termRef.current.clear()
          termRef.current.reset()
        }
        hasConnectedRef.current = true
        clearReconnectTimer()
        updateState('connected')

        // Send current dimensions on reconnect
        if (termRef.current) {
          socket.emit('resize', { cols: termRef.current.cols, rows: termRef.current.rows })
        }
      })

      socket.on('output', (data) => {
        if (termRef.current) term.write(data)
      })

      socket.on('session-exit', ({ exitCode: code }) => {
        if (!disposed) {
          clearReconnectTimer()
          // Stop auto-reconnection for session-exit
          socket.io.opts.reconnection = false
          updateState('session-exit')
          setExitCode(code)
        }
      })

      socket.on('disconnect', (reason) => {
        if (disposed) return
        if (reason === 'io client disconnect') return
        if (stateRef.current === 'session-exit') return

        updateState('reconnecting')

        // Start 30s timeout — if not reconnected by then, give up
        clearReconnectTimer()
        reconnectTimerRef.current = setTimeout(() => {
          if (disposed) return
          // Disable auto-reconnect and show manual button
          socket.io.opts.reconnection = false
          socket.disconnect()
          updateState('disconnected')
        }, RECONNECT_TIMEOUT_MS)
      })

      socket.on('connect_error', () => {
        if (disposed) return
        // Only set reconnecting if not already in a terminal state
        if (stateRef.current !== 'session-exit' && stateRef.current !== 'disconnected') {
          updateState('reconnecting')
        }
      })

      term.onData((data) => {
        if (socketRef.current?.connected) {
          socket.emit('input', data)
        }
      })

      const handleResize = () => {
        if (container.offsetWidth === 0 && container.offsetHeight === 0) return
        fitAddon.fit()
        if (socketRef.current?.connected) {
          socket.emit('resize', { cols: term.cols, rows: term.rows })
        }
      }

      resizeObserver = new ResizeObserver(handleResize)
      resizeObserver.observe(container)
    }, 0)

    // Store cleanup function
    const cleanup = () => {
      disposed = true
      clearTimeout(connectTimer)
      clearReconnectTimer()
      resizeObserver?.disconnect()
      document.removeEventListener('mousedown', handleDocMouseDown, true)
      document.removeEventListener('mouseup', handleDocMouseUp, true)
      if (selectionDisposable && typeof selectionDisposable.dispose === 'function') {
        try { selectionDisposable.dispose() } catch { /* ignore */ }
      }
      if (socketRef.current) {
        socketRef.current.io.opts.reconnection = false
        socketRef.current.disconnect()
        socketRef.current = null
      }
      term.dispose()
      termRef.current = null
      if (typeof window !== 'undefined' && window.__dancodeTerminals) {
        window.__dancodeTerminals.delete(terminalId)
      }
    }

    return cleanup
  }, [token, terminalId, clearReconnectTimer, updateState, xtermReady])

  useEffect(() => {
    if (!xtermReady) return
    const cleanup = connect()
    return () => {
      if (cleanup) cleanup()
    }
  }, [connect, xtermReady])

  // Focus the xterm instance when the focused prop becomes true (skip if readFirst)
  useEffect(() => {
    if (focused && !readFirst && termRef.current) {
      termRef.current.focus()
    }
  }, [focused, readFirst])

  // Notify parent when xterm receives native focus
  useEffect(() => {
    const container = containerRef.current
    if (!container || !onFocus) return
    const handler = () => onFocus()
    container.addEventListener('focusin', handler)
    return () => container.removeEventListener('focusin', handler)
  })

  // Apply a new font size to xterm + reflow + emit resize + persist.
  // Returns true if the size actually changed.
  const applyFontSize = useCallback((nextSize) => {
    const term = termRef.current
    if (!term) return false
    if (nextSize === fontSizeRef.current) return false
    fontSizeRef.current = nextSize
    term.options.fontSize = nextSize
    if (fitAddonRef.current) fitAddonRef.current.fit()
    writeTerminalFontSize(terminalId, nextSize)
    if (socketRef.current?.connected) {
      socketRef.current.emit('resize', { cols: term.cols, rows: term.rows })
    }
    return true
  }, [terminalId])

  // Ctrl+wheel to resize font
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handler = (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY > 0 ? -1 : 1
      const newSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fontSizeRef.current + delta))
      applyFontSize(newSize)
    }
    container.addEventListener('wheel', handler, { passive: false, capture: true })
    return () => container.removeEventListener('wheel', handler, { capture: true })
  }, [applyFontSize])

  // Ctrl/Cmd + =, -, 0 zoom for THIS terminal only. Attached at document
  // level (capture phase) so we see the keydown before xterm's textarea
  // listener; we then preventDefault to block the browser's page zoom.
  // The handler bails unless `document.activeElement` is inside this
  // terminal's container, so multiple Terminal instances don't fight.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handler = (e) => {
      const action = zoomActionFromKey(e)
      if (!action) return
      const active = document.activeElement
      if (!active || !container.contains(active)) return
      e.preventDefault()
      e.stopPropagation()
      let next
      if (action === 'reset') next = DEFAULT_FONT_SIZE
      else if (action === 'in') next = stepZoom(fontSizeRef.current, +1)
      else next = stepZoom(fontSizeRef.current, -1)
      applyFontSize(next)
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [applyFontSize])

  // Pinch-to-zoom for mobile font size
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let initialDistance = 0
    let initialFontSize = fontSizeRef.current

    const getDistance = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX
      const dy = touches[0].clientY - touches[1].clientY
      return Math.sqrt(dx * dx + dy * dy)
    }

    const handleTouchStart = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault()
        initialDistance = getDistance(e.touches)
        initialFontSize = fontSizeRef.current
      }
    }

    const handleTouchMove = (e) => {
      if (e.touches.length !== 2) return
      e.preventDefault()

      const currentDistance = getDistance(e.touches)
      const scale = currentDistance / initialDistance
      const newSize = Math.round(initialFontSize * scale)
      const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, newSize))

      applyFontSize(clamped)
    }

    container.addEventListener('touchstart', handleTouchStart, { passive: false })
    container.addEventListener('touchmove', handleTouchMove, { passive: false })
    return () => {
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
    }
  }, [applyFontSize])

  // Intercept clipboard-image pastes only; text pastes are handled natively by xterm.
  // Listen on document in capture phase — image-only pastes may not fire on xterm's textarea.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handler = async (e) => {
      if (!container.contains(document.activeElement) && document.activeElement !== container) return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (!item.type.startsWith('image/')) continue
        const blob = item.getAsFile()
        if (!blob || !projectSlug || !token) continue
        e.preventDefault()
        e.stopPropagation()
        try {
          const reader = new FileReader()
          const dataUrl = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result)
            reader.onerror = reject
            reader.readAsDataURL(blob)
          })
          const ext = item.type.split('/')[1] || 'png'
          const filename = `clipboard-${Date.now()}.${ext}`
          const res = await fetch(`/api/projects/${projectSlug}/upload`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ data: dataUrl, filename }),
          })
          if (res.ok) {
            const { path } = await res.json()
            if (socketRef.current?.connected) {
              socketRef.current.emit('input', path)
            }
          }
        } catch {
          // Upload failed silently
        }
        return
      }
    }
    document.addEventListener('paste', handler, true)
    return () => document.removeEventListener('paste', handler, true)
  }, [projectSlug, token])

  // Drag-and-drop image upload
  useEffect(() => {
    const container = containerRef.current
    if (!container || !projectSlug || !token) return

    const handleDragOver = (e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }

    const handleDrop = async (e) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files)
      const imageFile = files.find((f) => f.type.startsWith('image/'))
      if (!imageFile) return

      try {
        const reader = new FileReader()
        const dataUrl = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result)
          reader.onerror = reject
          reader.readAsDataURL(imageFile)
        })

        const res = await fetch(`/api/projects/${projectSlug}/upload`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ data: dataUrl, filename: imageFile.name }),
        })

        if (res.ok) {
          const { path } = await res.json()
          // Inject the uploaded file path into the terminal
          if (socketRef.current?.connected) {
            socketRef.current.emit('input', path)
          }
        }
      } catch {
        // Upload failed silently
      }
    }

    container.addEventListener('dragover', handleDragOver)
    container.addEventListener('drop', handleDrop)
    return () => {
      container.removeEventListener('dragover', handleDragOver)
      container.removeEventListener('drop', handleDrop)
    }
  }, [projectSlug, token])

  // Manual reconnect: tear down everything and rebuild
  const handleManualReconnect = useCallback(() => {
    connect()
  }, [connect])

  const showOverlay = connectionState === 'reconnecting' || connectionState === 'disconnected' || connectionState === 'session-exit'

  const handleMouseDown = useCallback(() => {
    if (onFocus) onFocus()
    setTimeout(() => {
      if (termRef.current) termRef.current.focus()
    }, 0)
  }, [onFocus])

  const showResumeButton = Boolean(claudeSessionId) && !claudeActive && !resumeDismissed
  const sendResumeCommand = useCallback(() => {
    if (!claudeSessionId) return
    const cmd = `claude --resume ${claudeSessionId}\r`
    // Focus the xterm first so subsequent keystrokes also land in it.
    if (termRef.current) {
      try { termRef.current.focus() } catch { /* ignore */ }
    }
    // Send through the socket so bash receives it; bash will echo via the
    // PTY. We use the explicit emit path here (not term.paste) because
    // paste data is buffered before \r is interpreted in some xterm
    // configurations; an explicit emit is one round-trip.
    const sock = socketRef.current
    if (sock?.connected) {
      sock.emit('input', cmd)
    } else if (sock) {
      sock.once('connect', () => sock.emit('input', cmd))
    }
  }, [claudeSessionId])

  return (
    <div
      ref={containerRef}
      data-testid="terminal"
      data-terminal-id={terminalId || ''}
      data-connection-state={connectionState}
      data-claude-session-id={claudeSessionId || ''}
      data-claude-active={claudeActive ? 'true' : 'false'}
      className="w-full h-full relative"
      onMouseDownCapture={handleMouseDown}
    >
      {showResumeButton && (
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-base02/90 border border-blue/50 rounded shadow-lg text-xs">
          <button
            data-testid="resume-claude"
            data-claude-session-id={claudeSessionId}
            onClick={sendResumeCommand}
            className="px-3 py-1 text-blue hover:bg-blue/20 transition-colors rounded-l"
            title={`Resume Claude session ${claudeSessionId}`}
          >
            Resume Claude
          </button>
          <button
            data-testid="resume-claude-dismiss"
            onClick={() => setResumeDismissed(true)}
            className="px-2 py-1 text-base01 hover:text-base1 transition-colors rounded-r"
            title="Dismiss"
          >
            {'×'}
          </button>
        </div>
      )}
      {showOverlay && (
        <div
          data-testid="terminal-overlay"
          className="absolute inset-0 z-10 flex items-center justify-center bg-base03/80"
        >
          <div className="flex flex-col items-center gap-3 p-6 rounded-lg bg-base02 border border-base01/30 shadow-lg max-w-sm text-center">
            {connectionState === 'session-exit' ? (
              <>
                <div className="text-red text-lg font-semibold">Session Ended</div>
                <p className="text-base0 text-sm">
                  The terminal process has exited{exitCode != null ? ` (code ${exitCode})` : ''}.
                </p>
              </>
            ) : connectionState === 'reconnecting' ? (
              <>
                <div className="w-6 h-6 border-2 border-yellow/30 border-t-yellow rounded-full animate-spin" />
                <div className="text-yellow text-lg font-semibold">Reconnecting...</div>
                <p className="text-base0 text-sm">
                  Attempting to restore the connection. This may take a moment.
                </p>
              </>
            ) : (
              <>
                <div className="text-red text-lg font-semibold">Disconnected</div>
                <p className="text-base0 text-sm">
                  Lost connection to the server. This may be due to a network issue
                  or server restart.
                </p>
                <button
                  data-testid="terminal-reconnect-button"
                  onClick={handleManualReconnect}
                  className="mt-2 px-4 py-2 text-sm font-medium text-base1 bg-blue/20 border border-blue/50 rounded hover:bg-blue/30 transition-colors"
                >
                  Reconnect
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
})

export default Terminal
