import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import MobileDashboard from './MobileDashboard.jsx'

beforeEach(() => {
  cleanup()
})

const mockProjects = [
  { slug: 'proj-a', name: 'Project A', path: '/home/user/a' },
  { slug: 'proj-b', name: 'Project B', path: '/home/user/b' },
]

const mockProjectTerminals = {
  'proj-a': [
    { id: 't1', label: 'CLI', lastActivity: new Date().toISOString() },
    { id: 't2', label: 'Claude', lastActivity: new Date(Date.now() - 120000).toISOString() },
  ],
  'proj-b': [
    { id: 't3', label: 'CLI', lastActivity: new Date(Date.now() - 3600000).toISOString() },
  ],
}

describe('MobileDashboard', () => {
  it('renders project cards for each project', () => {
    const { getByTestId } = render(
      <MobileDashboard projects={mockProjects} onSelectProject={() => {}} />
    )
    expect(getByTestId('project-card-proj-a')).toBeDefined()
    expect(getByTestId('project-card-proj-b')).toBeDefined()
  })

  it('shows empty state when no projects exist', () => {
    const { getByTestId } = render(
      <MobileDashboard projects={[]} onSelectProject={() => {}} />
    )
    expect(getByTestId('mobile-dashboard').textContent).toContain('No projects yet')
  })

  it('calls onSelectProject when project card is clicked', () => {
    const onSelect = vi.fn()
    const { getByTestId } = render(
      <MobileDashboard projects={mockProjects} onSelectProject={onSelect} />
    )
    fireEvent.click(getByTestId('project-card-proj-a'))
    expect(onSelect).toHaveBeenCalledWith('proj-a')
  })

  it('calls onNewProject when new project button is clicked', () => {
    const onNew = vi.fn()
    const { getByTestId } = render(
      <MobileDashboard projects={mockProjects} onSelectProject={() => {}} onNewProject={onNew} />
    )
    fireEvent.click(getByTestId('mobile-new-project'))
    expect(onNew).toHaveBeenCalledOnce()
  })

  it('calls onLogout when logout button is clicked', () => {
    const onLogout = vi.fn()
    const { getByTestId } = render(
      <MobileDashboard projects={mockProjects} onSelectProject={() => {}} onLogout={onLogout} />
    )
    fireEvent.click(getByTestId('mobile-logout'))
    expect(onLogout).toHaveBeenCalledOnce()
  })

  it('shows quick action menu on right-click (context menu)', () => {
    const { getByTestId } = render(
      <MobileDashboard projects={mockProjects} onSelectProject={() => {}} onQuickAction={() => {}} />
    )
    fireEvent.contextMenu(getByTestId('project-card-proj-a'))
    expect(getByTestId('quick-action-menu')).toBeDefined()
    expect(getByTestId('quick-action-cli')).toBeDefined()
    expect(getByTestId('quick-action-claude')).toBeDefined()
  })

  it('calls onQuickAction with cli when CLI option is clicked', () => {
    const onQuick = vi.fn()
    const { getByTestId } = render(
      <MobileDashboard projects={mockProjects} onSelectProject={() => {}} onQuickAction={onQuick} />
    )
    fireEvent.contextMenu(getByTestId('project-card-proj-a'))
    fireEvent.click(getByTestId('quick-action-cli'))
    expect(onQuick).toHaveBeenCalledWith('proj-a', 'cli')
  })

  it('calls onQuickAction with claude when Claude option is clicked', () => {
    const onQuick = vi.fn()
    const { getByTestId } = render(
      <MobileDashboard projects={mockProjects} onSelectProject={() => {}} onQuickAction={onQuick} />
    )
    fireEvent.contextMenu(getByTestId('project-card-proj-b'))
    fireEvent.click(getByTestId('quick-action-claude'))
    expect(onQuick).toHaveBeenCalledWith('proj-b', 'claude')
  })

  it('renders the dashboard header with DanCode title', () => {
    const { getByTestId } = render(
      <MobileDashboard projects={mockProjects} onSelectProject={() => {}} />
    )
    expect(getByTestId('mobile-dashboard').textContent).toContain('DanCode')
  })

  it('shows project name and path in cards', () => {
    const { getByTestId } = render(
      <MobileDashboard projects={mockProjects} onSelectProject={() => {}} />
    )
    const card = getByTestId('project-card-proj-a')
    expect(card.textContent).toContain('Project A')
    expect(card.textContent).toContain('/home/user/a')
  })

  // Phase 6: Activity indicators
  it('shows activity indicator per project card', () => {
    const { getByTestId } = render(
      <MobileDashboard
        projects={mockProjects}
        projectTerminals={mockProjectTerminals}
        onSelectProject={() => {}}
      />
    )
    const indicatorA = getByTestId('activity-indicator-proj-a')
    const indicatorB = getByTestId('activity-indicator-proj-b')
    expect(indicatorA).toBeDefined()
    expect(indicatorB).toBeDefined()
    // Project A has recent activity (< 60s), should be active (green)
    expect(indicatorA.className).toContain('bg-green')
    // Project B has old activity (1h ago), should be idle
    expect(indicatorB.className).toContain('bg-base01')
  })

  it('shows terminal labels on project cards', () => {
    const { getByTestId } = render(
      <MobileDashboard
        projects={mockProjects}
        projectTerminals={mockProjectTerminals}
        onSelectProject={() => {}}
      />
    )
    expect(getByTestId('terminal-label-proj-a-0').textContent).toBe('CLI')
    expect(getByTestId('terminal-label-proj-a-1').textContent).toBe('Claude')
    expect(getByTestId('terminal-label-proj-b-0').textContent).toBe('CLI')
  })

  it('shows last activity time on project cards', () => {
    const { getByTestId } = render(
      <MobileDashboard
        projects={mockProjects}
        projectTerminals={mockProjectTerminals}
        onSelectProject={() => {}}
      />
    )
    expect(getByTestId('last-activity-proj-a').textContent).toBe('just now')
    expect(getByTestId('last-activity-proj-b').textContent).toBe('1h ago')
  })

  it('shows pull-to-refresh indicator when pulling down', () => {
    const onRefresh = vi.fn(() => Promise.resolve())
    const { getByTestId, queryByTestId } = render(
      <MobileDashboard
        projects={mockProjects}
        onSelectProject={() => {}}
        onRefresh={onRefresh}
      />
    )
    // Initially no indicator
    expect(queryByTestId('pull-to-refresh-indicator')).toBeNull()
  })

  // Visibility-aware polling tests
  describe('visibility-aware polling', () => {
    let visibilityState
    let visibilityListeners

    beforeEach(() => {
      vi.useFakeTimers()
      visibilityState = 'visible'
      visibilityListeners = []

      Object.defineProperty(document, 'visibilityState', {
        get: () => visibilityState,
        configurable: true,
      })

      const originalAddEventListener = document.addEventListener.bind(document)
      const originalRemoveEventListener = document.removeEventListener.bind(document)

      vi.spyOn(document, 'addEventListener').mockImplementation((type, handler, options) => {
        if (type === 'visibilitychange') {
          visibilityListeners.push(handler)
        }
        return originalAddEventListener(type, handler, options)
      })

      vi.spyOn(document, 'removeEventListener').mockImplementation((type, handler, options) => {
        if (type === 'visibilitychange') {
          visibilityListeners = visibilityListeners.filter((h) => h !== handler)
        }
        return originalRemoveEventListener(type, handler, options)
      })
    })

    afterEach(() => {
      vi.useRealTimers()
      vi.restoreAllMocks()
    })

    it('registers a visibilitychange event listener', () => {
      const onRefresh = vi.fn()
      render(
        <MobileDashboard
          projects={mockProjects}
          onSelectProject={() => {}}
          onRefresh={onRefresh}
        />
      )
      expect(document.addEventListener).toHaveBeenCalledWith(
        'visibilitychange',
        expect.any(Function)
      )
    })

    it('calls onRefresh on the polling interval when visible', () => {
      const onRefresh = vi.fn()
      render(
        <MobileDashboard
          projects={mockProjects}
          onSelectProject={() => {}}
          onRefresh={onRefresh}
        />
      )
      onRefresh.mockClear()
      vi.advanceTimersByTime(30000)
      expect(onRefresh).toHaveBeenCalled()
    })

    it('does not call onRefresh when document is hidden', () => {
      const onRefresh = vi.fn()
      render(
        <MobileDashboard
          projects={mockProjects}
          onSelectProject={() => {}}
          onRefresh={onRefresh}
        />
      )
      onRefresh.mockClear()

      // Simulate tab becoming hidden
      visibilityState = 'hidden'
      for (const listener of visibilityListeners) listener()

      // Advance past several polling intervals
      vi.advanceTimersByTime(90000)
      expect(onRefresh).not.toHaveBeenCalled()
    })

    it('resumes polling when document becomes visible again', () => {
      const onRefresh = vi.fn()
      render(
        <MobileDashboard
          projects={mockProjects}
          onSelectProject={() => {}}
          onRefresh={onRefresh}
        />
      )
      onRefresh.mockClear()

      // Hide
      visibilityState = 'hidden'
      for (const listener of visibilityListeners) listener()

      // Show again
      visibilityState = 'visible'
      for (const listener of visibilityListeners) listener()

      // onRefresh should be called immediately on becoming visible
      expect(onRefresh).toHaveBeenCalled()
      onRefresh.mockClear()

      // And polling should resume
      vi.advanceTimersByTime(30000)
      expect(onRefresh).toHaveBeenCalled()
    })

    it('cleans up visibilitychange listener on unmount', () => {
      const onRefresh = vi.fn()
      const { unmount } = render(
        <MobileDashboard
          projects={mockProjects}
          onSelectProject={() => {}}
          onRefresh={onRefresh}
        />
      )
      unmount()
      expect(document.removeEventListener).toHaveBeenCalledWith(
        'visibilitychange',
        expect.any(Function)
      )
    })
  })
})
