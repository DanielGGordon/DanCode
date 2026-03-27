import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import MobileTerminalList from './MobileTerminalList.jsx'

beforeEach(() => {
  cleanup()
})

const mockTerminals = [
  { id: 't1', label: 'CLI', lastActivity: new Date().toISOString() },
  { id: 't2', label: 'Claude', lastActivity: new Date(Date.now() - 120000).toISOString() },
]

describe('MobileTerminalList', () => {
  it('renders terminal list with project name', () => {
    const { getByTestId } = render(
      <MobileTerminalList
        projectName="My Project"
        terminals={mockTerminals}
        onSelectTerminal={() => {}}
        onBack={() => {}}
      />
    )
    expect(getByTestId('mobile-terminal-list').textContent).toContain('My Project')
  })

  it('renders terminal items for each terminal', () => {
    const { getByTestId } = render(
      <MobileTerminalList
        projectName="My Project"
        terminals={mockTerminals}
        onSelectTerminal={() => {}}
        onBack={() => {}}
      />
    )
    expect(getByTestId('terminal-item-t1')).toBeDefined()
    expect(getByTestId('terminal-item-t2')).toBeDefined()
  })

  it('shows terminal labels', () => {
    const { getByTestId } = render(
      <MobileTerminalList
        projectName="My Project"
        terminals={mockTerminals}
        onSelectTerminal={() => {}}
        onBack={() => {}}
      />
    )
    expect(getByTestId('terminal-item-t1').textContent).toContain('CLI')
    expect(getByTestId('terminal-item-t2').textContent).toContain('Claude')
  })

  it('shows activity indicators per terminal', () => {
    const { getByTestId } = render(
      <MobileTerminalList
        projectName="My Project"
        terminals={mockTerminals}
        onSelectTerminal={() => {}}
        onBack={() => {}}
      />
    )
    // CLI was active just now - green
    expect(getByTestId('terminal-activity-t1').className).toContain('bg-green')
    // Claude was active 2m ago - idle
    expect(getByTestId('terminal-activity-t2').className).toContain('bg-base01')
  })

  it('calls onSelectTerminal when terminal is tapped', () => {
    const onSelect = vi.fn()
    const { getByTestId } = render(
      <MobileTerminalList
        projectName="My Project"
        terminals={mockTerminals}
        onSelectTerminal={onSelect}
        onBack={() => {}}
      />
    )
    fireEvent.click(getByTestId('terminal-item-t1'))
    expect(onSelect).toHaveBeenCalledWith(mockTerminals[0])
  })

  it('calls onBack when back button is clicked', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(
      <MobileTerminalList
        projectName="My Project"
        terminals={mockTerminals}
        onSelectTerminal={() => {}}
        onBack={onBack}
      />
    )
    fireEvent.click(getByTestId('terminal-list-back'))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('shows empty state when no terminals', () => {
    const { getByTestId } = render(
      <MobileTerminalList
        projectName="My Project"
        terminals={[]}
        onSelectTerminal={() => {}}
        onBack={() => {}}
      />
    )
    expect(getByTestId('mobile-terminal-list').textContent).toContain('No terminals found')
  })

  it('shows last activity time per terminal', () => {
    const { getByTestId } = render(
      <MobileTerminalList
        projectName="My Project"
        terminals={mockTerminals}
        onSelectTerminal={() => {}}
        onBack={() => {}}
      />
    )
    expect(getByTestId('terminal-item-t1').textContent).toContain('just now')
    expect(getByTestId('terminal-item-t2').textContent).toContain('2m ago')
  })
})
