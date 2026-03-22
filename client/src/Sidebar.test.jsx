import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import Sidebar from './Sidebar.jsx'

afterEach(cleanup)

const PROJECTS = [
  { slug: 'alpha', name: 'Alpha' },
  { slug: 'beta', name: 'Beta' },
  { slug: 'gamma', name: 'Gamma' },
]

describe('Sidebar', () => {
  it('renders a sidebar element', () => {
    const { getByTestId } = render(<Sidebar projects={[]} currentSlug={null} />)
    expect(getByTestId('sidebar')).toBeDefined()
  })

  it('shows empty message when no projects exist', () => {
    const { getByTestId } = render(<Sidebar projects={[]} currentSlug={null} />)
    expect(getByTestId('sidebar-empty').textContent).toBe('No projects yet')
  })

  it('lists all projects by name', () => {
    const { getByTestId } = render(<Sidebar projects={PROJECTS} currentSlug={null} />)
    expect(getByTestId('sidebar-project-alpha').textContent).toContain('Alpha')
    expect(getByTestId('sidebar-project-beta').textContent).toContain('Beta')
    expect(getByTestId('sidebar-project-gamma').textContent).toContain('Gamma')
  })

  it('renders a project list element', () => {
    const { getByTestId } = render(<Sidebar projects={PROJECTS} currentSlug={null} />)
    const list = getByTestId('sidebar-project-list')
    expect(list.querySelectorAll('li').length).toBe(3)
  })

  it('highlights the active project', () => {
    const { getByTestId } = render(<Sidebar projects={PROJECTS} currentSlug="beta" />)
    const betaItem = getByTestId('sidebar-project-beta')
    expect(betaItem.className).toContain('text-base1')
    expect(betaItem.className).toContain('border-blue')
  })

  it('does not highlight non-active projects', () => {
    const { getByTestId } = render(<Sidebar projects={PROJECTS} currentSlug="beta" />)
    const alphaItem = getByTestId('sidebar-project-alpha')
    expect(alphaItem.className).toContain('border-transparent')
    expect(alphaItem.className).not.toContain('border-blue')
  })

  it('handles undefined projects gracefully', () => {
    const { getByTestId } = render(<Sidebar projects={undefined} currentSlug={null} />)
    expect(getByTestId('sidebar-empty')).toBeDefined()
  })

  it('handles null currentSlug without errors', () => {
    const { getByTestId } = render(<Sidebar projects={PROJECTS} currentSlug={null} />)
    // All items should use the non-active style
    for (const p of PROJECTS) {
      expect(getByTestId(`sidebar-project-${p.slug}`).className).toContain('border-transparent')
    }
  })

  it('calls onSelect with the project slug when clicked', () => {
    const onSelect = vi.fn()
    const { getByTestId } = render(<Sidebar projects={PROJECTS} currentSlug={null} onSelect={onSelect} />)

    fireEvent.click(getByTestId('sidebar-project-beta'))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('beta')
  })

  it('calls onSelect for each project clicked', () => {
    const onSelect = vi.fn()
    const { getByTestId } = render(<Sidebar projects={PROJECTS} currentSlug={null} onSelect={onSelect} />)

    fireEvent.click(getByTestId('sidebar-project-alpha'))
    fireEvent.click(getByTestId('sidebar-project-gamma'))

    expect(onSelect).toHaveBeenCalledTimes(2)
    expect(onSelect).toHaveBeenNthCalledWith(1, 'alpha')
    expect(onSelect).toHaveBeenNthCalledWith(2, 'gamma')
  })

  it('does not crash when onSelect is not provided', () => {
    const { getByTestId } = render(<Sidebar projects={PROJECTS} currentSlug={null} />)
    // Should not throw
    fireEvent.click(getByTestId('sidebar-project-alpha'))
  })

  describe('collapse/expand toggle', () => {
    it('renders a toggle button', () => {
      const { getByTestId } = render(<Sidebar projects={PROJECTS} currentSlug={null} />)
      expect(getByTestId('sidebar-toggle')).toBeDefined()
    })

    it('shows collapse arrow when expanded', () => {
      const { getByTestId } = render(<Sidebar projects={PROJECTS} currentSlug={null} collapsed={false} />)
      expect(getByTestId('sidebar-toggle').textContent).toBe('◀')
      expect(getByTestId('sidebar-toggle').title).toBe('Collapse sidebar')
    })

    it('shows expand arrow when collapsed', () => {
      const { getByTestId } = render(<Sidebar projects={PROJECTS} currentSlug={null} collapsed={true} />)
      expect(getByTestId('sidebar-toggle').textContent).toBe('▶')
      expect(getByTestId('sidebar-toggle').title).toBe('Expand sidebar')
    })

    it('calls onToggle when toggle button is clicked', () => {
      const onToggle = vi.fn()
      const { getByTestId } = render(<Sidebar projects={PROJECTS} currentSlug={null} onToggle={onToggle} />)
      fireEvent.click(getByTestId('sidebar-toggle'))
      expect(onToggle).toHaveBeenCalledTimes(1)
    })

    it('does not crash when onToggle is not provided', () => {
      const { getByTestId } = render(<Sidebar projects={PROJECTS} currentSlug={null} />)
      fireEvent.click(getByTestId('sidebar-toggle'))
    })

    it('hides project list when collapsed', () => {
      const { queryByTestId } = render(<Sidebar projects={PROJECTS} currentSlug={null} collapsed={true} />)
      expect(queryByTestId('sidebar-project-list')).toBeNull()
    })

    it('shows project list when expanded', () => {
      const { getByTestId } = render(<Sidebar projects={PROJECTS} currentSlug={null} collapsed={false} />)
      expect(getByTestId('sidebar-project-list')).toBeDefined()
    })

    it('uses narrow width class when collapsed', () => {
      const { getByTestId } = render(<Sidebar projects={PROJECTS} currentSlug={null} collapsed={true} />)
      expect(getByTestId('sidebar').className).toContain('w-10')
      expect(getByTestId('sidebar').className).not.toContain('w-52')
    })

    it('uses full width class when expanded', () => {
      const { getByTestId } = render(<Sidebar projects={PROJECTS} currentSlug={null} collapsed={false} />)
      expect(getByTestId('sidebar').className).toContain('w-52')
      expect(getByTestId('sidebar').className).not.toContain('w-10')
    })

    it('hides Projects heading when collapsed', () => {
      const { getByTestId } = render(<Sidebar projects={PROJECTS} currentSlug={null} collapsed={true} />)
      const sidebar = getByTestId('sidebar')
      expect(sidebar.querySelector('h2')).toBeNull()
    })
  })

  describe('tmux status indicator', () => {
    it('shows a status dot for each project', () => {
      const { getByTestId } = render(<Sidebar projects={PROJECTS} currentSlug={null} />)
      for (const p of PROJECTS) {
        const dot = getByTestId(`sidebar-status-${p.slug}`)
        expect(dot).toBeDefined()
        expect(dot.tagName).toBe('SPAN')
      }
    })

    it('shows green dot when tmux session is running', () => {
      const tmuxStatus = { alpha: true, beta: false, gamma: true }
      const { getByTestId } = render(
        <Sidebar projects={PROJECTS} currentSlug={null} tmuxStatus={tmuxStatus} />
      )
      const alphaDot = getByTestId('sidebar-status-alpha')
      expect(alphaDot.className).toContain('bg-green')
      expect(alphaDot.title).toBe('tmux session running')
    })

    it('shows dim dot when tmux session is not running', () => {
      const tmuxStatus = { alpha: true, beta: false, gamma: true }
      const { getByTestId } = render(
        <Sidebar projects={PROJECTS} currentSlug={null} tmuxStatus={tmuxStatus} />
      )
      const betaDot = getByTestId('sidebar-status-beta')
      expect(betaDot.className).toContain('bg-base01/40')
      expect(betaDot.className).not.toContain('bg-green')
      expect(betaDot.title).toBe('no tmux session')
    })

    it('shows unknown state when tmuxStatus is undefined', () => {
      const { getByTestId } = render(
        <Sidebar projects={PROJECTS} currentSlug={null} />
      )
      const alphaDot = getByTestId('sidebar-status-alpha')
      expect(alphaDot.className).toContain('bg-base01/20')
      expect(alphaDot.className).toContain('animate-pulse')
      expect(alphaDot.className).not.toContain('bg-green')
      expect(alphaDot.className).not.toContain('bg-base01/40')
      expect(alphaDot.title).toBe('checking status…')
    })

    it('shows unknown state when project slug is missing from tmuxStatus', () => {
      const tmuxStatus = { alpha: true }
      const { getByTestId } = render(
        <Sidebar projects={PROJECTS} currentSlug={null} tmuxStatus={tmuxStatus} />
      )
      const betaDot = getByTestId('sidebar-status-beta')
      expect(betaDot.className).toContain('bg-base01/20')
      expect(betaDot.className).toContain('animate-pulse')
      expect(betaDot.title).toBe('checking status…')
    })
  })
})
