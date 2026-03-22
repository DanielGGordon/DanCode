import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { io } from 'socket.io-client'
import '@xterm/xterm/css/xterm.css'

export default function Terminal({ token, slug, pane }) {
  const containerRef = useRef(null)
  const termRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    let socket = null
    let resizeObserver = null

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
    fitAddon.fit()

    termRef.current = term

    // Defer socket connection so StrictMode cleanup can cancel it
    // before a backend pty/tmux session is spawned.
    const connectTimer = setTimeout(() => {
      if (disposed) return

      const query = { cols: term.cols, rows: term.rows };
      if (slug) query.slug = slug;
      if (pane != null) query.pane = pane;

      socket = io('/terminal', {
        query,
        auth: { token },
      })

      socket.on('output', (data) => {
        term.write(data)
      })

      term.onData((data) => {
        socket.emit('input', data)
      })

      const handleResize = () => {
        fitAddon.fit()
        socket.emit('resize', { cols: term.cols, rows: term.rows })
      }

      resizeObserver = new ResizeObserver(handleResize)
      resizeObserver.observe(container)
    }, 0)

    return () => {
      disposed = true
      clearTimeout(connectTimer)
      resizeObserver?.disconnect()
      socket?.disconnect()
      term.dispose()
      termRef.current = null
    }
  }, [])

  return (
    <div
      ref={containerRef}
      data-testid="terminal"
      data-slug={slug || ''}
      className="w-full h-full"
    />
  )
}
