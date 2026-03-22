import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
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
})
