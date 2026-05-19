// CodeMirror keymap + theme builder that wires Ctrl/Cmd +/-/0 to per-file
// zoom. The compartment is owned by the consumer (FileViewer) so it can be
// reconfigured on doc replacement without losing keymap state.

import { keymap, EditorView } from '@codemirror/view'
import { stepFileZoom, writeFileZoom, FILE_ZOOM_DEFAULT } from './zoom.js'

/**
 * Returns a CodeMirror Extension that sets the editor's font-size to the
 * given pixel value. Applies to the editor wrapper and content so line
 * height + gutters scale together.
 */
export function fileZoomFontTheme(sizePx) {
  const px = `${Number(sizePx) || FILE_ZOOM_DEFAULT}px`
  return EditorView.theme({
    '&': { fontSize: px },
    '.cm-content': { fontSize: px },
    '.cm-gutters': { fontSize: px },
  })
}

function applyStep(view, slug, filePath, compartment, direction) {
  // Determine the current size from the last write, NOT from the
  // compartment payload — we never tear it apart at runtime.
  const stored = JSON.parse(
    (typeof localStorage !== 'undefined' && localStorage.getItem(`dancode-zoom-file:${slug}:${filePath}`)) || 'null'
  )
  const current = typeof stored === 'number' ? stored : FILE_ZOOM_DEFAULT
  const next = stepFileZoom(current, direction)
  writeFileZoom(slug, filePath, next)
  view.dispatch({
    effects: compartment.reconfigure(fileZoomFontTheme(next)),
  })
  return true
}

/**
 * Build a keymap extension that drives per-file zoom on the supplied CM view.
 * The handler returns true (consume + preventDefault) only when the editor
 * actually has focus — outside focus, no event ever reaches this keymap, so
 * the browser's native page zoom is preserved automatically.
 */
export function fileZoomKeymap({ slug, filePath, compartment }) {
  return keymap.of([
    {
      key: 'Mod-=',
      preventDefault: true,
      run: (view) => applyStep(view, slug, filePath, compartment, 'in'),
    },
    {
      // Many keyboard layouts deliver Ctrl+Shift+= as Ctrl++
      key: 'Mod-+',
      preventDefault: true,
      run: (view) => applyStep(view, slug, filePath, compartment, 'in'),
    },
    {
      key: 'Mod--',
      preventDefault: true,
      run: (view) => applyStep(view, slug, filePath, compartment, 'out'),
    },
    {
      key: 'Mod-0',
      preventDefault: true,
      run: (view) => applyStep(view, slug, filePath, compartment, 'reset'),
    },
  ])
}
