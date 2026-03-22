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

  it('matches empty query against empty text', () => {
    expect(fuzzyMatch('', '')).toBe(true)
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

  it('matches a prefix substring', () => {
    expect(fuzzyMatch('Dan', 'DanCode')).toBe(true)
    expect(fuzzyMatch('API', 'API Server')).toBe(true)
  })

  it('matches a single character', () => {
    expect(fuzzyMatch('d', 'DanCode')).toBe(true)
    expect(fuzzyMatch('z', 'DanCode')).toBe(false)
  })

  it('does not match when query is longer than text', () => {
    expect(fuzzyMatch('DanCodeExtra', 'DanCode')).toBe(false)
  })

  it('matches text containing spaces', () => {
    expect(fuzzyMatch('my', 'My Blog')).toBe(true)
    expect(fuzzyMatch('mb', 'My Blog')).toBe(true)
    expect(fuzzyMatch('blog', 'My Blog')).toBe(true)
  })

  it('matches query with spaces against text with spaces', () => {
    expect(fuzzyMatch('my b', 'My Blog')).toBe(true)
    expect(fuzzyMatch('api s', 'API Server')).toBe(true)
  })

  it('handles repeated characters correctly', () => {
    expect(fuzzyMatch('oo', 'foobar')).toBe(true)
    expect(fuzzyMatch('ooo', 'foobar')).toBe(false)
  })

  it('does not match non-empty query against empty text', () => {
    expect(fuzzyMatch('a', '')).toBe(false)
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

  it('calls onClose when Escape is pressed in the input', () => {
    const onClose = vi.fn()
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={onClose} projects={PROJECTS} onSelect={vi.fn()} />
    )
    fireEvent.keyDown(getByTestId('command-palette-input'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call onSelect when Escape is pressed', () => {
    const onSelect = vi.fn()
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={onSelect} />
    )
    fireEvent.keyDown(getByTestId('command-palette-input'), { key: 'Escape' })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('does not call onClose when palette body is clicked', () => {
    const onClose = vi.fn()
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={onClose} projects={PROJECTS} onSelect={vi.fn()} />
    )
    fireEvent.click(getByTestId('command-palette'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('highlights first item by default', () => {
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={vi.fn()} />
    )
    const first = getByTestId('command-palette-item-dancode')
    expect(first.className).toContain('bg-blue/20')
  })

  it('moves highlight down with ArrowDown', () => {
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={vi.fn()} />
    )
    const input = getByTestId('command-palette-input')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const second = getByTestId('command-palette-item-my-blog')
    expect(second.className).toContain('bg-blue/20')
    // First item should no longer be highlighted
    const first = getByTestId('command-palette-item-dancode')
    expect(first.className).not.toContain('bg-blue/20')
  })

  it('moves highlight up with ArrowUp', () => {
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={vi.fn()} />
    )
    const input = getByTestId('command-palette-input')
    // Move down first, then up
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    const first = getByTestId('command-palette-item-dancode')
    expect(first.className).toContain('bg-blue/20')
  })

  it('does not move highlight past the end of the list', () => {
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={vi.fn()} />
    )
    const input = getByTestId('command-palette-input')
    // Press ArrowDown more times than there are items
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const last = getByTestId('command-palette-item-api-server')
    expect(last.className).toContain('bg-blue/20')
  })

  it('does not move highlight before the start of the list', () => {
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={vi.fn()} />
    )
    const input = getByTestId('command-palette-input')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    const first = getByTestId('command-palette-item-dancode')
    expect(first.className).toContain('bg-blue/20')
  })

  it('selects highlighted item on Enter', () => {
    const onSelect = vi.fn()
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={onSelect} />
    )
    const input = getByTestId('command-palette-input')
    // Move to second item and press Enter
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('my-blog')
  })

  it('selects first item on Enter without navigating', () => {
    const onSelect = vi.fn()
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={onSelect} />
    )
    const input = getByTestId('command-palette-input')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('dancode')
  })

  it('does not call onSelect on Enter when list is empty', () => {
    const onSelect = vi.fn()
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={[]} onSelect={onSelect} />
    )
    const input = getByTestId('command-palette-input')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('resets highlight when search query changes', () => {
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={vi.fn()} />
    )
    const input = getByTestId('command-palette-input')
    // Move highlight down
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    // Type a query — highlight should reset to 0
    fireEvent.change(input, { target: { value: 'a' } })
    // Filter matches DanCode and API Server — first match should be highlighted
    const dancode = getByTestId('command-palette-item-dancode')
    expect(dancode.className).toContain('bg-blue/20')
  })

  it('updates highlight on mouse enter', () => {
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={vi.fn()} />
    )
    const second = getByTestId('command-palette-item-my-blog')
    fireEvent.mouseEnter(second)
    expect(second.className).toContain('bg-blue/20')
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

describe('CommandPalette — filtering logic', () => {
  it('progressively narrows results as query gets longer', () => {
    const projects = [
      { slug: 'dancode', name: 'DanCode' },
      { slug: 'dashboard', name: 'Dashboard' },
      { slug: 'my-blog', name: 'My Blog' },
    ]
    const { getByTestId, queryByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={projects} onSelect={vi.fn()} />
    )
    const input = getByTestId('command-palette-input')

    // 'd' matches DanCode and Dashboard
    fireEvent.change(input, { target: { value: 'd' } })
    expect(getByTestId('command-palette-item-dancode')).toBeDefined()
    expect(getByTestId('command-palette-item-dashboard')).toBeDefined()
    expect(queryByTestId('command-palette-item-my-blog')).toBeNull()

    // 'dan' narrows to DanCode only
    fireEvent.change(input, { target: { value: 'dan' } })
    expect(getByTestId('command-palette-item-dancode')).toBeDefined()
    expect(queryByTestId('command-palette-item-dashboard')).toBeNull()
  })

  it('restores full list when query is cleared', () => {
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={vi.fn()} />
    )
    const input = getByTestId('command-palette-input')

    fireEvent.change(input, { target: { value: 'blog' } })
    fireEvent.change(input, { target: { value: '' } })

    expect(getByTestId('command-palette-item-dancode')).toBeDefined()
    expect(getByTestId('command-palette-item-my-blog')).toBeDefined()
    expect(getByTestId('command-palette-item-api-server')).toBeDefined()
  })

  it('selects correct project after filtering narrows the list', () => {
    const onSelect = vi.fn()
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={onSelect} />
    )
    const input = getByTestId('command-palette-input')

    // Filter to only 'API Server', then press Enter
    fireEvent.change(input, { target: { value: 'api' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('api-server')
  })

  it('handles null projects gracefully', () => {
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={null} onSelect={vi.fn()} />
    )
    expect(getByTestId('command-palette-list')).toBeDefined()
  })
})

describe('CommandPalette — project list ordering', () => {
  it('displays projects in the order they are provided', () => {
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={vi.fn()} />
    )
    const list = getByTestId('command-palette-list')
    const items = list.querySelectorAll('[data-palette-item]')
    expect(items).toHaveLength(3)
    expect(items[0].textContent).toContain('DanCode')
    expect(items[1].textContent).toContain('My Blog')
    expect(items[2].textContent).toContain('API Server')
  })

  it('preserves relative order after filtering', () => {
    const projects = [
      { slug: 'zebra', name: 'Zebra Tools' },
      { slug: 'beta', name: 'Beta Blog' },
      { slug: 'gamma', name: 'Gamma Grid' },
      { slug: 'delta', name: 'Delta Blog' },
    ]
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={projects} onSelect={vi.fn()} />
    )
    // 'blog' matches Beta Blog and Delta Blog — order should be Beta then Delta
    fireEvent.change(getByTestId('command-palette-input'), { target: { value: 'blog' } })
    const list = getByTestId('command-palette-list')
    const items = list.querySelectorAll('[data-palette-item]')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('Beta Blog')
    expect(items[1].textContent).toContain('Delta Blog')
  })

  it('does not reorder current project to the top', () => {
    const projects = [
      { slug: 'first', name: 'First' },
      { slug: 'second', name: 'Second' },
      { slug: 'third', name: 'Third' },
    ]
    const { getByTestId } = render(
      <CommandPalette
        open={true}
        onClose={vi.fn()}
        projects={projects}
        currentSlug="third"
        onSelect={vi.fn()}
      />
    )
    const list = getByTestId('command-palette-list')
    const items = list.querySelectorAll('[data-palette-item]')
    expect(items[0].textContent).toContain('First')
    expect(items[1].textContent).toContain('Second')
    expect(items[2].textContent).toContain('Third')
    expect(items[2].textContent).toContain('current')
  })

  it('restores original order after clearing search', () => {
    const { getByTestId } = render(
      <CommandPalette open={true} onClose={vi.fn()} projects={PROJECTS} onSelect={vi.fn()} />
    )
    const input = getByTestId('command-palette-input')

    // Filter then clear
    fireEvent.change(input, { target: { value: 'blog' } })
    fireEvent.change(input, { target: { value: '' } })

    const list = getByTestId('command-palette-list')
    const items = list.querySelectorAll('[data-palette-item]')
    expect(items).toHaveLength(3)
    expect(items[0].textContent).toContain('DanCode')
    expect(items[1].textContent).toContain('My Blog')
    expect(items[2].textContent).toContain('API Server')
  })

  it('displays a single project correctly', () => {
    const { getByTestId } = render(
      <CommandPalette
        open={true}
        onClose={vi.fn()}
        projects={[{ slug: 'solo', name: 'Solo Project' }]}
        onSelect={vi.fn()}
      />
    )
    const list = getByTestId('command-palette-list')
    const items = list.querySelectorAll('[data-palette-item]')
    expect(items).toHaveLength(1)
    expect(items[0].textContent).toContain('Solo Project')
  })
})
