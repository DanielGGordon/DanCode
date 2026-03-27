import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import Terminal from './Terminal.jsx'

// Mock xterm.js
const mockWrite = vi.fn()
const mockDispose = vi.fn()
const mockLoadAddon = vi.fn()
const mockOnData = vi.fn()
const mockOpen = vi.fn()
const mockFocus = vi.fn()
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

// Mock socket.io-client with event handler tracking
let socketHandlers = {}
const mockSocketOn = vi.fn((event, handler) => {
  socketHandlers[event] = handler
})
const mockSocketEmit = vi.fn()
const mockSocketDisconnect = vi.fn()

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: mockSocketOn,
    emit: mockSocketEmit,
    disconnect: mockSocketDisconnect,
  })),
}))

// Mock ResizeObserver — capture callback so tests can trigger resize events
let resizeObserverCallback = null
globalThis.ResizeObserver = class {
  constructor(cb) { resizeObserverCallback = cb }
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  socketHandlers = {}
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
  it('renders a container with data-testid="terminal"', () => {
    const { getByTestId } = render(<Terminal token="test-token" terminalId="term-1" />)
    expect(getByTestId('terminal')).toBeDefined()
  })

  it('opens xterm on the container element', () => {
    const { getByTestId } = render(<Terminal token="test-token" terminalId="term-1" />)
    expect(mockOpen).toHaveBeenCalledWith(getByTestId('terminal'))
  })

  it('connects to /terminal/:id socket.io namespace', async () => {
    const { io } = await import('socket.io-client')
    render(<Terminal token="test-token" terminalId="term-abc-123" />)
    vi.runAllTimers()
    expect(io).toHaveBeenCalledWith('/terminal/term-abc-123', expect.objectContaining({
      auth: { token: 'test-token' },
      transports: ['websocket'],
    }))
  })

  it('does not connect when terminalId is not provided', async () => {
    const { io } = await import('socket.io-client')
    io.mockClear()
    render(<Terminal token="test-token" />)
    vi.runAllTimers()
    expect(io).not.toHaveBeenCalled()
  })

  it('sets data-terminal-id attribute on container', () => {
    const { getByTestId } = render(<Terminal token="test-token" terminalId="term-xyz" />)
    expect(getByTestId('terminal').getAttribute('data-terminal-id')).toBe('term-xyz')
  })

  it('listens for output events on socket', () => {
    render(<Terminal token="test-token" terminalId="term-1" />)
    vi.runAllTimers()
    expect(mockSocketOn).toHaveBeenCalledWith('output', expect.any(Function))
  })

  it('registers onData handler for terminal input', () => {
    render(<Terminal token="test-token" terminalId="term-1" />)
    vi.runAllTimers()
    expect(mockOnData).toHaveBeenCalledWith(expect.any(Function))
  })

  it('writes socket output data to the terminal', () => {
    render(<Terminal token="test-token" terminalId="term-1" />)
    vi.runAllTimers()
    const outputHandler = mockSocketOn.mock.calls.find(([event]) => event === 'output')?.[1]
    expect(outputHandler).toBeDefined()
    outputHandler('hello')
    expect(mockWrite).toHaveBeenCalledWith('hello')
  })

  it('sends terminal input to the socket', () => {
    render(<Terminal token="test-token" terminalId="term-1" />)
    vi.runAllTimers()
    const inputHandler = mockOnData.mock.calls[0]?.[0]
    expect(inputHandler).toBeDefined()
    inputHandler('ls\r')
    expect(mockSocketEmit).toHaveBeenCalledWith('input', 'ls\r')
  })

  it('cleans up on unmount', () => {
    const { unmount } = render(<Terminal token="test-token" terminalId="term-1" />)
    vi.runAllTimers()
    unmount()
    expect(mockSocketDisconnect).toHaveBeenCalled()
    expect(mockDispose).toHaveBeenCalled()
  })

  it('does not connect socket if unmounted before timer fires', async () => {
    const { io } = await import('socket.io-client')
    io.mockClear()
    const { unmount } = render(<Terminal token="test-token" terminalId="term-1" />)
    unmount()
    vi.runAllTimers()
    // io should not have been called since unmount cancelled the timer
    expect(io).not.toHaveBeenCalled()
  })

  it('focuses the terminal when focused prop is true', () => {
    render(<Terminal token="test-token" terminalId="term-1" focused={true} />)
    expect(mockFocus).toHaveBeenCalled()
  })

  it('does not focus the terminal when focused prop is false', () => {
    render(<Terminal token="test-token" terminalId="term-1" focused={false} />)
    expect(mockFocus).not.toHaveBeenCalled()
  })

  it('registers focusin listener on the container element', () => {
    const onFocus = vi.fn()
    const { getByTestId } = render(<Terminal token="test-token" terminalId="term-1" onFocus={onFocus} />)
    const container = getByTestId('terminal')
    container.dispatchEvent(new Event('focusin', { bubbles: true }))
    expect(onFocus).toHaveBeenCalled()
  })

  it('calls onFocus callback when a child element receives focus', () => {
    const onFocusCb = vi.fn()
    const { getByTestId } = render(<Terminal token="test-token" terminalId="term-1" onFocus={onFocusCb} />)
    const container = getByTestId('terminal')
    // Simulate focus bubbling up from a child element
    const child = document.createElement('textarea')
    container.appendChild(child)
    child.dispatchEvent(new Event('focusin', { bubbles: true }))
    expect(onFocusCb).toHaveBeenCalled()
  })

  it('does not emit resize when container is hidden (zero dimensions)', () => {
    const { getByTestId } = render(<Terminal token="test-token" terminalId="term-1" />)
    vi.runAllTimers()

    // Simulate container hidden (display: none → offsetWidth/Height = 0)
    const container = getByTestId('terminal')
    Object.defineProperty(container, 'offsetWidth', { value: 0, configurable: true })
    Object.defineProperty(container, 'offsetHeight', { value: 0, configurable: true })

    mockSocketEmit.mockClear()
    // Trigger the ResizeObserver callback
    resizeObserverCallback()

    // Should NOT have emitted a resize event
    expect(mockSocketEmit).not.toHaveBeenCalledWith('resize', expect.anything())
  })

  it('emits resize when container is visible (non-zero dimensions)', () => {
    const { getByTestId } = render(<Terminal token="test-token" terminalId="term-1" />)
    vi.runAllTimers()

    // Simulate visible container
    const container = getByTestId('terminal')
    Object.defineProperty(container, 'offsetWidth', { value: 800, configurable: true })
    Object.defineProperty(container, 'offsetHeight', { value: 600, configurable: true })

    mockSocketEmit.mockClear()
    resizeObserverCallback()

    expect(mockSocketEmit).toHaveBeenCalledWith('resize', { cols: 80, rows: 24 })
  })

  it('connects even when container is hidden at mount', async () => {
    const { io } = await import('socket.io-client')
    const { getByTestId } = render(<Terminal token="test-token" terminalId="term-1" />)

    // Make container hidden before the deferred connect fires
    const container = getByTestId('terminal')
    Object.defineProperty(container, 'offsetWidth', { value: 0, configurable: true })
    Object.defineProperty(container, 'offsetHeight', { value: 0, configurable: true })

    vi.runAllTimers()
    // Hidden panes should still establish backend connections
    expect(io).toHaveBeenCalledWith('/terminal/term-1', expect.objectContaining({
      auth: { token: 'test-token' },
    }))
  })

  // --- Error state tests ---

  it('does not show error overlay initially', () => {
    const { queryByTestId } = render(<Terminal token="test-token" terminalId="term-1" />)
    expect(queryByTestId('terminal-error-overlay')).toBeNull()
  })

  it('shows "Session Ended" overlay when session-exit event is received', () => {
    const { queryByTestId, getByText } = render(<Terminal token="test-token" terminalId="term-1" />)
    vi.runAllTimers()

    // Trigger session-exit event inside act() to flush React state updates
    act(() => {
      socketHandlers['session-exit']({ exitCode: 1 })
    })

    expect(queryByTestId('terminal-error-overlay')).not.toBeNull()
    expect(getByText('Session Ended')).toBeDefined()
    expect(getByText(/code 1/)).toBeDefined()
    // Session-exit shows a message to re-open, NOT a reconnect button
    expect(queryByTestId('terminal-reconnect-button')).toBeNull()
  })

  it('shows "Disconnected" overlay when socket disconnects unexpectedly', () => {
    const { queryByTestId, getByText } = render(<Terminal token="test-token" terminalId="term-1" />)
    vi.runAllTimers()

    act(() => {
      socketHandlers['disconnect']('transport close')
    })

    expect(queryByTestId('terminal-error-overlay')).not.toBeNull()
    expect(getByText('Disconnected')).toBeDefined()
    expect(getByText(/Lost connection/)).toBeDefined()
  })

  it('does not show overlay when client deliberately disconnects', () => {
    const { queryByTestId } = render(<Terminal token="test-token" terminalId="term-1" />)
    vi.runAllTimers()

    act(() => {
      socketHandlers['disconnect']('io client disconnect')
    })

    expect(queryByTestId('terminal-error-overlay')).toBeNull()
  })

  it('shows "Disconnected" overlay on connect_error', () => {
    const { queryByTestId, getByText } = render(<Terminal token="test-token" terminalId="term-1" />)
    vi.runAllTimers()

    act(() => {
      socketHandlers['connect_error'](new Error('timeout'))
    })

    expect(queryByTestId('terminal-error-overlay')).not.toBeNull()
    expect(getByText('Disconnected')).toBeDefined()
  })

  it('preserves session-exit state when disconnect follows', () => {
    const { getByText } = render(<Terminal token="test-token" terminalId="term-1" />)
    vi.runAllTimers()

    // Session exits first, then socket disconnects
    act(() => {
      socketHandlers['session-exit']({ exitCode: 0 })
      socketHandlers['disconnect']('transport close')
    })

    // Should still show "Session Ended", not "Disconnected"
    expect(getByText('Session Ended')).toBeDefined()
  })

  it('shows exit code 0 in session-exit overlay', () => {
    const { getByText } = render(<Terminal token="test-token" terminalId="term-1" />)
    vi.runAllTimers()

    act(() => {
      socketHandlers['session-exit']({ exitCode: 0 })
    })

    expect(getByText(/code 0/)).toBeDefined()
  })

  it('reconnect button creates a new socket connection', async () => {
    const { io } = await import('socket.io-client')
    const { getByTestId } = render(<Terminal token="test-token" terminalId="term-1" />)
    vi.runAllTimers()

    // Trigger disconnect
    act(() => {
      socketHandlers['disconnect']('transport close')
    })

    const callsBefore = io.mock.calls.length

    // Click reconnect
    fireEvent.click(getByTestId('terminal-reconnect-button'))
    vi.runAllTimers()

    // Should have created a new socket connection
    expect(io.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('listens for session-exit and disconnect events on socket', () => {
    render(<Terminal token="test-token" terminalId="term-1" />)
    vi.runAllTimers()
    expect(mockSocketOn).toHaveBeenCalledWith('session-exit', expect.any(Function))
    expect(mockSocketOn).toHaveBeenCalledWith('disconnect', expect.any(Function))
    expect(mockSocketOn).toHaveBeenCalledWith('connect_error', expect.any(Function))
    expect(mockSocketOn).toHaveBeenCalledWith('connect', expect.any(Function))
  })
})
