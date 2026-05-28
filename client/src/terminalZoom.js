// Per-terminal font-size persistence. Values are stored in localStorage under
// `dancode-zoom-terminal:<id>` and clamped to [MIN, MAX] on every read/write so
// stale or corrupted entries are coerced to a sane size rather than rejected.

export const DEFAULT_TERMINAL_FONT_SIZE = 13
export const MIN_TERMINAL_FONT_SIZE = 8
export const MAX_TERMINAL_FONT_SIZE = 32
export const TERMINAL_ZOOM_KEY_PREFIX = 'dancode-zoom-terminal:'

export function clampTerminalFontSize(value) {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return DEFAULT_TERMINAL_FONT_SIZE
  }
  const rounded = Math.round(n)
  if (rounded < MIN_TERMINAL_FONT_SIZE) return MIN_TERMINAL_FONT_SIZE
  if (rounded > MAX_TERMINAL_FONT_SIZE) return MAX_TERMINAL_FONT_SIZE
  return rounded
}

export function zoomStorageKey(terminalId) {
  return `${TERMINAL_ZOOM_KEY_PREFIX}${terminalId}`
}

function safeStorage() {
  if (typeof globalThis === 'undefined') return null
  try {
    return globalThis.localStorage || null
  } catch {
    return null
  }
}

export function readTerminalFontSize(terminalId) {
  if (!terminalId) return DEFAULT_TERMINAL_FONT_SIZE
  const storage = safeStorage()
  if (!storage) return DEFAULT_TERMINAL_FONT_SIZE
  let raw = null
  try {
    raw = storage.getItem(zoomStorageKey(terminalId))
  } catch {
    return DEFAULT_TERMINAL_FONT_SIZE
  }
  if (raw == null) return DEFAULT_TERMINAL_FONT_SIZE
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_TERMINAL_FONT_SIZE
  return clampTerminalFontSize(n)
}

export function writeTerminalFontSize(terminalId, size) {
  if (!terminalId) return
  const storage = safeStorage()
  if (!storage) return
  const clamped = clampTerminalFontSize(size)
  try {
    storage.setItem(zoomStorageKey(terminalId), String(clamped))
  } catch {
    // QuotaExceeded / disabled storage — best effort, ignore.
  }
}

export function removeTerminalFontSize(terminalId) {
  if (!terminalId) return
  const storage = safeStorage()
  if (!storage) return
  try {
    storage.removeItem(zoomStorageKey(terminalId))
  } catch {
    // ignore
  }
}

export function stepZoom(currentSize, direction) {
  const base = clampTerminalFontSize(currentSize)
  return clampTerminalFontSize(base + Math.sign(direction))
}
