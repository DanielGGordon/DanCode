import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import PaneLayout, { ALL_PANES } from './PaneLayout.jsx'

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

  it('renders three panes by default (CLI, Claude, Ralph)', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    expect(getByTestId('pane-0')).toBeDefined()
    expect(getByTestId('pane-1')).toBeDefined()
    expect(getByTestId('pane-2')).toBeDefined()
  })

  it('renders three Terminal components with different pane indices', () => {
    render(<PaneLayout token="tok" slug="myproj" />)
    expect(terminalInstances).toHaveLength(3)
    expect(terminalInstances[0]).toMatchObject({ token: 'tok', slug: 'myproj', pane: 0 })
    expect(terminalInstances[1]).toMatchObject({ token: 'tok', slug: 'myproj', pane: 1 })
    expect(terminalInstances[2]).toMatchObject({ token: 'tok', slug: 'myproj', pane: 2 })
  })

  it('displays CLI, Claude, and Ralph labels', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    expect(getByTestId('pane-0').textContent).toContain('CLI')
    expect(getByTestId('pane-1').textContent).toContain('Claude')
    expect(getByTestId('pane-2').textContent).toContain('Ralph')
  })

  it('uses flex-row layout for side-by-side display', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    const layout = getByTestId('pane-layout')
    expect(layout.className).toContain('flex')
    expect(layout.className).toContain('flex-row')
  })

  it('gives each pane equal width via flex-1 (33/33/33 split)', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    expect(getByTestId('pane-0').className).toContain('flex-1')
    expect(getByTestId('pane-1').className).toContain('flex-1')
    expect(getByTestId('pane-2').className).toContain('flex-1')
  })

  it('exports ALL_PANES with three entries', () => {
    expect(ALL_PANES).toHaveLength(3)
    expect(ALL_PANES.map(p => p.label)).toEqual(['CLI', 'Claude', 'Ralph'])
  })

  it('accepts a custom panes prop to show a subset', () => {
    const twoPanes = [ALL_PANES[0], ALL_PANES[1]]
    const { getByTestId, queryByTestId } = render(
      <PaneLayout token="tok" slug="myproj" panes={twoPanes} />
    )
    expect(getByTestId('pane-0')).toBeDefined()
    expect(getByTestId('pane-1')).toBeDefined()
    expect(queryByTestId('pane-2')).toBeNull()
    expect(terminalInstances).toHaveLength(2)
  })

  it('renders 50/50 split when given two panes', () => {
    const twoPanes = [ALL_PANES[0], ALL_PANES[1]]
    const { getByTestId } = render(
      <PaneLayout token="tok" slug="myproj" panes={twoPanes} />
    )
    expect(getByTestId('pane-0').className).toContain('flex-1')
    expect(getByTestId('pane-1').className).toContain('flex-1')
  })
})
