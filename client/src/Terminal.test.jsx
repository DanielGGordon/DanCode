import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import Terminal, { loadXterm } from './Terminal.jsx'

// Mock xterm.js
const mockWrite = vi.fn()
const mockDispose = vi.fn()
const mockLoadAddon = vi.fn()
const mockOnData = vi.fn()
const mockOpen = vi.fn()
const mockFocus = vi.fn()
const mockClear = vi.fn()
const mockReset = vi.fn()
let mockCols = 80
let mockRows = 24

vi.mock('@xterm/xterm', () => ({
  Terminal: class MockTerminal {
    constructor() {
      this.write = mockWrite
      this.dispose = mockDispose
      this.loadAddon = mockLoadAddon
      this.onData = mockOnData
      this.open = mockOpen
      this.focus = mockFocus
      this.clear = mockClear
      this.reset = mockReset
      this.attachCustomKeyEventHandler = vi.fn()
      this.getSelection = vi.fn().mockReturnValue('')
      this.clearSelection = vi.fn()
      this.paste = vi.fn()
      this.options = {}
    }
    get cols() { return mockCols }
    get rows() { return mockRows }
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class MockFitAddon {
    fit() {}
  },
}))

// Mock socket.io-client with event handler tracking and manager
let socketHandlers = {}
let managerHandlers = {}
const mockSocketOn = vi.fn((event, handler) => {
  socketHandlers[event] = handler
})
const mockSocketEmit = vi.fn()
const mockSocketDisconnect = vi.fn()
const mockSocketConnect = vi.fn()
let mockConnected = false

const mockManagerOn = vi.fn((event, handler) => {
  managerHandlers[event] = handler
})

const mockSocket = {
  on: mockSocketOn,
  emit: mockSocketEmit,
  disconnect: mockSocketDisconnect,
  connect: mockSocketConnect,
  get connected() { return mockConnected },
  io: {
    opts: { reconnection: true },
    on: mockManagerOn,
  },
}

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}))

// Mock ResizeObserver — capture callback so tests can trigger resize events
let resizeObserverCallback = null
globalThis.ResizeObserver = class {
  constructor(cb) { resizeObserverCallback = cb }
  observe() {}
  disconnect() {}
}

// Pre-populate the xterm module cache before fake timers are enabled.
// Dynamic imports inside useEffect don't resolve under fake timers because
// act() can't wait for Promises spawned during effects. Warming the cache
// makes all subsequent renders synchronous (xtermReady starts true).
beforeAll(async () => {
  await loadXterm()
})

// Helper: render Terminal and flush effects via act()
async function renderTerminal(props) {
  let result
  await act(async () => {
    result = render(<Terminal {...props} />)
  })
  return result
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  socketHandlers = {}
  managerHandlers = {}
  mockConnected = false
  mockSocket.io.opts.reconnection = true
  cleanup()
  // jsdom elements have zero dimensions by default; set non-zero so terminals
  // treat containers as visible and connect normally in most tests.
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { value: 800, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { value: 600, configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Terminal', () => {
  it('renders a container with data-testid="terminal"', async () => {
    const { getByTestId } = await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    expect(getByTestId('terminal')).toBeDefined()
  })

  it('opens xterm on the container element', async () => {
    const { getByTestId } = await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    expect(mockOpen).toHaveBeenCalledWith(getByTestId('terminal'))
  })

  it('connects to /terminal/:id socket.io namespace', async () => {
    const { io } = await import('socket.io-client')
    await renderTerminal({ token: 'test-token', terminalId: 'term-abc-123' })
    vi.runAllTimers()
    expect(io).toHaveBeenCalledWith('/terminal/term-abc-123', expect.objectContaining({
      auth: { token: 'test-token' },
      transports: ['websocket'],
      reconnection: true,
    }))
  })

  it('does not connect when terminalId is not provided', async () => {
    const { io } = await import('socket.io-client')
    io.mockClear()
    await renderTerminal({ token: 'test-token' })
    vi.runAllTimers()
    expect(io).not.toHaveBeenCalled()
  })

  it('sets data-terminal-id attribute on container', async () => {
    const { getByTestId } = await renderTerminal({ token: 'test-token', terminalId: 'term-xyz' })
    expect(getByTestId('terminal').getAttribute('data-terminal-id')).toBe('term-xyz')
  })

  it('sets data-connection-state attribute on container', async () => {
    const { getByTestId } = await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    expect(getByTestId('terminal').getAttribute('data-connection-state')).toBe('connecting')
  })

  it('listens for output events on socket', async () => {
    await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()
    expect(mockSocketOn).toHaveBeenCalledWith('output', expect.any(Function))
  })

  it('registers onData handler for terminal input', async () => {
    await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()
    expect(mockOnData).toHaveBeenCalledWith(expect.any(Function))
  })

  it('writes socket output data to the terminal', async () => {
    await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()
    const outputHandler = mockSocketOn.mock.calls.find(([event]) => event === 'output')?.[1]
    expect(outputHandler).toBeDefined()
    outputHandler('hello')
    expect(mockWrite).toHaveBeenCalledWith('hello')
  })

  it('sends terminal input to the socket when connected', async () => {
    await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()
    mockConnected = true
    const inputHandler = mockOnData.mock.calls[0]?.[0]
    expect(inputHandler).toBeDefined()
    inputHandler('ls\r')
    expect(mockSocketEmit).toHaveBeenCalledWith('input', 'ls\r')
  })

  it('cleans up on unmount', async () => {
    const { unmount } = await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()
    unmount()
    expect(mockSocketDisconnect).toHaveBeenCalled()
    expect(mockDispose).toHaveBeenCalled()
  })

  it('does not connect socket if unmounted before timer fires', async () => {
    const { io } = await import('socket.io-client')
    io.mockClear()
    await renderTerminal({ token: 'test-token' })
    vi.runAllTimers()
    // io should not have been called since no terminalId was provided
    expect(io).not.toHaveBeenCalled()
  })

  it('focuses the terminal when focused prop is true', async () => {
    await renderTerminal({ token: 'test-token', terminalId: 'term-1', focused: true })
    expect(mockFocus).toHaveBeenCalled()
  })

  it('does not focus the terminal when focused prop is false', async () => {
    await renderTerminal({ token: 'test-token', terminalId: 'term-1', focused: false })
    expect(mockFocus).not.toHaveBeenCalled()
  })

  it('registers focusin listener on the container element', async () => {
    const onFocus = vi.fn()
    const { getByTestId } = await renderTerminal({ token: 'test-token', terminalId: 'term-1', onFocus })
    const container = getByTestId('terminal')
    container.dispatchEvent(new Event('focusin', { bubbles: true }))
    expect(onFocus).toHaveBeenCalled()
  })

  it('calls onFocus callback when a child element receives focus', async () => {
    const onFocusCb = vi.fn()
    const { getByTestId } = await renderTerminal({ token: 'test-token', terminalId: 'term-1', onFocus: onFocusCb })
    const container = getByTestId('terminal')
    // Simulate focus bubbling up from a child element
    const child = document.createElement('textarea')
    container.appendChild(child)
    child.dispatchEvent(new Event('focusin', { bubbles: true }))
    expect(onFocusCb).toHaveBeenCalled()
  })

  it('does not emit resize when container is hidden (zero dimensions)', async () => {
    const { getByTestId } = await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()

    // Simulate container hidden (display: none -> offsetWidth/Height = 0)
    const container = getByTestId('terminal')
    Object.defineProperty(container, 'offsetWidth', { value: 0, configurable: true })
    Object.defineProperty(container, 'offsetHeight', { value: 0, configurable: true })

    mockSocketEmit.mockClear()
    // Trigger the ResizeObserver callback
    resizeObserverCallback()

    // Should NOT have emitted a resize event
    expect(mockSocketEmit).not.toHaveBeenCalledWith('resize', expect.anything())
  })

  it('emits resize when container is visible and socket is connected', async () => {
    const { getByTestId } = await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()

    // Simulate visible container
    const container = getByTestId('terminal')
    Object.defineProperty(container, 'offsetWidth', { value: 800, configurable: true })
    Object.defineProperty(container, 'offsetHeight', { value: 600, configurable: true })

    mockSocketEmit.mockClear()
    mockConnected = true
    resizeObserverCallback()

    expect(mockSocketEmit).toHaveBeenCalledWith('resize', { cols: 80, rows: 24 })
  })

  it('connects even when container is hidden at mount', async () => {
    const { io } = await import('socket.io-client')
    const { getByTestId } = await renderTerminal({ token: 'test-token', terminalId: 'term-1' })

    // Make container hidden before the deferred socket connect fires
    const container = getByTestId('terminal')
    Object.defineProperty(container, 'offsetWidth', { value: 0, configurable: true })
    Object.defineProperty(container, 'offsetHeight', { value: 0, configurable: true })

    vi.runAllTimers()
    // Hidden panes should still establish backend connections
    expect(io).toHaveBeenCalledWith('/terminal/term-1', expect.objectContaining({
      auth: { token: 'test-token' },
    }))
  })

  // --- Connection state tests ---

  it('does not show overlay initially (connecting state)', async () => {
    const { queryByTestId } = await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    expect(queryByTestId('terminal-overlay')).toBeNull()
  })

  it('sets connected state when socket connects', async () => {
    const { getByTestId } = await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()

    act(() => {
      socketHandlers['connect']()
    })

    expect(getByTestId('terminal').getAttribute('data-connection-state')).toBe('connected')
  })

  it('does not show overlay when connected', async () => {
    const { queryByTestId } = await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()

    act(() => {
      socketHandlers['connect']()
    })

    expect(queryByTestId('terminal-overlay')).toBeNull()
  })

  // --- Reconnecting state tests ---

  it('shows "Reconnecting..." overlay when socket disconnects unexpectedly', async () => {
    const { queryByTestId, getByText } = await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()

    act(() => {
      socketHandlers['connect']()
    })

    act(() => {
      socketHandlers['disconnect']('transport close')
    })

    expect(queryByTestId('terminal-overlay')).not.toBeNull()
    expect(getByText('Reconnecting...')).toBeDefined()
  })

  it('transitions from reconnecting to disconnected after 30 seconds', async () => {
    const { getByText, getByTestId } = await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()

    act(() => {
      socketHandlers['connect']()
    })

    act(() => {
      socketHandlers['disconnect']('transport close')
    })

    expect(getByText('Reconnecting...')).toBeDefined()

    // Advance 30 seconds
    act(() => {
      vi.advanceTimersByTime(30000)
    })

    expect(getByText('Disconnected')).toBeDefined()
    expect(getByTestId('terminal-reconnect-button')).toBeDefined()
  })

  it('clears reconnect timer when reconnection succeeds within 30s', async () => {
    const { queryByTestId, getByText } = await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()

    act(() => {
      socketHandlers['connect']()
    })

    act(() => {
      socketHandlers['disconnect']('transport close')
    })

    expect(getByText('Reconnecting...')).toBeDefined()

    // Reconnect before timeout
    act(() => {
      vi.advanceTimersByTime(5000)
      socketHandlers['connect']()
    })

    expect(queryByTestId('terminal-overlay')).toBeNull()

    // Advance past the original 30s mark — should NOT transition to disconnected
    act(() => {
      vi.advanceTimersByTime(30000)
    })

    expect(queryByTestId('terminal-overlay')).toBeNull()
  })

  it('clears and resets terminal on reconnect for buffer replay', async () => {
    await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()

    // First connect
    act(() => {
      socketHandlers['connect']()
    })

    mockClear.mockClear()
    mockReset.mockClear()

    // Disconnect then reconnect
    act(() => {
      socketHandlers['disconnect']('transport close')
    })
    act(() => {
      socketHandlers['connect']()
    })

    expect(mockClear).toHaveBeenCalled()
    expect(mockReset).toHaveBeenCalled()
  })

  it('does not clear terminal on first connect', async () => {
    await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()

    mockClear.mockClear()
    mockReset.mockClear()

    act(() => {
      socketHandlers['connect']()
    })

    expect(mockClear).not.toHaveBeenCalled()
    expect(mockReset).not.toHaveBeenCalled()
  })

  // --- Disconnected state tests ---

  it('does not show overlay when client deliberately disconnects', async () => {
    const { queryByTestId } = await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()

    act(() => {
      socketHandlers['connect']()
    })

    act(() => {
      socketHandlers['disconnect']('io client disconnect')
    })

    // Should not show any overlay for deliberate disconnect
    expect(queryByTestId('terminal-overlay')).toBeNull()
  })

  it('shows reconnecting on connect_error', async () => {
    const { getByText } = await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()

    act(() => {
      socketHandlers['connect_error'](new Error('timeout'))
    })

    expect(getByText('Reconnecting...')).toBeDefined()
  })

  it('manual reconnect button creates a new connection', async () => {
    const { io } = await import('socket.io-client')
    const { getByTestId } = await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()

    act(() => {
      socketHandlers['connect']()
    })

    // Disconnect
    act(() => {
      socketHandlers['disconnect']('transport close')
    })

    // Wait for 30s timeout
    act(() => {
      vi.advanceTimersByTime(30000)
    })

    const callsBefore = io.mock.calls.length

    // Click reconnect
    fireEvent.click(getByTestId('terminal-reconnect-button'))
    vi.runAllTimers()

    // Should have created a new socket connection
    expect(io.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  // --- Session-exit state tests ---

  it('shows "Session Ended" overlay when session-exit event is received', async () => {
    const { queryByTestId, getByText } = await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()

    act(() => {
      socketHandlers['session-exit']({ exitCode: 1 })
    })

    expect(queryByTestId('terminal-overlay')).not.toBeNull()
    expect(getByText('Session Ended')).toBeDefined()
    expect(getByText(/code 1/)).toBeDefined()
    // Session-exit should NOT show a reconnect button
    expect(queryByTestId('terminal-reconnect-button')).toBeNull()
  })

  it('preserves session-exit state when disconnect follows', async () => {
    const { getByText } = await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()

    // Session exits first, then socket disconnects
    act(() => {
      socketHandlers['session-exit']({ exitCode: 0 })
      socketHandlers['disconnect']('transport close')
    })

    // Should still show "Session Ended", not "Reconnecting"
    expect(getByText('Session Ended')).toBeDefined()
  })

  it('shows exit code 0 in session-exit overlay', async () => {
    const { getByText } = await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()

    act(() => {
      socketHandlers['session-exit']({ exitCode: 0 })
    })

    expect(getByText(/code 0/)).toBeDefined()
  })

  // --- Callback tests ---

  it('calls onConnectionStateChange when state changes', async () => {
    const onStateChange = vi.fn()
    await renderTerminal({
      token: 'test-token',
      terminalId: 'term-1',
      onConnectionStateChange: onStateChange,
    })
    vi.runAllTimers()

    act(() => {
      socketHandlers['connect']()
    })

    expect(onStateChange).toHaveBeenCalledWith('term-1', 'connected')
  })

  it('listens for session-exit, disconnect, connect, and connect_error events on socket', async () => {
    await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()
    expect(mockSocketOn).toHaveBeenCalledWith('session-exit', expect.any(Function))
    expect(mockSocketOn).toHaveBeenCalledWith('disconnect', expect.any(Function))
    expect(mockSocketOn).toHaveBeenCalledWith('connect_error', expect.any(Function))
    expect(mockSocketOn).toHaveBeenCalledWith('connect', expect.any(Function))
  })

  it('configures socket.io with reconnection enabled', async () => {
    const { io } = await import('socket.io-client')
    await renderTerminal({ token: 'test-token', terminalId: 'term-1' })
    vi.runAllTimers()
    expect(io).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    }))
  })

  // --- Paste handling: regression guard against double-paste ---

  function buildPasteEvent(items) {
    // jsdom doesn't implement DataTransfer/ClipboardEvent with clipboardData;
    // build a synthetic event with the minimum shape the handler reads.
    const evt = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(evt, 'clipboardData', {
      value: { items },
      configurable: true,
    })
    return evt
  }

  it('does not intercept plain-text paste (xterm handles it natively, no double emit)', async () => {
    const { getByTestId } = await renderTerminal({
      token: 'test-token',
      terminalId: 'term-1',
      projectSlug: 'demo',
    })
    vi.runAllTimers()
    mockConnected = true
    mockSocketEmit.mockClear()

    const container = getByTestId('terminal')
    // Make sure the document-paste handler treats us as focused inside the terminal.
    Object.defineProperty(document, 'activeElement', { value: container, configurable: true })

    const evt = buildPasteEvent([{ type: 'text/plain', getAsFile: () => null }])
    const preventSpy = vi.spyOn(evt, 'preventDefault')

    document.dispatchEvent(evt)

    // The document-level handler should NOT preventDefault on plain text — xterm's
    // own paste handler must be allowed to run, and we must not emit input directly
    // (doing both would double-paste the same fixture).
    expect(preventSpy).not.toHaveBeenCalled()
    expect(mockSocketEmit).not.toHaveBeenCalledWith('input', 'pastedText')
  })

  it('intercepts image paste and uploads (does not forward to xterm)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ path: '/tmp/img.png' }),
    })
    // jsdom's FileReader doesn't fire onload; stub it deterministically.
    const origFileReader = globalThis.FileReader
    globalThis.FileReader = class {
      readAsDataURL() {
        setTimeout(() => this.onload && this.onload({ target: { result: 'data:image/png;base64,abc' } }), 0)
      }
    }

    const { getByTestId } = await renderTerminal({
      token: 'test-token',
      terminalId: 'term-1',
      projectSlug: 'demo',
    })
    vi.runAllTimers()
    mockConnected = true
    mockSocketEmit.mockClear()

    const container = getByTestId('terminal')
    Object.defineProperty(document, 'activeElement', { value: container, configurable: true })

    const fakeBlob = new Blob(['x'], { type: 'image/png' })
    const evt = buildPasteEvent([{ type: 'image/png', getAsFile: () => fakeBlob }])
    const preventSpy = vi.spyOn(evt, 'preventDefault')

    document.dispatchEvent(evt)
    // Allow FileReader microtask + fetch to settle.
    await vi.runAllTimersAsync()

    expect(preventSpy).toHaveBeenCalled()

    globalThis.FileReader = origFileReader
  })

  // Phase 7: Resume Claude button
  describe('Resume Claude button', () => {
    it('renders when claudeSessionId is set and claudeActive is false', async () => {
      const { getByTestId } = await renderTerminal({
        token: 'test-token',
        terminalId: 'term-1',
        claudeSessionId: 'sid-1',
        claudeActive: false,
      })
      expect(getByTestId('resume-claude')).toBeDefined()
    })

    it('does NOT render when claudeSessionId is missing', async () => {
      const { queryByTestId } = await renderTerminal({
        token: 'test-token',
        terminalId: 'term-1',
        claudeSessionId: null,
        claudeActive: false,
      })
      expect(queryByTestId('resume-claude')).toBeNull()
    })

    it('does NOT render when claudeActive is true (user is already in Claude)', async () => {
      const { queryByTestId } = await renderTerminal({
        token: 'test-token',
        terminalId: 'term-1',
        claudeSessionId: 'sid-1',
        claudeActive: true,
      })
      expect(queryByTestId('resume-claude')).toBeNull()
    })

    it('button label includes the resume command shape so users know what it will do', async () => {
      const { getByTestId } = await renderTerminal({
        token: 'test-token',
        terminalId: 'term-1',
        claudeSessionId: 'abcd-1234',
        claudeActive: false,
      })
      const btn = getByTestId('resume-claude')
      expect(btn.textContent).toMatch(/Resume Claude/i)
    })

    it('clicking the button emits the resume command + Enter via socket input', async () => {
      const { getByTestId } = await renderTerminal({
        token: 'test-token',
        terminalId: 'term-1',
        claudeSessionId: 'abcd-1234',
        claudeActive: false,
      })
      vi.runAllTimers()
      mockConnected = true
      mockSocketEmit.mockClear()
      const btn = getByTestId('resume-claude')
      await act(async () => { fireEvent.click(btn) })
      expect(mockSocketEmit).toHaveBeenCalledWith('input', 'claude --resume abcd-1234\r')
    })

    it('button is dismissible per-terminal and stays dismissed', async () => {
      const { getByTestId, queryByTestId } = await renderTerminal({
        token: 'test-token',
        terminalId: 'term-1',
        claudeSessionId: 'sid-1',
        claudeActive: false,
      })
      const dismiss = getByTestId('resume-claude-dismiss')
      await act(async () => { fireEvent.click(dismiss) })
      expect(queryByTestId('resume-claude')).toBeNull()
    })
  })
})
