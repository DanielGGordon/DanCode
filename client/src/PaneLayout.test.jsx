import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
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
        data-focused={props.focused ? 'true' : 'false'}
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

  it('displays CLI, Claude, and Ralph labels in split mode', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    expect(getByTestId('pane-0').textContent).toContain('CLI')
    expect(getByTestId('pane-1').textContent).toContain('Claude')
    expect(getByTestId('pane-2').textContent).toContain('Ralph')
  })

  it('defaults to split layout mode', () => {
    const { getByTestId, queryByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    // Toggle button should say "Tabs" (offering switch to tabs)
    expect(getByTestId('layout-toggle').textContent).toBe('Tabs')
    // Tab bar should not be present in split mode
    expect(queryByTestId('tab-bar')).toBeNull()
  })

  it('uses flex-row for split panes container', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    // The split panes are inside a nested flex-row div
    const pane0 = getByTestId('pane-0')
    expect(pane0.parentElement.className).toContain('flex-row')
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

  it('focuses the first pane by default', () => {
    render(<PaneLayout token="tok" slug="myproj" />)
    expect(terminalInstances[0].focused).toBe(true)
    expect(terminalInstances[1].focused).toBe(false)
    expect(terminalInstances[2].focused).toBe(false)
  })

  it('passes onFocus callback to each Terminal', () => {
    render(<PaneLayout token="tok" slug="myproj" />)
    terminalInstances.forEach((inst) => {
      expect(typeof inst.onFocus).toBe('function')
    })
  })

  it('switches focus when a pane is clicked', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    // Clear captured instances from initial render
    terminalInstances.length = 0

    fireEvent.click(getByTestId('pane-1'))

    // After re-render, pane 1 should be focused
    const pane1Terminal = terminalInstances.find((inst) => inst.pane === 1)
    const pane0Terminal = terminalInstances.find((inst) => inst.pane === 0)
    expect(pane1Terminal.focused).toBe(true)
    expect(pane0Terminal.focused).toBe(false)
  })

  it('highlights focused pane label with brighter text', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    // Pane 0 is focused by default — its label should have text-base1
    const pane0Label = getByTestId('pane-0').querySelector('div')
    expect(pane0Label.className).toContain('text-base1')

    // Pane 1 is not focused — its label should have text-base01
    const pane1Label = getByTestId('pane-1').querySelector('div')
    expect(pane1Label.className).toContain('text-base01')
  })

  it('updates visual highlight when focus changes via click', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    fireEvent.click(getByTestId('pane-2'))

    const pane2Label = getByTestId('pane-2').querySelector('div')
    expect(pane2Label.className).toContain('text-base1')

    const pane0Label = getByTestId('pane-0').querySelector('div')
    expect(pane0Label.className).toContain('text-base01')
  })

  it('updates focus when Terminal fires onFocus callback', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Simulate xterm native focus on pane 2
    const pane2Inst = terminalInstances.find((inst) => inst.pane === 2)
    act(() => {
      pane2Inst.onFocus()
    })

    // After re-render, pane 2 label should be highlighted
    const pane2Label = getByTestId('pane-2').querySelector('div')
    expect(pane2Label.className).toContain('text-base1')

    // And pane 0 label should no longer be highlighted
    const pane0Label = getByTestId('pane-0').querySelector('div')
    expect(pane0Label.className).toContain('text-base01')
  })
})

describe('PaneLayout toggle (split ↔ tabs)', () => {
  it('renders a layout toggle button', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    expect(getByTestId('layout-toggle')).toBeDefined()
  })

  it('switches to tabbed mode when toggle is clicked', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    fireEvent.click(getByTestId('layout-toggle'))

    // Button should now say "Split"
    expect(getByTestId('layout-toggle').textContent).toBe('Split')
    // Tab bar should appear
    expect(getByTestId('tab-bar')).toBeDefined()
    // Tabbed content container should be present
    expect(getByTestId('tabbed-content')).toBeDefined()
  })

  it('switches back to split mode when toggle is clicked again', () => {
    const { getByTestId, queryByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    fireEvent.click(getByTestId('layout-toggle')) // → tabs
    fireEvent.click(getByTestId('layout-toggle')) // → split

    expect(getByTestId('layout-toggle').textContent).toBe('Tabs')
    expect(queryByTestId('tab-bar')).toBeNull()
    expect(queryByTestId('tabbed-content')).toBeNull()
  })

  it('shows tab buttons for each pane in tabbed mode', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    fireEvent.click(getByTestId('layout-toggle'))

    expect(getByTestId('tab-0').textContent).toBe('CLI')
    expect(getByTestId('tab-1').textContent).toBe('Claude')
    expect(getByTestId('tab-2').textContent).toBe('Ralph')
  })

  it('shows only the focused pane in tabbed mode (others are hidden)', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    fireEvent.click(getByTestId('layout-toggle'))

    // Pane 0 is focused by default — should be visible
    expect(getByTestId('pane-0').className).not.toContain('hidden')
    // Other panes should be hidden
    expect(getByTestId('pane-1').className).toContain('hidden')
    expect(getByTestId('pane-2').className).toContain('hidden')
  })

  it('switches visible pane when a tab is clicked', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    fireEvent.click(getByTestId('layout-toggle'))

    fireEvent.click(getByTestId('tab-1'))

    expect(getByTestId('pane-1').className).not.toContain('hidden')
    expect(getByTestId('pane-0').className).toContain('hidden')
    expect(getByTestId('pane-2').className).toContain('hidden')
  })

  it('highlights the active tab button', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    fireEvent.click(getByTestId('layout-toggle'))

    // Tab 0 should be highlighted (active)
    expect(getByTestId('tab-0').className).toContain('text-base1')
    expect(getByTestId('tab-1').className).toContain('text-base01')

    // Click tab 2
    fireEvent.click(getByTestId('tab-2'))
    expect(getByTestId('tab-2').className).toContain('text-base1')
    expect(getByTestId('tab-0').className).toContain('text-base01')
  })

  it('preserves focused pane when switching layout modes', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Focus pane 2 in split mode
    fireEvent.click(getByTestId('pane-2'))

    // Switch to tabs — pane 2 should still be focused
    fireEvent.click(getByTestId('layout-toggle'))
    expect(getByTestId('pane-2').className).not.toContain('hidden')
    expect(getByTestId('pane-0').className).toContain('hidden')
    expect(getByTestId('tab-2').className).toContain('text-base1')
  })

  it('renders all Terminal instances in tabbed mode (hidden panes still mounted)', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    terminalInstances.length = 0

    fireEvent.click(getByTestId('layout-toggle'))

    // All three terminals should be rendered (even hidden ones)
    expect(terminalInstances).toHaveLength(3)
  })
})
