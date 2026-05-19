import { describe, it, expect, beforeEach } from 'vitest'
import {
  FILE_ZOOM_DEFAULT,
  FILE_ZOOM_MIN,
  FILE_ZOOM_MAX,
  FILE_ZOOM_STEP,
  clampFileZoom,
  fileZoomStorageKey,
  readFileZoom,
  writeFileZoom,
  clearFileZoom,
  stepFileZoom,
} from './zoom.js'

beforeEach(() => {
  localStorage.clear()
})

describe('clampFileZoom', () => {
  it('returns the default for non-numeric input', () => {
    expect(clampFileZoom(undefined)).toBe(FILE_ZOOM_DEFAULT)
    expect(clampFileZoom(null)).toBe(FILE_ZOOM_DEFAULT)
    expect(clampFileZoom(NaN)).toBe(FILE_ZOOM_DEFAULT)
    expect(clampFileZoom('not a number')).toBe(FILE_ZOOM_DEFAULT)
  })

  it('clamps below min up to min', () => {
    expect(clampFileZoom(1)).toBe(FILE_ZOOM_MIN)
    expect(clampFileZoom(-50)).toBe(FILE_ZOOM_MIN)
  })

  it('clamps above max down to max', () => {
    expect(clampFileZoom(99)).toBe(FILE_ZOOM_MAX)
    expect(clampFileZoom(1000)).toBe(FILE_ZOOM_MAX)
  })

  it('rounds fractional values to the nearest integer step', () => {
    expect(clampFileZoom(14.4)).toBe(14)
    expect(clampFileZoom(14.6)).toBe(15)
  })

  it('passes valid in-range integers through unchanged', () => {
    expect(clampFileZoom(FILE_ZOOM_MIN)).toBe(FILE_ZOOM_MIN)
    expect(clampFileZoom(FILE_ZOOM_DEFAULT)).toBe(FILE_ZOOM_DEFAULT)
    expect(clampFileZoom(FILE_ZOOM_MAX)).toBe(FILE_ZOOM_MAX)
  })
})

describe('fileZoomStorageKey', () => {
  it('namespaces by project slug and file path', () => {
    expect(fileZoomStorageKey('proj-a', 'src/foo.js')).toBe('dancode-zoom-file:proj-a:src/foo.js')
  })

  it('keeps distinct keys for the same file in different projects', () => {
    const a = fileZoomStorageKey('proj-a', 'src/foo.js')
    const b = fileZoomStorageKey('proj-b', 'src/foo.js')
    expect(a).not.toBe(b)
  })
})

describe('readFileZoom / writeFileZoom round-trip', () => {
  it('returns the default when no value is stored', () => {
    expect(readFileZoom('proj', 'foo.js')).toBe(FILE_ZOOM_DEFAULT)
  })

  it('round-trips a written value', () => {
    writeFileZoom('proj', 'foo.js', 18)
    expect(readFileZoom('proj', 'foo.js')).toBe(18)
  })

  it('returns the default on invalid stored JSON', () => {
    localStorage.setItem(fileZoomStorageKey('proj', 'foo.js'), 'not-a-number')
    expect(readFileZoom('proj', 'foo.js')).toBe(FILE_ZOOM_DEFAULT)
  })

  it('clamps on write', () => {
    writeFileZoom('proj', 'foo.js', 999)
    expect(readFileZoom('proj', 'foo.js')).toBe(FILE_ZOOM_MAX)
    writeFileZoom('proj', 'foo.js', 1)
    expect(readFileZoom('proj', 'foo.js')).toBe(FILE_ZOOM_MIN)
  })

  it('clamps on read (handles legacy out-of-range values)', () => {
    localStorage.setItem(fileZoomStorageKey('proj', 'foo.js'), JSON.stringify(50))
    expect(readFileZoom('proj', 'foo.js')).toBe(FILE_ZOOM_MAX)
  })

  it('does not bleed between projects', () => {
    writeFileZoom('proj-a', 'foo.js', 22)
    expect(readFileZoom('proj-b', 'foo.js')).toBe(FILE_ZOOM_DEFAULT)
    expect(readFileZoom('proj-a', 'foo.js')).toBe(22)
  })
})

describe('clearFileZoom', () => {
  it('removes the persisted value so subsequent reads return the default', () => {
    writeFileZoom('proj', 'foo.js', 20)
    clearFileZoom('proj', 'foo.js')
    expect(readFileZoom('proj', 'foo.js')).toBe(FILE_ZOOM_DEFAULT)
  })
})

describe('stepFileZoom', () => {
  it('increases by FILE_ZOOM_STEP for "in"', () => {
    expect(stepFileZoom(14, 'in')).toBe(14 + FILE_ZOOM_STEP)
  })

  it('decreases by FILE_ZOOM_STEP for "out"', () => {
    expect(stepFileZoom(14, 'out')).toBe(14 - FILE_ZOOM_STEP)
  })

  it('returns the default for "reset"', () => {
    expect(stepFileZoom(20, 'reset')).toBe(FILE_ZOOM_DEFAULT)
  })

  it('clamps when stepping out from the minimum', () => {
    expect(stepFileZoom(FILE_ZOOM_MIN, 'out')).toBe(FILE_ZOOM_MIN)
  })

  it('clamps when stepping in from the maximum', () => {
    expect(stepFileZoom(FILE_ZOOM_MAX, 'in')).toBe(FILE_ZOOM_MAX)
  })
})
