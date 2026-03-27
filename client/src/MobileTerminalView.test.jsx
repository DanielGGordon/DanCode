import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'

// Mock Terminal component with forwardRef
vi.mock('./Terminal.jsx', async () => {
  const React = await import('react')
  const MockTerminal = React.forwardRef(({ terminalId, readFirst, focused }, ref) => {
    React.useImperativeHandle(ref, () => ({
      sendInput: vi.fn(),
      focus: vi.fn(),
    }))
    return (
      <div
        data-testid="terminal"
        data-terminal-id={terminalId}
        data-read-first={readFirst ? 'true' : 'false'}
        data-focused={focused ? 'true' : 'false'}
      >
        Terminal
      </div>
    )
  })
  return { default: MockTerminal }
})

import MobileTerminalView from './MobileTerminalView.jsx'

// Mock ShortcutBar
vi.mock('./ShortcutBar.jsx', () => ({
  default: ({ onSend, onPaste }) => (
    <div data-testid="shortcut-bar">
      <button data-testid="mock-shortcut-send" onClick={() => onSend?.('\x03')}>Send</button>
      <button data-testid="mock-shortcut-paste" onClick={() => onPaste?.()}>Paste</button>
    </div>
  ),
}))

beforeEach(() => {
  cleanup()
  // Mock visualViewport
  window.visualViewport = {
    height: 844,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
})

const defaultProps = {
  token: 'test-token',
  terminal: { id: 'term-1', label: 'CLI' },
  projectSlug: 'my-project',
  onBack: vi.fn(),
  terminals: [{ id: 'term-1', label: 'CLI' }],
  onSwitchTerminal: vi.fn(),
}

describe('MobileTerminalView', () => {
  it('renders the mobile terminal view', () => {
    const { getByTestId } = render(<MobileTerminalView {...defaultProps} />)
    expect(getByTestId('mobile-terminal-view')).toBeDefined()
  })

  it('shows thin top bar with back button and terminal label', () => {
    const { getByTestId } = render(<MobileTerminalView {...defaultProps} />)
    expect(getByTestId('mobile-top-bar')).toBeDefined()
    expect(getByTestId('mobile-back-button')).toBeDefined()
    expect(getByTestId('mobile-terminal-label')).toBeDefined()
    expect(getByTestId('mobile-terminal-label').textContent).toBe('CLI')
  })

  it('calls onBack when back button is clicked', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<MobileTerminalView {...defaultProps} onBack={onBack} />)
    fireEvent.click(getByTestId('mobile-back-button'))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('starts in read-first mode (no shortcut bar)', () => {
    const { queryByTestId } = render(<MobileTerminalView {...defaultProps} />)
    expect(queryByTestId('shortcut-bar')).toBeNull()
  })

  it('shows keyboard toggle button', () => {
    const { getByTestId } = render(<MobileTerminalView {...defaultProps} />)
    expect(getByTestId('keyboard-toggle')).toBeDefined()
  })

  it('shows shortcut bar when keyboard toggle is clicked', () => {
    const { getByTestId } = render(<MobileTerminalView {...defaultProps} />)
    fireEvent.click(getByTestId('keyboard-toggle'))
    expect(getByTestId('shortcut-bar')).toBeDefined()
  })

  it('shows tab strip when multiple terminals are provided', () => {
    const props = {
      ...defaultProps,
      terminals: [
        { id: 'term-1', label: 'CLI' },
        { id: 'term-2', label: 'Claude' },
      ],
    }
    const { getByTestId, queryByTestId } = render(<MobileTerminalView {...props} />)
    expect(getByTestId('mobile-tab-strip')).toBeDefined()
    expect(queryByTestId('mobile-terminal-label')).toBeNull()
  })

  it('calls onSwitchTerminal when a tab is clicked', () => {
    const onSwitch = vi.fn()
    const props = {
      ...defaultProps,
      terminals: [
        { id: 'term-1', label: 'CLI' },
        { id: 'term-2', label: 'Claude' },
      ],
      onSwitchTerminal: onSwitch,
    }
    const { getByTestId } = render(<MobileTerminalView {...props} />)
    fireEvent.click(getByTestId('mobile-tab-term-2'))
    expect(onSwitch).toHaveBeenCalledWith('term-2')
  })

  it('renders terminal area that opens keyboard on click', () => {
    const { getByTestId } = render(<MobileTerminalView {...defaultProps} />)
    expect(getByTestId('mobile-terminal-area')).toBeDefined()
    fireEvent.click(getByTestId('mobile-terminal-area'))
    expect(getByTestId('shortcut-bar')).toBeDefined()
  })

  // Phase 6: Dot indicators
  it('shows dot indicators when multiple terminals exist', () => {
    const props = {
      ...defaultProps,
      terminals: [
        { id: 'term-1', label: 'CLI' },
        { id: 'term-2', label: 'Claude' },
        { id: 'term-3', label: 'Shell' },
      ],
    }
    const { getByTestId } = render(<MobileTerminalView {...props} />)
    expect(getByTestId('dot-indicators')).toBeDefined()
    expect(getByTestId('dot-0')).toBeDefined()
    expect(getByTestId('dot-1')).toBeDefined()
    expect(getByTestId('dot-2')).toBeDefined()
  })

  it('highlights the active terminal dot', () => {
    const props = {
      ...defaultProps,
      terminals: [
        { id: 'term-1', label: 'CLI' },
        { id: 'term-2', label: 'Claude' },
      ],
    }
    const { getByTestId } = render(<MobileTerminalView {...props} />)
    expect(getByTestId('dot-0').className).toContain('bg-blue')
    expect(getByTestId('dot-1').className).not.toContain('bg-blue')
  })

  it('does not show dot indicators for single terminal', () => {
    const { queryByTestId } = render(<MobileTerminalView {...defaultProps} />)
    expect(queryByTestId('dot-indicators')).toBeNull()
  })

  it('calls onSwitchTerminal when a dot is tapped', () => {
    const onSwitch = vi.fn()
    const props = {
      ...defaultProps,
      terminals: [
        { id: 'term-1', label: 'CLI' },
        { id: 'term-2', label: 'Claude' },
      ],
      onSwitchTerminal: onSwitch,
    }
    const { getByTestId } = render(<MobileTerminalView {...props} />)
    fireEvent.click(getByTestId('dot-1'))
    expect(onSwitch).toHaveBeenCalledWith('term-2')
  })

  // Phase 6: Project drawer
  it('does not show project drawer by default', () => {
    const props = {
      ...defaultProps,
      projects: [{ slug: 'proj-a', name: 'A' }, { slug: 'proj-b', name: 'B' }],
      onSwitchProject: vi.fn(),
    }
    const { queryByTestId } = render(<MobileTerminalView {...props} />)
    expect(queryByTestId('project-drawer')).toBeNull()
    expect(queryByTestId('project-drawer-overlay')).toBeNull()
  })
})
