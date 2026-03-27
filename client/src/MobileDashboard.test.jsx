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
})
