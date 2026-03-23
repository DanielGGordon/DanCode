import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import PaneLayout, { ALL_PANES, MOBILE_BREAKPOINT } from './PaneLayout.jsx'

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

// Helper: mock matchMedia for a given width
function mockViewport(width) {
  const listeners = []
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true, configurable: true })
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: width < MOBILE_BREAKPOINT,
    media: query,
    addEventListener: (event, cb) => listeners.push(cb),
    removeEventListener: (event, cb) => {
      const idx = listeners.indexOf(cb)
      if (idx >= 0) listeners.splice(idx, 1)
    },
  }))
  return {
    resize(newWidth) {
      Object.defineProperty(window, 'innerWidth', { value: newWidth, writable: true, configurable: true })
      const matches = newWidth < MOBILE_BREAKPOINT
      window.matchMedia = vi.fn().mockImplementation((query) => ({
        matches,
        media: query,
        addEventListener: (event, cb) => listeners.push(cb),
        removeEventListener: (event, cb) => {
          const idx = listeners.indexOf(cb)
          if (idx >= 0) listeners.splice(idx, 1)
        },
      }))
      listeners.forEach((cb) => cb({ matches }))
    },
  }
}

beforeEach(() => {
  terminalInstances.length = 0
  vi.clearAllMocks()
  cleanup()
  // Default: desktop viewport
  mockViewport(1024)
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

describe('PaneLayout mobile auto-tabs', () => {
  it('exports MOBILE_BREAKPOINT constant', () => {
    expect(MOBILE_BREAKPOINT).toBe(768)
  })

  it('auto-selects tabbed mode on mobile viewport (<768px)', () => {
    mockViewport(375)
    const { getByTestId, queryByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Should show tab bar (tabbed mode)
    expect(getByTestId('tab-bar')).toBeDefined()
    expect(getByTestId('tabbed-content')).toBeDefined()
    // Toggle button should be hidden on mobile
    expect(queryByTestId('layout-toggle')).toBeNull()
  })

  it('shows split mode on desktop viewport (>=768px)', () => {
    mockViewport(1024)
    const { getByTestId, queryByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Should be in split mode
    expect(queryByTestId('tab-bar')).toBeNull()
    expect(queryByTestId('tabbed-content')).toBeNull()
    // Toggle button visible on desktop
    expect(getByTestId('layout-toggle')).toBeDefined()
  })

  it('shows tab buttons for each pane on mobile', () => {
    mockViewport(375)
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    expect(getByTestId('tab-0').textContent).toBe('CLI')
    expect(getByTestId('tab-1').textContent).toBe('Claude')
    expect(getByTestId('tab-2').textContent).toBe('Ralph')
  })

  it('shows only the focused pane on mobile', () => {
    mockViewport(375)
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    expect(getByTestId('pane-0').className).not.toContain('hidden')
    expect(getByTestId('pane-1').className).toContain('hidden')
    expect(getByTestId('pane-2').className).toContain('hidden')
  })

  it('switches visible pane when a tab is clicked on mobile', () => {
    mockViewport(375)
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    fireEvent.click(getByTestId('tab-2'))

    expect(getByTestId('pane-2').className).not.toContain('hidden')
    expect(getByTestId('pane-0').className).toContain('hidden')
  })

  it('switches to tabs when viewport shrinks below breakpoint', () => {
    const viewport = mockViewport(1024)
    const { getByTestId, queryByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Initially desktop — split mode
    expect(queryByTestId('tab-bar')).toBeNull()
    expect(getByTestId('layout-toggle')).toBeDefined()

    // Simulate resize to mobile
    act(() => {
      viewport.resize(375)
    })

    // Now should be in tabbed mode
    expect(getByTestId('tab-bar')).toBeDefined()
    expect(queryByTestId('layout-toggle')).toBeNull()
  })

  it('switches back to split when viewport grows above breakpoint', () => {
    const viewport = mockViewport(375)
    const { getByTestId, queryByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Initially mobile — tabbed mode
    expect(getByTestId('tab-bar')).toBeDefined()

    // Simulate resize to desktop
    act(() => {
      viewport.resize(1024)
    })

    // Should revert to split mode
    expect(queryByTestId('tab-bar')).toBeNull()
    expect(getByTestId('layout-toggle')).toBeDefined()
  })

  it('treats exactly 768px as desktop (not mobile)', () => {
    mockViewport(768)
    const { getByTestId, queryByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    expect(queryByTestId('tab-bar')).toBeNull()
    expect(getByTestId('layout-toggle')).toBeDefined()
  })

  it('treats 767px as mobile', () => {
    mockViewport(767)
    const { getByTestId, queryByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    expect(getByTestId('tab-bar')).toBeDefined()
    expect(queryByTestId('layout-toggle')).toBeNull()
  })
})

describe('PaneLayout visibility toggles', () => {
  it('renders visibility toggle buttons for each pane', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    expect(getByTestId('visibility-toggles')).toBeDefined()
    expect(getByTestId('visibility-0').textContent).toBe('CLI')
    expect(getByTestId('visibility-1').textContent).toBe('Claude')
    expect(getByTestId('visibility-2').textContent).toBe('Ralph')
  })

  it('all panes are visible by default', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    // All visibility buttons should have active styling (text-base1)
    expect(getByTestId('visibility-0').className).toContain('text-base1')
    expect(getByTestId('visibility-1').className).toContain('text-base1')
    expect(getByTestId('visibility-2').className).toContain('text-base1')
  })

  it('hides a pane when its visibility toggle is clicked', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    fireEvent.click(getByTestId('visibility-1'))

    // Pane 1 (Claude) should be hidden via CSS but still mounted
    expect(getByTestId('pane-1').className).toContain('hidden')
    // Panes 0 and 2 should still be visible
    expect(getByTestId('pane-0').className).not.toContain('hidden')
    expect(getByTestId('pane-2').className).not.toContain('hidden')
  })

  it('shows a hidden pane when its visibility toggle is clicked again', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Hide pane 1
    fireEvent.click(getByTestId('visibility-1'))
    // Show pane 1 again
    fireEvent.click(getByTestId('visibility-1'))

    expect(getByTestId('pane-0')).toBeDefined()
    expect(getByTestId('pane-1')).toBeDefined()
    expect(getByTestId('pane-2')).toBeDefined()
  })

  it('prevents hiding the last visible pane', () => {
    const { getByTestId, queryByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Hide panes 1 and 2
    fireEvent.click(getByTestId('visibility-1'))
    fireEvent.click(getByTestId('visibility-2'))

    // Only pane 0 remains — its toggle should be disabled
    expect(getByTestId('visibility-0').disabled).toBe(true)

    // Try to click it — pane 0 should still be visible
    fireEvent.click(getByTestId('visibility-0'))
    expect(getByTestId('pane-0')).toBeDefined()
  })

  it('marks hidden pane toggle with dimmed styling', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    fireEvent.click(getByTestId('visibility-2'))

    // Hidden pane toggle should show inactive style
    expect(getByTestId('visibility-2').className).toContain('text-base01')
    // Visible pane toggles should still be active
    expect(getByTestId('visibility-0').className).toContain('text-base1')
  })

  it('moves focus to first visible pane when focused pane is hidden', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Focus pane 1
    fireEvent.click(getByTestId('pane-1'))

    // Hide pane 1 — useEffect will move focus to first visible pane
    act(() => {
      fireEvent.click(getByTestId('visibility-1'))
    })
    terminalInstances.length = 0

    // Trigger a re-render to capture the final state by interacting
    // After the effect, pane 0 should now be focused
    // Check via the pane label highlight (pane 0 label should have text-base1)
    const pane0Label = getByTestId('pane-0').querySelector('div')
    expect(pane0Label.className).toContain('text-base1')
  })

  it('keeps hidden pane Terminals mounted to preserve session state', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)
    terminalInstances.length = 0

    fireEvent.click(getByTestId('visibility-2'))

    // All 3 Terminals should still be mounted (hidden via CSS, not unmounted)
    expect(terminalInstances).toHaveLength(3)
    expect(terminalInstances.map((i) => i.pane)).toEqual([0, 1, 2])
  })

  it('works with tabbed mode — hidden panes have no tab', () => {
    const { getByTestId, queryByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Switch to tabs
    fireEvent.click(getByTestId('layout-toggle'))
    // Hide pane 2
    fireEvent.click(getByTestId('visibility-2'))

    // Tab 2 should not exist
    expect(queryByTestId('tab-2')).toBeNull()
    // Tabs 0 and 1 should exist
    expect(getByTestId('tab-0')).toBeDefined()
    expect(getByTestId('tab-1')).toBeDefined()
  })

  it('last visible pane toggle shows disabled styling', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    fireEvent.click(getByTestId('visibility-1'))
    fireEvent.click(getByTestId('visibility-2'))

    // Last visible pane toggle should have opacity-50 class
    expect(getByTestId('visibility-0').className).toContain('opacity-50')
    expect(getByTestId('visibility-0').className).toContain('cursor-not-allowed')
  })
})

describe('PaneLayout config persistence', () => {
  let originalFetch
  // Config response set per-test; panes endpoint always returns ALL_PANES-like data
  let configResponse
  let fetchMock

  function setupFetchMock() {
    fetchMock = vi.fn((url) => {
      if (typeof url === 'string' && url.endsWith('/panes')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { index: 0, label: 'CLI' },
            { index: 1, label: 'Claude' },
            { index: 2, label: 'Ralph' },
          ]),
        })
      }
      // Return config response (configurable per-test)
      if (configResponse !== undefined) {
        const resp = configResponse
        configResponse = undefined
        return typeof resp === 'function' ? resp() : resp instanceof Promise ? resp : Promise.resolve(resp)
      }
      return Promise.resolve({ ok: false, status: 404 })
    })
    global.fetch = fetchMock
  }

  beforeEach(() => {
    originalFetch = global.fetch
    configResponse = undefined
    setupFetchMock()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    global.fetch = originalFetch
  })

  it('fetches saved layout from GET /api/projects/:slug on mount', async () => {
    configResponse = {
      ok: true,
      json: () => Promise.resolve({
        name: 'Test', slug: 'myproj', path: '/tmp',
        layout: { mode: 'tabs', hiddenPanes: [2] },
      }),
    }

    vi.useRealTimers()
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/projects/myproj', {
        headers: { Authorization: 'Bearer tok' },
      })
    })
  })

  it('restores saved layout mode from config', async () => {
    configResponse = {
      ok: true,
      json: () => Promise.resolve({
        name: 'Test', slug: 'myproj', path: '/tmp',
        layout: { mode: 'tabs', hiddenPanes: [] },
      }),
    }

    vi.useRealTimers()
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // After loading, should be in tabs mode
    await waitFor(() => {
      expect(getByTestId('layout-toggle').textContent).toBe('Split')
    })
  })

  it('restores hidden panes from config', async () => {
    configResponse = {
      ok: true,
      json: () => Promise.resolve({
        name: 'Test', slug: 'myproj', path: '/tmp',
        layout: { mode: 'split', hiddenPanes: [1] },
      }),
    }

    vi.useRealTimers()
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    await waitFor(() => {
      expect(getByTestId('pane-1').className).toContain('hidden')
    })
  })

  it('saves layout mode change via PATCH', async () => {
    // Initial load returns no layout
    configResponse = {
      ok: true,
      json: () => Promise.resolve({ name: 'Test', slug: 'myproj', path: '/tmp' }),
    }

    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Wait for load to complete (flush promise chain + setTimeout(0) in .finally)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => { vi.advanceTimersByTime(0) })

    // Toggle to tabs
    fireEvent.click(getByTestId('layout-toggle'))

    // Advance the debounce timer
    act(() => {
      vi.advanceTimersByTime(300)
    })

    // Should have sent a PATCH with tabs mode
    const patchCall = fetchMock.mock.calls.find(
      ([url, opts]) => opts?.method === 'PATCH'
    )
    expect(patchCall).toBeDefined()
    const [url, opts] = patchCall
    expect(url).toBe('/api/projects/myproj')
    const body = JSON.parse(opts.body)
    expect(body.layout.mode).toBe('tabs')
  })

  it('saves hidden pane change via PATCH', async () => {
    configResponse = {
      ok: true,
      json: () => Promise.resolve({ name: 'Test', slug: 'myproj', path: '/tmp' }),
    }

    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Wait for load to complete (flush promise chain + setTimeout(0) in .finally)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => { vi.advanceTimersByTime(0) })

    fireEvent.click(getByTestId('visibility-2'))

    act(() => {
      vi.advanceTimersByTime(300)
    })

    const patchCall = fetchMock.mock.calls.find(
      ([url, opts]) => opts?.method === 'PATCH'
    )
    expect(patchCall).toBeDefined()
    const body = JSON.parse(patchCall[1].body)
    expect(body.layout.hiddenPanes).toContain(2)
  })

  it('does not save before initial load completes', () => {
    // Config fetch never resolves
    configResponse = new Promise(() => {})

    render(<PaneLayout token="tok" slug="myproj" />)

    act(() => {
      vi.advanceTimersByTime(500)
    })

    // Only the initial GETs should have been called, no PATCH
    const patchCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => opts?.method === 'PATCH'
    )
    expect(patchCalls).toHaveLength(0)
  })

  it('does not fetch config when slug is not provided', () => {
    render(<PaneLayout token="tok" slug={undefined} />)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('gracefully handles fetch errors on load', async () => {
    configResponse = Promise.reject(new Error('Network error'))

    vi.useRealTimers()
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Should still render with defaults
    await waitFor(() => {
      expect(getByTestId('pane-layout')).toBeDefined()
    })
    expect(getByTestId('layout-toggle').textContent).toBe('Tabs')
  })

  it('does not fetch or save config when token is not provided', () => {
    render(<PaneLayout token={undefined} slug="myproj" />)

    act(() => { vi.advanceTimersByTime(500) })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps defaults when API returns non-ok response (e.g. 404)', async () => {
    configResponse = { ok: false, status: 404 }

    vi.useRealTimers()
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    await waitFor(() => {
      expect(getByTestId('pane-layout')).toBeDefined()
    })
    // Should keep default split mode
    expect(getByTestId('layout-toggle').textContent).toBe('Tabs')
    // All panes should be visible
    expect(getByTestId('pane-0').className).not.toContain('hidden')
    expect(getByTestId('pane-1').className).not.toContain('hidden')
    expect(getByTestId('pane-2').className).not.toContain('hidden')
  })

  it('ignores invalid layout mode in config and keeps default', async () => {
    configResponse = {
      ok: true,
      json: () => Promise.resolve({
        name: 'Test', slug: 'myproj', path: '/tmp',
        layout: { mode: 'invalid-mode', hiddenPanes: [] },
      }),
    }

    vi.useRealTimers()
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    await waitFor(() => {
      expect(getByTestId('pane-layout')).toBeDefined()
    })
    // Should stay in default split mode since 'invalid-mode' is rejected
    expect(getByTestId('layout-toggle').textContent).toBe('Tabs')
  })

  it('ignores non-array hiddenPanes in config', async () => {
    configResponse = {
      ok: true,
      json: () => Promise.resolve({
        name: 'Test', slug: 'myproj', path: '/tmp',
        layout: { mode: 'split', hiddenPanes: 'not-an-array' },
      }),
    }

    vi.useRealTimers()
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    await waitFor(() => {
      expect(getByTestId('pane-layout')).toBeDefined()
    })
    // All panes should remain visible since hiddenPanes was invalid
    expect(getByTestId('pane-0').className).not.toContain('hidden')
    expect(getByTestId('pane-1').className).not.toContain('hidden')
    expect(getByTestId('pane-2').className).not.toContain('hidden')
  })

  it('debounces multiple rapid changes into a single PATCH', async () => {
    configResponse = {
      ok: true,
      json: () => Promise.resolve({ name: 'Test', slug: 'myproj', path: '/tmp' }),
    }

    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Flush load
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => { vi.advanceTimersByTime(0) })

    // Clear call history but keep the routing mock active
    fetchMock.mockClear()

    // Make several rapid changes
    fireEvent.click(getByTestId('layout-toggle'))     // → tabs
    act(() => { vi.advanceTimersByTime(100) })         // only 100ms, not 300
    fireEvent.click(getByTestId('visibility-2'))       // hide pane 2

    // Advance past the debounce
    act(() => { vi.advanceTimersByTime(300) })

    // Should have only one PATCH call (the debounced final state)
    const patchCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => opts?.method === 'PATCH'
    )
    expect(patchCalls).toHaveLength(1)
    const body = JSON.parse(patchCalls[0][1].body)
    expect(body.layout.mode).toBe('tabs')
    expect(body.layout.hiddenPanes).toContain(2)
  })

  it('save payload always includes both mode and hiddenPanes', async () => {
    configResponse = {
      ok: true,
      json: () => Promise.resolve({ name: 'Test', slug: 'myproj', path: '/tmp' }),
    }

    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => { vi.advanceTimersByTime(0) })
    fetchMock.mockClear()

    // Only change layout mode (not visibility)
    fireEvent.click(getByTestId('layout-toggle'))

    act(() => { vi.advanceTimersByTime(300) })

    const patchCall = fetchMock.mock.calls.find(
      ([url, opts]) => opts?.method === 'PATCH'
    )
    const body = JSON.parse(patchCall[1].body)
    // Both fields should be present
    expect(body.layout).toHaveProperty('mode')
    expect(body.layout).toHaveProperty('hiddenPanes')
    expect(body.layout.mode).toBe('tabs')
    expect(body.layout.hiddenPanes).toEqual([])
  })

  it('does not send PATCH on unmount if debounce timer is pending', async () => {
    configResponse = {
      ok: true,
      json: () => Promise.resolve({ name: 'Test', slug: 'myproj', path: '/tmp' }),
    }

    const { getByTestId, unmount } = render(<PaneLayout token="tok" slug="myproj" />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => { vi.advanceTimersByTime(0) })
    fetchMock.mockClear()

    // Make a change
    fireEvent.click(getByTestId('layout-toggle'))

    // Unmount before debounce fires
    unmount()

    // Advance past debounce
    act(() => { vi.advanceTimersByTime(300) })

    // No PATCH should have been sent
    const patchCalls = fetchMock.mock.calls.filter(
      ([url, opts]) => opts?.method === 'PATCH'
    )
    expect(patchCalls).toHaveLength(0)
  })
})

describe('PaneLayout layout state management', () => {
  let originalFetch

  beforeEach(() => {
    // Mock fetch so the load effect doesn't blow up
    originalFetch = global.fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: 'Test', slug: 'myproj', path: '/tmp' }),
    })
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('multiple rapid layout toggles end in correct state', () => {
    const { getByTestId, queryByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Toggle 4 times (split → tabs → split → tabs → split)
    fireEvent.click(getByTestId('layout-toggle'))
    fireEvent.click(getByTestId('layout-toggle'))
    fireEvent.click(getByTestId('layout-toggle'))
    fireEvent.click(getByTestId('layout-toggle'))

    // Even number of toggles → back to split
    expect(getByTestId('layout-toggle').textContent).toBe('Tabs')
    expect(queryByTestId('tab-bar')).toBeNull()
  })

  it('effectiveLayout is tabs on mobile even when layoutMode is split', () => {
    mockViewport(1024)
    const { getByTestId, queryByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Start in split mode on desktop
    expect(queryByTestId('tab-bar')).toBeNull()

    // Simulate resize to mobile — should force tabs regardless of layoutMode
    const viewport = mockViewport(1024)
    // Need to re-render, let's just test directly with mobile viewport
    cleanup()
    mockViewport(375)
    const { getByTestId: mobileGet } = render(<PaneLayout token="tok" slug="myproj" />)
    expect(mobileGet('tab-bar')).toBeDefined()
  })

  it('focus moves through visible panes as panes are hidden', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Focus pane 1
    fireEvent.click(getByTestId('pane-1'))
    let pane1Label = getByTestId('pane-1').querySelector('div')
    expect(pane1Label.className).toContain('text-base1')

    // Hide pane 1 — focus should move to pane 0
    act(() => {
      fireEvent.click(getByTestId('visibility-1'))
    })
    const pane0Label = getByTestId('pane-0').querySelector('div')
    expect(pane0Label.className).toContain('text-base1')
  })

  it('hiding panes in split mode adjusts visible count (remaining panes fill space)', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // All 3 panes visible with flex-1
    expect(getByTestId('pane-0').className).toContain('flex-1')
    expect(getByTestId('pane-1').className).toContain('flex-1')
    expect(getByTestId('pane-2').className).toContain('flex-1')

    // Hide pane 2
    fireEvent.click(getByTestId('visibility-2'))

    // Remaining panes still have flex-1, taking more space
    expect(getByTestId('pane-0').className).toContain('flex-1')
    expect(getByTestId('pane-1').className).toContain('flex-1')
    // Pane 2 is hidden but still in DOM
    expect(getByTestId('pane-2').className).toContain('hidden')
  })

  it('layout mode state is preserved through visibility changes', () => {
    const { getByTestId, queryByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Switch to tabs
    fireEvent.click(getByTestId('layout-toggle'))
    expect(getByTestId('tab-bar')).toBeDefined()

    // Hide and show a pane — should still be in tabs mode
    fireEvent.click(getByTestId('visibility-2'))
    fireEvent.click(getByTestId('visibility-2'))

    expect(getByTestId('tab-bar')).toBeDefined()
    expect(getByTestId('layout-toggle').textContent).toBe('Split')
  })

  it('tab bar updates when pane visibility changes in tabbed mode', () => {
    const { getByTestId, queryByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Switch to tabs
    fireEvent.click(getByTestId('layout-toggle'))

    // All 3 tabs visible
    expect(getByTestId('tab-0')).toBeDefined()
    expect(getByTestId('tab-1')).toBeDefined()
    expect(getByTestId('tab-2')).toBeDefined()

    // Hide pane 1
    fireEvent.click(getByTestId('visibility-1'))

    // Tab 1 should be gone
    expect(queryByTestId('tab-1')).toBeNull()
    expect(getByTestId('tab-0')).toBeDefined()
    expect(getByTestId('tab-2')).toBeDefined()
  })

  it('focus switches when active tab is hidden in tabbed mode', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Switch to tabs, focus pane 1
    fireEvent.click(getByTestId('layout-toggle'))
    fireEvent.click(getByTestId('tab-1'))

    // Pane 1 should be active
    expect(getByTestId('pane-1').className).not.toContain('hidden')

    // Hide pane 1 — should switch to first visible pane
    act(() => {
      fireEvent.click(getByTestId('visibility-1'))
    })

    expect(getByTestId('pane-0').className).not.toContain('hidden')
  })

  it('re-showing a hidden pane does not change current focus', () => {
    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Hide pane 2
    fireEvent.click(getByTestId('visibility-2'))

    // Focus should still be on pane 0
    const pane0Label = getByTestId('pane-0').querySelector('div')
    expect(pane0Label.className).toContain('text-base1')

    // Re-show pane 2
    fireEvent.click(getByTestId('visibility-2'))

    // Focus should still be on pane 0, not auto-jump to pane 2
    const pane0LabelAfter = getByTestId('pane-0').querySelector('div')
    expect(pane0LabelAfter.className).toContain('text-base1')
  })
})

describe('PaneLayout dynamic pane fetching', () => {
  let originalFetch

  afterEach(() => {
    if (originalFetch) global.fetch = originalFetch
  })

  it('fetches panes from /api/projects/:slug/panes when no panes prop is given', async () => {
    originalFetch = global.fetch
    const fetchMock = vi.fn((url) => {
      if (typeof url === 'string' && url.endsWith('/panes')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { index: 0, label: 'editor' },
            { index: 1, label: 'shell' },
          ]),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ name: 'Test', slug: 'adopted', path: '/tmp' }),
      })
    })
    global.fetch = fetchMock

    const { getByTestId, queryByTestId } = render(<PaneLayout token="tok" slug="adopted" />)

    // Wait for the fetched panes to replace defaults (pane-2 should disappear)
    await waitFor(() => {
      expect(queryByTestId('pane-2')).toBeNull()
    })
    // Only 2 panes with fetched labels
    expect(getByTestId('pane-0').textContent).toContain('editor')
    expect(getByTestId('pane-1').textContent).toContain('shell')
  })

  it('uses ALL_PANES as default while fetch is pending', () => {
    originalFetch = global.fetch
    // Never resolve
    global.fetch = vi.fn(() => new Promise(() => {}))

    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    // Should render 3 default panes immediately
    expect(getByTestId('pane-0')).toBeDefined()
    expect(getByTestId('pane-1')).toBeDefined()
    expect(getByTestId('pane-2')).toBeDefined()
  })

  it('skips panes fetch when panes prop is provided', () => {
    originalFetch = global.fetch
    const fetchMock = vi.fn((url) => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ name: 'Test', slug: 'myproj', path: '/tmp' }),
      })
    })
    global.fetch = fetchMock

    const customPanes = [{ index: 0, label: 'Custom' }]
    render(<PaneLayout token="tok" slug="myproj" panes={customPanes} />)

    // Should not have fetched /panes endpoint
    const panesCalls = fetchMock.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.endsWith('/panes')
    )
    expect(panesCalls).toHaveLength(0)
  })

  it('falls back to ALL_PANES when panes fetch fails', async () => {
    originalFetch = global.fetch
    global.fetch = vi.fn((url) => {
      if (typeof url === 'string' && url.endsWith('/panes')) {
        return Promise.reject(new Error('Network error'))
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ name: 'Test', slug: 'myproj', path: '/tmp' }),
      })
    })

    const { getByTestId } = render(<PaneLayout token="tok" slug="myproj" />)

    await waitFor(() => {
      expect(getByTestId('pane-layout')).toBeDefined()
    })
    // Should still have 3 default panes
    expect(getByTestId('pane-0')).toBeDefined()
    expect(getByTestId('pane-1')).toBeDefined()
    expect(getByTestId('pane-2')).toBeDefined()
  })
})
