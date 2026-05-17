import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, rectangularSelection, crosshairCursor, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap, search, openSearchPanel } from '@codemirror/search'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput, foldKeymap, foldGutter } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { detectLanguageName, getLanguageExtension } from './editor/language.js'

function getFileName(filePath) {
  return filePath.split('/').pop() || filePath
}

/**
 * Build a URL for the per-project file API. Each path segment is encoded
 * but the '/' separators are preserved so the wildcard route matches.
 */
export function buildFileUrl(slug, filePath) {
  const segs = String(filePath).split('/').map(encodeURIComponent).join('/')
  return `/api/projects/${encodeURIComponent(slug)}/files/${segs}`
}

// Shared base extensions that every editor instance gets, regardless of
// language. Defined once at module scope so EditorState.create is cheap.
function baseExtensions() {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    foldGutter(),
    drawSelection(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    history(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    search({ top: true }),
    EditorView.lineWrapping,
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
  ]
}

export default function FileViewer({ token, slug, filePath, focused, onFocus }) {
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error'
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const hostRef = useRef(null)
  const viewRef = useRef(null)
  const languageCompartment = useRef(new Compartment())
  // Stash the latest doc + handlers in refs so we can call them from CM
  // callbacks without recreating the editor.
  const latestRef = useRef({ token, slug, filePath, dirty: false })

  const language = useMemo(() => detectLanguageName(filePath), [filePath])

  useEffect(() => {
    latestRef.current.token = token
    latestRef.current.slug = slug
    latestRef.current.filePath = filePath
  }, [token, slug, filePath])

  // saveNow is stable; it reads the latest doc straight from the live view
  // and POSTs through the per-project file route. It is safe to call from
  // keybindings or blur handlers any time after mount.
  const saveNow = useCallback(async () => {
    const view = viewRef.current
    const { token: tk, slug: sl, filePath: fp } = latestRef.current
    if (!view || !tk || !sl || !fp) return false
    const content = view.state.doc.toString()
    setSaving(true)
    try {
      const res = await fetch(buildFileUrl(sl, fp), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tk}`,
        },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      latestRef.current.dirty = false
      setDirty(false)
      return true
    } catch (err) {
      setError(err.message || 'Save failed')
      return false
    } finally {
      setSaving(false)
    }
  }, [])

  // Fetch file content + create the EditorView once both are ready.
  useEffect(() => {
    let cancelled = false
    if (!token || !slug || !filePath) return

    setStatus('loading')
    setError(null)
    setDirty(false)

    async function bootstrap() {
      let content = ''
      try {
        const res = await fetch(buildFileUrl(slug, filePath), {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          const text = await res.text()
          throw new Error(text || `HTTP ${res.status}`)
        }
        const data = await res.json()
        content = data.content ?? ''
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to load file')
          setStatus('error')
        }
        return
      }
      if (cancelled) return

      const langExt = await getLanguageExtension(language)
      if (cancelled) return

      // Tear down a previous view (file switch) before mounting a new one.
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }

      const ctrlS = {
        // Ctrl/Cmd-S → save. Returning true tells CM to swallow the event.
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          saveNow()
          return true
        },
      }

      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          latestRef.current.dirty = true
          setDirty(true)
        }
      })

      const blurHandler = EditorView.domEventHandlers({
        blur: () => {
          if (latestRef.current.dirty) {
            saveNow()
          }
          return false
        },
        focus: () => {
          if (typeof onFocus === 'function') onFocus()
          return false
        },
      })

      const extensions = [
        ...baseExtensions(),
        keymap.of([ctrlS]),
        updateListener,
        blurHandler,
        languageCompartment.current.of(langExt ? [langExt] : []),
      ]

      if (!hostRef.current) return
      const state = EditorState.create({ doc: content, extensions })
      const view = new EditorView({ state, parent: hostRef.current })
      viewRef.current = view
      // Test affordance: expose the current EditorView so the Playwright perf
      // test (and any future test that needs to drive the editor
      // programmatically) can call view.dispatch(...) without poking into CM
      // private APIs. No-op outside of jsdom/Playwright contexts.
      if (typeof window !== 'undefined') {
        window.__dancodeCmView = view
      }
      setStatus('ready')
    }

    bootstrap()

    return () => {
      cancelled = true
    }
    // We intentionally rebuild the editor when filePath/slug/token change to
    // load fresh content. language is derived from filePath so it's covered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, slug, filePath])

  // Destroy on unmount
  useEffect(() => () => {
    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }
  }, [])

  const handleOpenFind = useCallback(() => {
    if (viewRef.current) {
      openSearchPanel(viewRef.current)
      viewRef.current.focus()
    }
  }, [])

  return (
    <div
      data-testid="file-viewer"
      data-language={language || 'plain'}
      data-dirty={dirty ? 'true' : 'false'}
      className="flex flex-col w-full h-full bg-base03"
      onClick={onFocus}
    >
      <div className="flex items-center gap-2 px-3 py-1 shrink-0">
        <span className="text-xs text-base0 truncate" data-testid="file-viewer-name">
          {getFileName(filePath)}
        </span>
        <span className="text-[10px] text-base01 bg-base02 px-1.5 py-0.5 rounded" data-testid="file-viewer-language">
          {language || 'plain'}
        </span>
        {dirty && (
          <span className="text-[10px] text-yellow" data-testid="file-viewer-dirty">●</span>
        )}
        {saving && (
          <span className="text-[10px] text-base01" data-testid="file-viewer-saving">saving…</span>
        )}
        {error && (
          <span className="text-[10px] text-red" data-testid="file-viewer-error" title={error}>{error}</span>
        )}
        <div className="ml-auto flex gap-1">
          <button
            data-testid="file-viewer-find"
            onClick={handleOpenFind}
            className="px-2 py-0.5 text-xs text-base0 border border-base01/30 rounded hover:bg-base02 transition-colors"
          >
            Find
          </button>
          <button
            data-testid="file-viewer-save"
            onClick={saveNow}
            disabled={saving}
            className="px-2 py-0.5 text-xs text-base03 bg-blue rounded hover:bg-blue/80 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <div
        ref={hostRef}
        data-testid="file-viewer-editor"
        className="flex-1 min-h-0 overflow-hidden"
      />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-5 h-5 border-2 border-base01/30 border-t-blue rounded-full animate-spin" />
        </div>
      )}
    </div>
  )
}
