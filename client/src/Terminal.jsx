import { useState, useEffect, useRef, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { io } from 'socket.io-client'
import '@xterm/xterm/css/xterm.css'

/**
 * Connection state values:
 * - 'connecting': socket is being established
 * - 'connected': socket connected and receiving data
 * - 'reconnecting': auto-reconnecting after disconnect (up to 30s)
 * - 'disconnected': reconnection failed after 30s timeout
 * - 'session-exit': PTY process exited
 */

const DEFAULT_FONT_SIZE = 14
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 32
const RECONNECT_TIMEOUT_MS = 30000

function fallbackCopy(text) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.cssText = 'position:fixed;opacity:0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

export default function Terminal({ token, terminalId, projectSlug, focused, onFocus, onConnectionStateChange }) {
  const containerRef = useRef(null)
  const termRef = useRef(null)
  const fitAddonRef = useRef(null)
  const socketRef = useRef(null)
  const fontSizeRef = useRef(DEFAULT_FONT_SIZE)
  const [connectionState, setConnectionState] = useState('connecting')
  const [exitCode, setExitCode] = useState(null)
  const reconnectTimerRef = useRef(null)
  const hasConnectedRef = useRef(false)
  const stateRef = useRef('connecting')

  // Helper to update both state and ref synchronously
  const updateState = useCallback((newState) => {
    stateRef.current = newState
    setConnectionState(newState)
  }, [])

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
    if (!container || !terminalId) return

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

    // Intercept Ctrl+C/V before xterm processes them as terminal input.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !(e.ctrlKey || e.metaKey)) return true

      if (e.key === 'c') {
        const selection = term.getSelection()
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
      if (socketRef.current) {
        socketRef.current.io.opts.reconnection = false
        socketRef.current.disconnect()
        socketRef.current = null
      }
      term.dispose()
      termRef.current = null
    }

    return cleanup
  }, [token, terminalId, clearReconnectTimer, updateState])

  useEffect(() => {
    const cleanup = connect()
    return () => {
      if (cleanup) cleanup()
    }
  }, [connect])

  // Focus the xterm instance when the focused prop becomes true
  useEffect(() => {
    if (focused && termRef.current) {
      termRef.current.focus()
    }
  }, [focused])

  // Notify parent when xterm receives native focus
  useEffect(() => {
    const container = containerRef.current
    if (!container || !onFocus) return
    const handler = () => onFocus()
    container.addEventListener('focusin', handler)
    return () => container.removeEventListener('focusin', handler)
  })

  // Ctrl+wheel to resize font
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handler = (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      const term = termRef.current
      if (!term) return
      const delta = e.deltaY > 0 ? -1 : 1
      const newSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fontSizeRef.current + delta))
      if (newSize !== fontSizeRef.current) {
        fontSizeRef.current = newSize
        term.options.fontSize = newSize
        if (fitAddonRef.current) fitAddonRef.current.fit()
      }
    }
    container.addEventListener('wheel', handler, { passive: false, capture: true })
    return () => container.removeEventListener('wheel', handler, { capture: true })
  }, [])

  // Handle native paste events
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handler = (e) => {
      const text = e.clipboardData?.getData('text')
      if (!text || !termRef.current) return
      e.preventDefault()
      termRef.current.paste(text)
    }
    container.addEventListener('paste', handler)
    return () => container.removeEventListener('paste', handler)
  }, [])

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

  return (
    <div
      ref={containerRef}
      data-testid="terminal"
      data-terminal-id={terminalId || ''}
      data-connection-state={connectionState}
      className="w-full h-full relative"
      onMouseDownCapture={handleMouseDown}
    >
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
}
