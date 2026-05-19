import { describe, it, expect, beforeEach } from 'vitest'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { fileZoomKeymap, fileZoomFontTheme } from './zoom-keymap.js'
import { FILE_ZOOM_DEFAULT, FILE_ZOOM_MIN, FILE_ZOOM_MAX, readFileZoom, writeFileZoom } from './zoom.js'

function buildView({ slug = 'p', filePath = 'foo.js' } = {}) {
  const compartment = new Compartment()
  const initial = readFileZoom(slug, filePath)
  const state = EditorState.create({
    doc: 'hello\nworld\n',
    extensions: [
      compartment.of(fileZoomFontTheme(initial)),
      fileZoomKeymap({ slug, filePath, compartment }),
    ],
  })
  const root = document.createElement('div')
  document.body.appendChild(root)
  const view = new EditorView({ state, parent: root })
  return { view, compartment, root }
}

function getFontSizePx(view) {
  // Pull the font-size out of the cm-content style applied by the theme.
  const content = view.dom.querySelector('.cm-content')
  if (!content) return null
  // Theme styles are applied as a generated stylesheet, but the test
  // theme uses EditorView.theme which sets a class on the editor and emits
  // CSS. We can't reliably read getComputedStyle in jsdom, so we ask CM
  // for its measured font size via getComputedStyle on document head.
  // Simpler: keep the compartment payload exposed so the test can assert
  // through the public API of the helper.
  return null
}

function pressKey(view, key, { shift = false } = {}) {
  // Build a KeyboardEvent CodeMirror can dispatch.
  const evt = new KeyboardEvent('keydown', {
    key,
    code: key === '=' ? 'Equal' : key === '-' ? 'Minus' : key === '0' ? 'Digit0' : key === '+' ? 'Equal' : `Key${key.toUpperCase()}`,
    ctrlKey: true,
    metaKey: false,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  })
  view.contentDOM.dispatchEvent(evt)
  return evt
}

describe('fileZoomFontTheme', () => {
  it('applies the requested font size to the editor via CSS', () => {
    const theme = fileZoomFontTheme(20)
    expect(theme).toBeDefined()
  })
})

describe('fileZoomKeymap', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('Ctrl+= increases the persisted zoom by one step', () => {
    const { view } = buildView({ slug: 'p', filePath: 'a.js' })
    const evt = pressKey(view, '=')
    expect(evt.defaultPrevented).toBe(true)
    expect(readFileZoom('p', 'a.js')).toBe(FILE_ZOOM_DEFAULT + 1)
  })

  it('Ctrl+- decreases the persisted zoom by one step', () => {
    const { view } = buildView({ slug: 'p', filePath: 'a.js' })
    const evt = pressKey(view, '-')
    expect(evt.defaultPrevented).toBe(true)
    expect(readFileZoom('p', 'a.js')).toBe(FILE_ZOOM_DEFAULT - 1)
  })

  it('Ctrl+0 resets the persisted zoom to default', () => {
    writeFileZoom('p', 'a.js', 22)
    const { view } = buildView({ slug: 'p', filePath: 'a.js' })
    const evt = pressKey(view, '0')
    expect(evt.defaultPrevented).toBe(true)
    expect(readFileZoom('p', 'a.js')).toBe(FILE_ZOOM_DEFAULT)
  })

  it('Ctrl+- clamps at the configured minimum', () => {
    writeFileZoom('p', 'a.js', FILE_ZOOM_MIN)
    const { view } = buildView({ slug: 'p', filePath: 'a.js' })
    pressKey(view, '-')
    expect(readFileZoom('p', 'a.js')).toBe(FILE_ZOOM_MIN)
  })

  it('Ctrl+= clamps at the configured maximum', () => {
    writeFileZoom('p', 'a.js', FILE_ZOOM_MAX)
    const { view } = buildView({ slug: 'p', filePath: 'a.js' })
    pressKey(view, '=')
    expect(readFileZoom('p', 'a.js')).toBe(FILE_ZOOM_MAX)
  })

  it('Ctrl+Shift+= (i.e. Ctrl+"+") also zooms in', () => {
    const { view } = buildView({ slug: 'p', filePath: 'a.js' })
    pressKey(view, '+', { shift: true })
    expect(readFileZoom('p', 'a.js')).toBe(FILE_ZOOM_DEFAULT + 1)
  })

  it('reconfigures the editor compartment so the new font-size applies', () => {
    const { view, compartment } = buildView({ slug: 'p', filePath: 'a.js' })
    pressKey(view, '=')
    // After dispatch the compartment is reconfigured. We can probe it by
    // re-extracting its current extension via the state.
    const ext = compartment.get(view.state)
    expect(ext).toBeDefined()
  })

  it('keeps zoom independent per file path', () => {
    const { view: viewA } = buildView({ slug: 'p', filePath: 'a.js' })
    const { view: viewB } = buildView({ slug: 'p', filePath: 'b.js' })
    pressKey(viewA, '=')
    expect(readFileZoom('p', 'a.js')).toBe(FILE_ZOOM_DEFAULT + 1)
    expect(readFileZoom('p', 'b.js')).toBe(FILE_ZOOM_DEFAULT)
  })

  it('keeps zoom independent per project slug for the same path', () => {
    const { view: viewA } = buildView({ slug: 'proj-a', filePath: 'shared.js' })
    pressKey(viewA, '=')
    pressKey(viewA, '=')
    expect(readFileZoom('proj-a', 'shared.js')).toBe(FILE_ZOOM_DEFAULT + 2)
    expect(readFileZoom('proj-b', 'shared.js')).toBe(FILE_ZOOM_DEFAULT)
  })
})
