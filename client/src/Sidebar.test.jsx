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
    expect(getByTestId('sidebar-project-alpha').textContent).toBe('Alpha')
    expect(getByTestId('sidebar-project-beta').textContent).toBe('Beta')
    expect(getByTestId('sidebar-project-gamma').textContent).toBe('Gamma')
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
})
