import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import CommandPalette, { fuzzyMatch } from './CommandPalette.jsx'

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const PROJECTS = [
  { slug: 'dancode', name: 'DanCode' },
  { slug: 'my-blog', name: 'My Blog' },
  { slug: 'api-server', name: 'API Server' },
]

describe('fuzzyMatch', () => {
  it('matches empty query against any text', () => {
    expect(fuzzyMatch('', 'anything')).toBe(true)
  })

  it('matches exact text', () => {
    expect(fuzzyMatch('DanCode', 'DanCode')).toBe(true)
  })

  it('matches case-insensitively', () => {
    expect(fuzzyMatch('dancode', 'DanCode')).toBe(true)
    expect(fuzzyMatch('DANCODE', 'DanCode')).toBe(true)
  })

  it('matches non-contiguous characters in order', () => {
    expect(fuzzyMatch('dcd', 'DanCode')).toBe(true)
    expect(fuzzyMatch('dc', 'DanCode')).toBe(true)
  })

  it('does not match characters out of order', () => {
    expect(fuzzyMatch('odc', 'DanCode')).toBe(false)
  })

  it('does not match when characters are missing', () => {
    expect(fuzzyMatch('xyz', 'DanCode')).toBe(false)
  })
})

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    const { queryByTestId } = render(
      <CommandPalette open={false} onClose={vi.fn()} projects={PROJECTS} onSelect={vi.fn()} />
    )
    expect(queryByTestId('command-palette')).toBeNull()
  })

  it('renders overlay with input when open', () => {
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={vi.fn()} />
    )
    expect(getByTestId('command-palette')).toBeDefined()
    expect(getByTestId('command-palette-input')).toBeDefined()
  })

  it('lists all projects', () => {
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={vi.fn()} />
    )
    expect(getByTestId('command-palette-item-dancode')).toBeDefined()
    expect(getByTestId('command-palette-item-my-blog')).toBeDefined()
    expect(getByTestId('command-palette-item-api-server')).toBeDefined()
  })

  it('filters projects by fuzzy search', () => {
    const { getByTestId, queryByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={vi.fn()} />
    )
    fireEvent.change(getByTestId('command-palette-input'), { target: { value: 'blog' } })
    expect(getByTestId('command-palette-item-my-blog')).toBeDefined()
    expect(queryByTestId('command-palette-item-dancode')).toBeNull()
    expect(queryByTestId('command-palette-item-api-server')).toBeNull()
  })

  it('shows no-match message when filter matches nothing', () => {
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={vi.fn()} />
    )
    fireEvent.change(getByTestId('command-palette-input'), { target: { value: 'zzz' } })
    expect(getByTestId('command-palette-no-match')).toBeDefined()
  })

  it('shows empty message when no projects exist', () => {
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={[]} onSelect={vi.fn()} />
    )
    expect(getByTestId('command-palette-empty')).toBeDefined()
  })

  it('highlights current project', () => {
    const { getByTestId } = render(
      <CommandPalette
        open={true}
        onClose={vi.fn()}
        projects={PROJECTS}
        currentSlug="my-blog"
        onSelect={vi.fn()}
      />
    )
    const item = getByTestId('command-palette-item-my-blog')
    expect(item.textContent).toContain('current')
  })

  it('calls onSelect when a project is clicked', () => {
    const onSelect = vi.fn()
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={onSelect} />
    )
    fireEvent.click(getByTestId('command-palette-item-dancode'))
    expect(onSelect).toHaveBeenCalledWith('dancode')
  })

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn()
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={onClose} projects={PROJECTS} onSelect={vi.fn()} />
    )
    fireEvent.click(getByTestId('command-palette-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call onClose when palette body is clicked', () => {
    const onClose = vi.fn()
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={onClose} projects={PROJECTS} onSelect={vi.fn()} />
    )
    fireEvent.click(getByTestId('command-palette'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('resets query when reopened', () => {
    const { getByTestId, rerender } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={vi.fn()} />
    )
    fireEvent.change(getByTestId('command-palette-input'), { target: { value: 'test' } })
    expect(getByTestId('command-palette-input').value).toBe('test')

    // Close and reopen
    rerender(
      <CommandPalette open={false} onClose={vi.fn()} projects={PROJECTS} onSelect={vi.fn()} />
    )
    rerender(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={vi.fn()} />
    )
    expect(getByTestId('command-palette-input').value).toBe('')
  })
})
