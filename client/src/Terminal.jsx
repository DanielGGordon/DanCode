import { useState, useEffect, useRef, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { io } from 'socket.io-client'
import '@xterm/xterm/css/xterm.css'

/**
 * Connection state values:
 * - 'connecting': socket is being established
 * - 'connected': socket connected and receiving data
 * - 'disconnected': socket lost connection (network issue, server restart)
 * - 'session-exit': tmux session/pty process exited (session killed, tmux died)
 */

export default function Terminal({ token, slug, pane, focused, onFocus }) {
  const containerRef = useRef(null)
  const termRef = useRef(null)
  const [connectionState, setConnectionState] = useState('connecting')
  const [exitCode, setExitCode] = useState(null)
  const reconnectRef = useRef(null)

  const connect = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    // Clean up any previous terminal
    if (termRef.current) {
      termRef.current.dispose()
      termRef.current = null
    }

    let disposed = false
    let socket = null
    let resizeObserver = null

    setConnectionState('connecting')
    setExitCode(null)

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      fontSize: 14,
      theme: {
        background: '#002b36',
        foreground: '#839496',
        cursor: '#93a1a1',
        selectionBackground: '#073642',
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

    // Defer socket connection so StrictMode cleanup can cancel it
    // before a backend pty/tmux session is spawned.
    const connectTimer = setTimeout(() => {
      if (disposed) return

      fitAddon.fit()
      const query = { cols: term.cols, rows: term.rows }
      if (slug) query.slug = slug
      if (pane != null) query.pane = pane

      socket = io('/terminal', {
        query,
        auth: { token },
        transports: ['websocket'],
      })

      socket.on('connect', () => {
        if (!disposed) setConnectionState('connected')
      })

      socket.on('output', (data) => {
        term.write(data)
      })

      socket.on('session-exit', ({ exitCode: code }) => {
        if (!disposed) {
          setConnectionState('session-exit')
          setExitCode(code)
        }
      })

      socket.on('disconnect', (reason) => {
        if (!disposed && reason !== 'io client disconnect') {
          // Only show disconnected state if not a deliberate client disconnect
          setConnectionState((prev) =>
            prev === 'session-exit' ? prev : 'disconnected'
          )
        }
      })

      socket.on('connect_error', () => {
        if (!disposed) setConnectionState('disconnected')
      })

      term.onData((data) => {
        socket.emit('input', data)
      })

      const handleResize = () => {
        // Skip when container is hidden (display: none) to avoid
        // sending invalid dimensions to the tmux pane
        if (container.offsetWidth === 0 && container.offsetHeight === 0) return
        fitAddon.fit()
        socket.emit('resize', { cols: term.cols, rows: term.rows })
      }

      resizeObserver = new ResizeObserver(handleResize)
      resizeObserver.observe(container)
    }, 0)

    // Store cleanup function for reconnect
    const cleanup = () => {
      disposed = true
      clearTimeout(connectTimer)
      resizeObserver?.disconnect()
      socket?.disconnect()
      term.dispose()
      termRef.current = null
    }

    reconnectRef.current = cleanup
    return cleanup
  }, [token, slug, pane])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectRef.current) {
        reconnectRef.current()
        reconnectRef.current = null
      }
    }
  }, [connect])

  // Focus the xterm instance when the focused prop becomes true
  useEffect(() => {
    if (focused && termRef.current) {
      termRef.current.focus()
    }
  }, [focused])

  // Notify parent when xterm receives native focus (e.g. direct click on terminal canvas)
  useEffect(() => {
    const container = containerRef.current
    if (!container || !onFocus) return
    const handler = () => onFocus()
    container.addEventListener('focusin', handler)
    return () => container.removeEventListener('focusin', handler)
  })

  const handleReconnect = useCallback(() => {
    // Tear down the old connection and start fresh
    if (reconnectRef.current) {
      reconnectRef.current()
      reconnectRef.current = null
    }
    connect()
  }, [connect])

  const showOverlay = connectionState === 'disconnected' || connectionState === 'session-exit'

  // Use capture phase so this fires before xterm.js swallows the event
  const handleMouseDown = useCallback(() => {
    if (onFocus) onFocus()
    // Defer focus() so xterm finishes processing the mousedown first
    setTimeout(() => {
      if (termRef.current) termRef.current.focus()
    }, 0)
  }, [onFocus])

  return (
    <div
      ref={containerRef}
      data-testid="terminal"
      data-slug={slug || ''}
      className="w-full h-full relative"
      onMouseDownCapture={handleMouseDown}
    >
      {showOverlay && (
        <div
          data-testid="terminal-error-overlay"
          className="absolute inset-0 z-10 flex items-center justify-center bg-base03/90"
        >
          <div className="flex flex-col items-center gap-3 p-6 rounded-lg bg-base02 border border-base01/30 shadow-lg max-w-sm text-center">
            {connectionState === 'session-exit' ? (
              <>
                <div className="text-red text-lg font-semibold">Session Ended</div>
                <p className="text-base0 text-sm">
                  The tmux session has exited{exitCode != null ? ` (code ${exitCode})` : ''}.
                  Re-open this project to start a new session.
                </p>
              </>
            ) : (
              <>
                <div className="text-yellow text-lg font-semibold">Disconnected</div>
                <p className="text-base0 text-sm">
                  Lost connection to the server. This may be due to a network issue
                  or server restart.
                </p>
                <button
                  data-testid="terminal-reconnect-button"
                  onClick={handleReconnect}
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
}
