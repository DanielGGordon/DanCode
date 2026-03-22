import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import Terminal from './Terminal.jsx'

// Mock xterm.js
const mockWrite = vi.fn()
const mockDispose = vi.fn()
const mockLoadAddon = vi.fn()
const mockOnData = vi.fn()
const mockOpen = vi.fn()
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

// Mock socket.io-client
const mockSocketOn = vi.fn()
const mockSocketEmit = vi.fn()
const mockSocketDisconnect = vi.fn()

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: mockSocketOn,
    emit: mockSocketEmit,
    disconnect: mockSocketDisconnect,
  })),
}))

// Mock ResizeObserver
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  cleanup()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Terminal', () => {
  it('renders a container with data-testid="terminal"', () => {
    const { getByTestId } = render(<Terminal token="test-token" />)
    expect(getByTestId('terminal')).toBeDefined()
  })

  it('opens xterm on the container element', () => {
    const { getByTestId } = render(<Terminal token="test-token" />)
    expect(mockOpen).toHaveBeenCalledWith(getByTestId('terminal'))
  })

  it('connects to /terminal socket.io namespace', async () => {
    const { io } = await import('socket.io-client')
    render(<Terminal token="test-token" />)
    vi.runAllTimers()
    expect(io).toHaveBeenCalledWith('/terminal', expect.objectContaining({
      query: { cols: 80, rows: 24 },
      auth: { token: 'test-token' },
    }))
  })

  it('listens for output events on socket', () => {
    render(<Terminal token="test-token" />)
    vi.runAllTimers()
    expect(mockSocketOn).toHaveBeenCalledWith('output', expect.any(Function))
  })

  it('registers onData handler for terminal input', () => {
    render(<Terminal token="test-token" />)
    vi.runAllTimers()
    expect(mockOnData).toHaveBeenCalledWith(expect.any(Function))
  })

  it('writes socket output data to the terminal', () => {
    render(<Terminal token="test-token" />)
    vi.runAllTimers()
    const outputHandler = mockSocketOn.mock.calls.find(([event]) => event === 'output')?.[1]
    expect(outputHandler).toBeDefined()
    outputHandler('hello')
    expect(mockWrite).toHaveBeenCalledWith('hello')
  })

  it('sends terminal input to the socket', () => {
    render(<Terminal token="test-token" />)
    vi.runAllTimers()
    const inputHandler = mockOnData.mock.calls[0]?.[0]
    expect(inputHandler).toBeDefined()
    inputHandler('ls\r')
    expect(mockSocketEmit).toHaveBeenCalledWith('input', 'ls\r')
  })

  it('cleans up on unmount', () => {
    const { unmount } = render(<Terminal token="test-token" />)
    vi.runAllTimers()
    unmount()
    expect(mockSocketDisconnect).toHaveBeenCalled()
    expect(mockDispose).toHaveBeenCalled()
  })

  it('does not connect socket if unmounted before timer fires', async () => {
    const { io } = await import('socket.io-client')
    io.mockClear()
    const { unmount } = render(<Terminal token="test-token" />)
    unmount()
    vi.runAllTimers()
    // io should not have been called since unmount cancelled the timer
    expect(io).not.toHaveBeenCalled()
  })
})
