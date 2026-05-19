// Per-file-tab zoom helper. The CodeMirror editor stores its font size in
// localStorage keyed by ${projectSlug}:${filePath} so a chosen size survives
// reloads and does not bleed between projects.

export const FILE_ZOOM_DEFAULT = 14
export const FILE_ZOOM_MIN = 8
export const FILE_ZOOM_MAX = 32
export const FILE_ZOOM_STEP = 1
const STORAGE_PREFIX = 'dancode-zoom-file:'

export function clampFileZoom(value) {
  if (value === null || value === undefined || value === '') return FILE_ZOOM_DEFAULT
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return FILE_ZOOM_DEFAULT
  const rounded = Math.round(n)
  if (rounded < FILE_ZOOM_MIN) return FILE_ZOOM_MIN
  if (rounded > FILE_ZOOM_MAX) return FILE_ZOOM_MAX
  return rounded
}

export function fileZoomStorageKey(slug, filePath) {
  return `${STORAGE_PREFIX}${slug}:${filePath}`
}

export function readFileZoom(slug, filePath) {
  try {
    const raw = localStorage.getItem(fileZoomStorageKey(slug, filePath))
    if (raw == null) return FILE_ZOOM_DEFAULT
    const parsed = JSON.parse(raw)
    return clampFileZoom(parsed)
  } catch {
    return FILE_ZOOM_DEFAULT
  }
}

export function writeFileZoom(slug, filePath, value) {
  const clamped = clampFileZoom(value)
  try {
    localStorage.setItem(fileZoomStorageKey(slug, filePath), JSON.stringify(clamped))
  } catch {
    // localStorage unavailable / quota exceeded — best-effort only.
  }
  return clamped
}

export function clearFileZoom(slug, filePath) {
  try {
    localStorage.removeItem(fileZoomStorageKey(slug, filePath))
  } catch {
    // ignore
  }
}

export function stepFileZoom(current, direction) {
  if (direction === 'reset') return FILE_ZOOM_DEFAULT
  const base = clampFileZoom(current)
  if (direction === 'in') return clampFileZoom(base + FILE_ZOOM_STEP)
  if (direction === 'out') return clampFileZoom(base - FILE_ZOOM_STEP)
  return base
}
