import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import ShortcutBar from './ShortcutBar.jsx'

beforeEach(() => {
  cleanup()
})

describe('ShortcutBar', () => {
  it('renders all shortcut buttons', () => {
    const { getByTestId } = render(<ShortcutBar onSend={() => {}} />)
    expect(getByTestId('shortcut-ctrl-c')).toBeDefined()
    expect(getByTestId('shortcut-ctrl-v')).toBeDefined()
    expect(getByTestId('shortcut-ctrl-d')).toBeDefined()
    expect(getByTestId('shortcut-tab')).toBeDefined()
    expect(getByTestId('shortcut-up')).toBeDefined()
    expect(getByTestId('shortcut-down')).toBeDefined()
    expect(getByTestId('shortcut-esc')).toBeDefined()
  })

  it('calls onSend with Ctrl+C sequence when Ctrl+C button is clicked', () => {
    const onSend = vi.fn()
    const { getByTestId } = render(<ShortcutBar onSend={onSend} />)
    fireEvent.click(getByTestId('shortcut-ctrl-c'))
    expect(onSend).toHaveBeenCalledWith('\x03')
  })

  it('calls onSend with Ctrl+D sequence when Ctrl+D button is clicked', () => {
    const onSend = vi.fn()
    const { getByTestId } = render(<ShortcutBar onSend={onSend} />)
    fireEvent.click(getByTestId('shortcut-ctrl-d'))
    expect(onSend).toHaveBeenCalledWith('\x04')
  })

  it('calls onSend with Tab character when Tab button is clicked', () => {
    const onSend = vi.fn()
    const { getByTestId } = render(<ShortcutBar onSend={onSend} />)
    fireEvent.click(getByTestId('shortcut-tab'))
    expect(onSend).toHaveBeenCalledWith('\t')
  })

  it('calls onSend with up arrow escape sequence when ↑ button is clicked', () => {
    const onSend = vi.fn()
    const { getByTestId } = render(<ShortcutBar onSend={onSend} />)
    fireEvent.click(getByTestId('shortcut-up'))
    expect(onSend).toHaveBeenCalledWith('\x1b[A')
  })

  it('calls onSend with down arrow escape sequence when ↓ button is clicked', () => {
    const onSend = vi.fn()
    const { getByTestId } = render(<ShortcutBar onSend={onSend} />)
    fireEvent.click(getByTestId('shortcut-down'))
    expect(onSend).toHaveBeenCalledWith('\x1b[B')
  })

  it('calls onSend with Escape sequence when Esc button is clicked', () => {
    const onSend = vi.fn()
    const { getByTestId } = render(<ShortcutBar onSend={onSend} />)
    fireEvent.click(getByTestId('shortcut-esc'))
    expect(onSend).toHaveBeenCalledWith('\x1b')
  })

  it('calls onPaste when Ctrl+V button is clicked', () => {
    const onPaste = vi.fn()
    const { getByTestId } = render(<ShortcutBar onSend={() => {}} onPaste={onPaste} />)
    fireEvent.click(getByTestId('shortcut-ctrl-v'))
    expect(onPaste).toHaveBeenCalledOnce()
  })

  it('renders the shortcut bar container with data-testid', () => {
    const { getByTestId } = render(<ShortcutBar onSend={() => {}} />)
    expect(getByTestId('shortcut-bar')).toBeDefined()
  })

  it('buttons have minimum 44px dimensions', () => {
    const { getByTestId } = render(<ShortcutBar onSend={() => {}} />)
    const button = getByTestId('shortcut-ctrl-c')
    expect(button.style.minWidth).toBe('44px')
    expect(button.style.minHeight).toBe('44px')
  })
})
