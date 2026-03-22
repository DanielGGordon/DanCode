import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import PaneLayout from './PaneLayout.jsx'

// Mock Terminal to capture props without xterm.js side effects
const terminalInstances = []
vi.mock('./Terminal.jsx', () => ({
  default: (props) => {
    terminalInstances.push(props)
    return (
      <div
        data-testid="terminal"
        data-slug={props.slug || ''}
        data-pane={props.pane != null ? props.pane : ''}
      >
        Terminal
      </div>
    )
  },
}))

beforeEach(() => {
  terminalInstances.length = 0
  vi.clearAllMocks()
  cleanup()
})

describe('PaneLayout', () => {
  it('renders a pane-layout container', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    expect(getByTestId('pane-layout')).toBeDefined()
  })

  it('renders two panes side by side', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    expect(getByTestId('pane-0')).toBeDefined()
    expect(getByTestId('pane-1')).toBeDefined()
  })

  it('renders two Terminal components with different pane indices', () => {
    render(<PaneLayout token="tok" slug="myproj" />)
    expect(terminalInstances).toHaveLength(2)
    expect(terminalInstances[0]).toMatchObject({ token: 'tok', slug: 'myproj', pane: 0 })
    expect(terminalInstances[1]).toMatchObject({ token: 'tok', slug: 'myproj', pane: 1 })
  })

  it('displays CLI label on first pane and Claude label on second', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    expect(getByTestId('pane-0').textContent).toContain('CLI')
    expect(getByTestId('pane-1').textContent).toContain('Claude')
  })

  it('uses flex-row layout for side-by-side display', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    const layout = getByTestId('pane-layout')
    expect(layout.className).toContain('flex')
    expect(layout.className).toContain('flex-row')
  })

  it('gives each pane equal width via flex-1', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    expect(getByTestId('pane-0').className).toContain('flex-1')
    expect(getByTestId('pane-1').className).toContain('flex-1')
  })
})
