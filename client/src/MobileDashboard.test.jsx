import { describe, it, expect, vi, beforeEach } from 'vitest'
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
})
