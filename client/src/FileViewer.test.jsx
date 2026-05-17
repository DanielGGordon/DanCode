import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import FileViewer, { buildFileUrl } from './FileViewer.jsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function mockFetchSequence(handlers) {
  const calls = []
  const fetchMock = vi.fn(async (url, init = {}) => {
    calls.push({ url, init })
    const matched = handlers.find((h) => h.match(url, init))
    if (!matched) throw new Error(`unexpected fetch: ${init.method || 'GET'} ${url}`)
    return matched.respond(url, init)
  })
  globalThis.fetch = fetchMock
  return { calls, fetchMock }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function renderEditor({ filePath = 'foo.js', initial = 'hello world\n', slug = 'proj', token = 'tok' } = {}) {
  const handlers = [
    {
      match: (u, i) => (i.method === undefined || i.method === 'GET') && String(u).includes(`/files/`),
      respond: () => jsonResponse(200, { content: initial }),
    },
    {
      match: (u, i) => i.method === 'PUT' && String(u).includes('/files/'),
      respond: () => jsonResponse(200, { ok: true }),
    },
  ]
  const { calls, fetchMock } = mockFetchSequence(handlers)
  const utils = render(<FileViewer token={token} slug={slug} filePath={filePath} />)
  // Wait for content to be applied to CodeMirror
  await waitFor(() => {
    expect(utils.queryByTestId('file-viewer-editor')?.textContent?.length).toBeGreaterThan(0)
  })
  return { ...utils, calls, fetchMock }
}

describe('buildFileUrl', () => {
  it('preserves slashes between path segments', () => {
    expect(buildFileUrl('proj', 'src/a/b.js')).toBe('/api/projects/proj/files/src/a/b.js')
  })

  it('encodes special characters in segments', () => {
    expect(buildFileUrl('proj', 'a b/c.js')).toBe('/api/projects/proj/files/a%20b/c.js')
  })
})

describe('FileViewer language detection', () => {
  it('renders language=javascript for .js files', async () => {
    const { getByTestId } = await renderEditor({ filePath: 'foo.js' })
    expect(getByTestId('file-viewer-language').textContent).toBe('javascript')
  })

  it('renders language=python for .py files', async () => {
    const { getByTestId } = await renderEditor({ filePath: 'foo.py' })
    expect(getByTestId('file-viewer-language').textContent).toBe('python')
  })

  it('falls back to "plain" for unknown extensions', async () => {
    const { getByTestId } = await renderEditor({ filePath: 'binary.xyz' })
    expect(getByTestId('file-viewer-language').textContent).toBe('plain')
  })

  it('renders language=yaml for .yaml files', async () => {
    const { getByTestId } = await renderEditor({ filePath: 'config.yaml' })
    expect(getByTestId('file-viewer-language').textContent).toBe('yaml')
  })
})

describe('FileViewer fetches via /api/projects/:slug/files/*', () => {
  it('GETs initial content from the per-project file route', async () => {
    const { calls } = await renderEditor({ filePath: 'src/foo.ts', slug: 'myproj', initial: 'export const x = 1\n' })
    const getCall = calls.find((c) => (c.init.method === undefined || c.init.method === 'GET'))
    expect(getCall).toBeDefined()
    expect(getCall.url).toBe('/api/projects/myproj/files/src/foo.ts')
    expect(getCall.init.headers.Authorization).toBe('Bearer tok')
  })
})

describe('FileViewer save flows', () => {
  it('saves via PUT when the Save button is clicked', async () => {
    const { calls, getByTestId } = await renderEditor({ filePath: 'foo.js' })
    fireEvent.click(getByTestId('file-viewer-save'))
    await waitFor(() => {
      expect(calls.some((c) => c.init.method === 'PUT')).toBe(true)
    })
    const putCall = calls.find((c) => c.init.method === 'PUT')
    expect(putCall.url).toBe('/api/projects/proj/files/foo.js')
    expect(JSON.parse(putCall.init.body).content).toBe('hello world\n')
  })

  it('saves when Ctrl+S is pressed inside the editor', async () => {
    const { calls, container, getByTestId } = await renderEditor({ filePath: 'foo.js' })
    const cmContent = container.querySelector('.cm-content')
    expect(cmContent).not.toBeNull()
    // Focus then press Ctrl+S
    act(() => { cmContent.focus() })
    fireEvent.keyDown(cmContent, { key: 's', code: 'KeyS', ctrlKey: true })
    await waitFor(() => {
      expect(calls.some((c) => c.init.method === 'PUT')).toBe(true)
    })
  })

  it('saves on editor blur when the document is dirty', async () => {
    const { calls, container } = await renderEditor({ filePath: 'foo.js' })
    const view = window.__cmViewForTest
    // Simulate a doc change by dispatching a CM transaction. We grab the
    // view off the DOM via the .cm-editor element's _editorView property
    // (CodeMirror sets this internally).
    const cmEditor = container.querySelector('.cm-editor')
    expect(cmEditor).not.toBeNull()
    // CodeMirror stores the EditorView on the DOM node as a property
    // accessible via EditorView.findFromDOM
    const { EditorView } = await import('@codemirror/view')
    const cmView = EditorView.findFromDOM(cmEditor)
    expect(cmView).not.toBeNull()
    act(() => {
      cmView.dispatch({
        changes: { from: cmView.state.doc.length, insert: ' MORE' },
      })
    })
    // Now blur
    const cmContent = container.querySelector('.cm-content')
    fireEvent.blur(cmContent)
    await waitFor(() => {
      expect(calls.some((c) => c.init.method === 'PUT')).toBe(true)
    })
    const putCall = calls.find((c) => c.init.method === 'PUT')
    expect(JSON.parse(putCall.init.body).content).toBe('hello world\n MORE')
  })

  it('does NOT save on blur when the document is clean', async () => {
    const { calls, container } = await renderEditor({ filePath: 'foo.js' })
    const cmContent = container.querySelector('.cm-content')
    fireEvent.blur(cmContent)
    // Give a tick for any pending PUT
    await new Promise((r) => setTimeout(r, 50))
    expect(calls.some((c) => c.init.method === 'PUT')).toBe(false)
  })
})

describe('FileViewer undo/redo', () => {
  it('undo restores previous content', async () => {
    const { container } = await renderEditor({ filePath: 'foo.js' })
    const cmEditor = container.querySelector('.cm-editor')
    const { EditorView } = await import('@codemirror/view')
    const view = EditorView.findFromDOM(cmEditor)
    act(() => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: ' EXTRA' } })
    })
    expect(view.state.doc.toString()).toBe('hello world\n EXTRA')
    // Undo via Ctrl+Z
    const cmContent = container.querySelector('.cm-content')
    fireEvent.keyDown(cmContent, { key: 'z', code: 'KeyZ', ctrlKey: true })
    await waitFor(() => {
      expect(view.state.doc.toString()).toBe('hello world\n')
    })
    // Redo via Ctrl+Y
    fireEvent.keyDown(cmContent, { key: 'y', code: 'KeyY', ctrlKey: true })
    await waitFor(() => {
      expect(view.state.doc.toString()).toBe('hello world\n EXTRA')
    })
  })
})

describe('FileViewer find panel', () => {
  it('opens the search panel when Find button is clicked', async () => {
    const { container, getByTestId } = await renderEditor({ filePath: 'foo.js' })
    fireEvent.click(getByTestId('file-viewer-find'))
    await waitFor(() => {
      expect(container.querySelector('.cm-panels .cm-search')).not.toBeNull()
    })
  })

  it('always shows line numbers', async () => {
    const { container } = await renderEditor({ filePath: 'foo.js', initial: 'a\nb\nc\n' })
    expect(container.querySelector('.cm-gutter.cm-lineNumbers')).not.toBeNull()
  })
})
