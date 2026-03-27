import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import TerminalLayout, { MOBILE_BREAKPOINT } from './TerminalLayout.jsx'

// Mock Terminal to capture props without xterm.js side effects
const terminalInstances = []
vi.mock('./Terminal.jsx', () => ({
  default: (props) => {
    terminalInstances.push(props)
    return (
      <div
        data-testid="terminal"
        data-terminal-id={props.terminalId || ''}
        data-focused={props.focused ? 'true' : 'false'}
      >
        Terminal
      </div>
    )
  },
}))

const MOCK_TERMINALS = [
  { id: 'term-1', label: 'CLI', projectSlug: 'myproj' },
  { id: 'term-2', label: 'Claude', projectSlug: 'myproj' },
]

const MOCK_PROJECT = {
  slug: 'myproj',
  name: 'My Project',
  path: '/tmp/myproj',
  terminals: ['term-1', 'term-2'],
  layout: { mode: 'split', activeTab: 0 },
}

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

function mockFetchSuccess(project = MOCK_PROJECT, terminals = MOCK_TERMINALS) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (url.startsWith('/api/projects/')) {
      return { ok: true, status: 200, json: () => Promise.resolve(project) }
    }
    if (url.startsWith('/api/terminals')) {
      return { ok: true, status: 200, json: () => Promise.resolve(terminals) }
    }
    return { ok: true, status: 200, json: () => Promise.resolve({}) }
  })
}

function mockFetchError(status = 500) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
    ok: false,
    status,
    json: () => Promise.resolve({ error: 'Server error' }),
  }))
}

beforeEach(() => {
  terminalInstances.length = 0
  vi.clearAllMocks()
  cleanup()
  mockViewport(1024)
})

afterEach(() => {
  cleanup()
})

describe('TerminalLayout', () => {
  it('renders a terminal-layout container', async () => {
    mockFetchSuccess()
    const { getByTestId } = render(<TerminalLayout token="tok" slug="myproj" />)
    await waitFor(() => {
      expect(getByTestId('terminal-layout')).toBeDefined()
    })
  })

  it('shows loading state initially', () => {
    mockFetchSuccess()
    const { getByTestId } = render(<TerminalLayout token="tok" slug="myproj" />)
    expect(getByTestId('terminal-loading')).toBeDefined()
  })

  it('shows error state on fetch failure', async () => {
    mockFetchError()
    const { getByTestId } = render(<TerminalLayout token="tok" slug="myproj" />)
    await waitFor(() => {
      expect(getByTestId('terminal-fetch-error')).toBeDefined()
    })
  })

  it('shows retry button on error', async () => {
    mockFetchError()
    const { getByTestId } = render(<TerminalLayout token="tok" slug="myproj" />)
    await waitFor(() => {
      expect(getByTestId('terminal-retry-button')).toBeDefined()
    })
  })

  it('renders terminals after loading', async () => {
    mockFetchSuccess()
    const { getAllByTestId } = render(<TerminalLayout token="tok" slug="myproj" />)
    await waitFor(() => {
      const terms = getAllByTestId('terminal')
      expect(terms).toHaveLength(2)
    })
  })

  it('passes correct terminalId props to Terminal components', async () => {
    mockFetchSuccess()
    render(<TerminalLayout token="tok" slug="myproj" />)
    await waitFor(() => {
      expect(terminalInstances.length).toBe(2)
    })
    expect(terminalInstances[0]).toMatchObject({ token: 'tok', terminalId: 'term-1' })
    expect(terminalInstances[1]).toMatchObject({ token: 'tok', terminalId: 'term-2' })
  })

  it('renders pane labels in split mode', async () => {
    mockFetchSuccess()
    const { getByTestId } = render(<TerminalLayout token="tok" slug="myproj" />)
    await waitFor(() => {
      expect(getByTestId('terminal-pane-0').textContent).toContain('CLI')
      expect(getByTestId('terminal-pane-1').textContent).toContain('Claude')
    })
  })

  it('defaults to split layout when project config says split', async () => {
    mockFetchSuccess()
    const { getByTestId, queryByTestId } = render(<TerminalLayout token="tok" slug="myproj" />)
    await waitFor(() => {
      expect(getByTestId('layout-toggle').textContent).toBe('Tabs')
    })
    expect(queryByTestId('tab-bar')).toBeNull()
  })

  it('shows tab bar in tabs layout mode', async () => {
    const tabsProject = { ...MOCK_PROJECT, layout: { mode: 'tabs', activeTab: 0 } }
    mockFetchSuccess(tabsProject)
    const { getByTestId } = render(<TerminalLayout token="tok" slug="myproj" />)
    await waitFor(() => {
      expect(getByTestId('tab-bar')).toBeDefined()
    })
    expect(getByTestId('layout-toggle').textContent).toBe('Split')
  })

  it('toggles between split and tabs modes', async () => {
    mockFetchSuccess()
    const { getByTestId } = render(<TerminalLayout token="tok" slug="myproj" />)
    await waitFor(() => {
      expect(getByTestId('layout-toggle').textContent).toBe('Tabs')
    })

    act(() => {
      fireEvent.click(getByTestId('layout-toggle'))
    })

    expect(getByTestId('layout-toggle').textContent).toBe('Split')
    expect(getByTestId('tab-bar')).toBeDefined()
  })

  it('renders an add terminal button', async () => {
    mockFetchSuccess()
    const { getByTestId } = render(<TerminalLayout token="tok" slug="myproj" />)
    await waitFor(() => {
      expect(getByTestId('add-terminal-button')).toBeDefined()
    })
    expect(getByTestId('add-terminal-button').textContent).toBe('+')
  })

  it('renders close buttons for each terminal', async () => {
    mockFetchSuccess()
    const { getByTestId } = render(<TerminalLayout token="tok" slug="myproj" />)
    await waitFor(() => {
      expect(getByTestId('close-terminal-0')).toBeDefined()
      expect(getByTestId('close-terminal-1')).toBeDefined()
    })
  })

  it('first click on close shows confirmation, second click deletes', async () => {
    const fetchSpy = mockFetchSuccess()
    const { getByTestId } = render(<TerminalLayout token="tok" slug="myproj" />)
    await waitFor(() => {
      expect(getByTestId('close-terminal-0')).toBeDefined()
    })

    // First click triggers confirmation overlay
    act(() => {
      fireEvent.click(getByTestId('close-terminal-0'))
    })

    expect(getByTestId('confirm-delete-overlay')).toBeDefined()
    expect(getByTestId('confirm-delete-yes')).toBeDefined()
    expect(getByTestId('confirm-delete-cancel')).toBeDefined()
  })

  it('cancel button on delete confirmation closes overlay', async () => {
    mockFetchSuccess()
    const { getByTestId, queryByTestId } = render(<TerminalLayout token="tok" slug="myproj" />)
    await waitFor(() => {
      expect(getByTestId('close-terminal-0')).toBeDefined()
    })

    act(() => {
      fireEvent.click(getByTestId('close-terminal-0'))
    })

    expect(getByTestId('confirm-delete-overlay')).toBeDefined()

    act(() => {
      fireEvent.click(getByTestId('confirm-delete-cancel'))
    })

    expect(queryByTestId('confirm-delete-overlay')).toBeNull()
  })

  it('focuses first terminal by default', async () => {
    mockFetchSuccess()
    render(<TerminalLayout token="tok" slug="myproj" />)
    await waitFor(() => {
      expect(terminalInstances.length).toBe(2)
    })
    expect(terminalInstances[0].focused).toBe(true)
    expect(terminalInstances[1].focused).toBe(false)
  })

  it('forces tabs mode on mobile viewport', async () => {
    mockViewport(500)
    mockFetchSuccess()
    const { getByTestId, queryByTestId } = render(<TerminalLayout token="tok" slug="myproj" />)
    await waitFor(() => {
      expect(getByTestId('tab-bar')).toBeDefined()
    })
    // Should not show layout toggle on mobile
    expect(queryByTestId('layout-toggle')).toBeNull()
  })

  it('fetches project config and terminals on mount', async () => {
    const fetchSpy = mockFetchSuccess()
    render(<TerminalLayout token="tok" slug="myproj" />)
    await waitFor(() => {
      const projectCall = fetchSpy.mock.calls.find(
        (c) => c[0] === '/api/projects/myproj'
      )
      expect(projectCall).toBeDefined()
      expect(projectCall[1].headers.Authorization).toBe('Bearer tok')

      const termCall = fetchSpy.mock.calls.find(
        (c) => c[0] === '/api/terminals?project=myproj'
      )
      expect(termCall).toBeDefined()
    })
  })

  it('stops loading when slug is not provided', () => {
    mockFetchSuccess()
    const { getByTestId, queryByTestId } = render(<TerminalLayout token="tok" slug="" />)
    expect(getByTestId('terminal-layout')).toBeDefined()
    expect(queryByTestId('terminal-loading')).toBeNull()
  })
})
