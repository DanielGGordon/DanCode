import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  clampTerminalFontSize,
  zoomStorageKey,
  readTerminalFontSize,
  writeTerminalFontSize,
  removeTerminalFontSize,
  stepZoom,
} from './terminalZoom.js'

beforeEach(() => {
  localStorage.clear()
})

describe('clampTerminalFontSize', () => {
  it('returns the input when within range', () => {
    expect(clampTerminalFontSize(13)).toBe(13)
    expect(clampTerminalFontSize(8)).toBe(8)
    expect(clampTerminalFontSize(32)).toBe(32)
  })

  it('clamps values below the minimum to the minimum', () => {
    expect(clampTerminalFontSize(1)).toBe(MIN_TERMINAL_FONT_SIZE)
    expect(clampTerminalFontSize(-5)).toBe(MIN_TERMINAL_FONT_SIZE)
    expect(clampTerminalFontSize(0)).toBe(MIN_TERMINAL_FONT_SIZE)
  })

  it('clamps values above the maximum to the maximum', () => {
    expect(clampTerminalFontSize(100)).toBe(MAX_TERMINAL_FONT_SIZE)
    expect(clampTerminalFontSize(33)).toBe(MAX_TERMINAL_FONT_SIZE)
  })

  it('rounds fractional values to the nearest integer step', () => {
    expect(clampTerminalFontSize(13.4)).toBe(13)
    expect(clampTerminalFontSize(13.6)).toBe(14)
  })

  it('falls back to default for non-finite or non-numeric input', () => {
    expect(clampTerminalFontSize(NaN)).toBe(DEFAULT_TERMINAL_FONT_SIZE)
    expect(clampTerminalFontSize(Infinity)).toBe(DEFAULT_TERMINAL_FONT_SIZE)
    expect(clampTerminalFontSize(-Infinity)).toBe(DEFAULT_TERMINAL_FONT_SIZE)
    expect(clampTerminalFontSize(null)).toBe(DEFAULT_TERMINAL_FONT_SIZE)
    expect(clampTerminalFontSize(undefined)).toBe(DEFAULT_TERMINAL_FONT_SIZE)
    expect(clampTerminalFontSize('not a number')).toBe(DEFAULT_TERMINAL_FONT_SIZE)
  })
})

describe('zoomStorageKey', () => {
  it('namespaces the terminal id under dancode-zoom-terminal:', () => {
    expect(zoomStorageKey('term-1')).toBe('dancode-zoom-terminal:term-1')
  })
})

describe('readTerminalFontSize', () => {
  it('returns the default when no value is stored for the id', () => {
    expect(readTerminalFontSize('unknown-id')).toBe(DEFAULT_TERMINAL_FONT_SIZE)
  })

  it('returns the stored value when it is within range', () => {
    localStorage.setItem('dancode-zoom-terminal:term-a', '18')
    expect(readTerminalFontSize('term-a')).toBe(18)
  })

  it('clamps stored values below the minimum on read', () => {
    localStorage.setItem('dancode-zoom-terminal:term-a', '2')
    expect(readTerminalFontSize('term-a')).toBe(MIN_TERMINAL_FONT_SIZE)
  })

  it('clamps stored values above the maximum on read', () => {
    localStorage.setItem('dancode-zoom-terminal:term-a', '999')
    expect(readTerminalFontSize('term-a')).toBe(MAX_TERMINAL_FONT_SIZE)
  })

  it('falls back to default for non-numeric stored values', () => {
    localStorage.setItem('dancode-zoom-terminal:term-a', 'garbage')
    expect(readTerminalFontSize('term-a')).toBe(DEFAULT_TERMINAL_FONT_SIZE)
  })

  it('returns the default when id is empty/null/undefined', () => {
    expect(readTerminalFontSize('')).toBe(DEFAULT_TERMINAL_FONT_SIZE)
    expect(readTerminalFontSize(null)).toBe(DEFAULT_TERMINAL_FONT_SIZE)
    expect(readTerminalFontSize(undefined)).toBe(DEFAULT_TERMINAL_FONT_SIZE)
  })
})

describe('writeTerminalFontSize', () => {
  it('persists the value to localStorage under the namespaced key', () => {
    writeTerminalFontSize('term-1', 16)
    expect(localStorage.getItem('dancode-zoom-terminal:term-1')).toBe('16')
  })

  it('clamps before writing so persisted values are always in range', () => {
    writeTerminalFontSize('term-1', 999)
    expect(localStorage.getItem('dancode-zoom-terminal:term-1')).toBe(String(MAX_TERMINAL_FONT_SIZE))
    writeTerminalFontSize('term-1', 1)
    expect(localStorage.getItem('dancode-zoom-terminal:term-1')).toBe(String(MIN_TERMINAL_FONT_SIZE))
  })

  it('round-trips a value via write → read', () => {
    writeTerminalFontSize('term-rt', 21)
    expect(readTerminalFontSize('term-rt')).toBe(21)
  })

  it('does nothing when id is empty', () => {
    writeTerminalFontSize('', 16)
    expect(localStorage.length).toBe(0)
  })
})

describe('removeTerminalFontSize', () => {
  it('removes the stored entry for an id', () => {
    writeTerminalFontSize('term-x', 20)
    expect(localStorage.getItem('dancode-zoom-terminal:term-x')).toBe('20')
    removeTerminalFontSize('term-x')
    expect(localStorage.getItem('dancode-zoom-terminal:term-x')).toBeNull()
  })

  it('is a no-op for unknown ids', () => {
    expect(() => removeTerminalFontSize('never-set')).not.toThrow()
  })
})

describe('stepZoom', () => {
  it('increments by one step on +1', () => {
    expect(stepZoom(13, +1)).toBe(14)
  })

  it('decrements by one step on -1', () => {
    expect(stepZoom(13, -1)).toBe(12)
  })

  it('clamps at the maximum on +1', () => {
    expect(stepZoom(MAX_TERMINAL_FONT_SIZE, +1)).toBe(MAX_TERMINAL_FONT_SIZE)
  })

  it('clamps at the minimum on -1', () => {
    expect(stepZoom(MIN_TERMINAL_FONT_SIZE, -1)).toBe(MIN_TERMINAL_FONT_SIZE)
  })
})
