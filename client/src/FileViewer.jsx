import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import hljs from 'highlight.js/lib/core'
import 'highlight.js/styles/base16/solarized-dark.css'

// Register common languages
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import json from 'highlight.js/lib/languages/json'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import markdown from 'highlight.js/lib/languages/markdown'
import bash from 'highlight.js/lib/languages/bash'
import yaml from 'highlight.js/lib/languages/yaml'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import java from 'highlight.js/lib/languages/java'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import sql from 'highlight.js/lib/languages/sql'
import diff from 'highlight.js/lib/languages/diff'
import ini from 'highlight.js/lib/languages/ini'
import plaintext from 'highlight.js/lib/languages/plaintext'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('json', json)
hljs.registerLanguage('css', css)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('java', java)
hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('diff', diff)
hljs.registerLanguage('ini', ini)
hljs.registerLanguage('plaintext', plaintext)

// Map file extensions to highlight.js language names
const EXT_TO_LANG = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python',
  json: 'json',
  css: 'css',
  html: 'xml', htm: 'xml', svg: 'xml', xml: 'xml',
  md: 'markdown',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  yml: 'yaml', yaml: 'yaml',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  sql: 'sql',
  diff: 'diff', patch: 'diff',
  ini: 'ini', toml: 'ini', cfg: 'ini', conf: 'ini', env: 'ini',
}

function detectLanguage(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase()
  return EXT_TO_LANG[ext] || null
}

function getFileName(filePath) {
  return filePath.split('/').pop() || filePath
}

export default function FileViewer({ token, slug, filePath, focused, onFocus }) {
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef(null)

  const language = useMemo(() => detectLanguage(filePath), [filePath])

  // Fetch file content
  const fetchContent = useCallback(async () => {
    if (!token || !slug || !filePath) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ path: filePath, project: slug })
      const res = await fetch(`/api/files/read?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setContent(data.content)
    } catch (err) {
      setError(err.message || 'Failed to load file')
    } finally {
      setLoading(false)
    }
  }, [token, slug, filePath])

  useEffect(() => {
    fetchContent()
  }, [fetchContent])

  // Highlighted HTML
  const highlightedHtml = useMemo(() => {
    if (content == null) return null
    try {
      if (language) {
        return hljs.highlight(content, { language }).value
      }
      return hljs.highlightAuto(content).value
    } catch {
      // Fallback to escaped plain text
      return content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
    }
  }, [content, language])

  const lineCount = useMemo(() => {
    if (content == null) return 0
    return content.split('\n').length
  }, [content])

  const handleEdit = useCallback(() => {
    setEditContent(content || '')
    setEditing(true)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [content])

  const handleCancel = useCallback(() => {
    setEditing(false)
    setEditContent('')
  }, [])

  const handleSave = useCallback(async () => {
    if (!token || !slug || !filePath) return
    setSaving(true)
    try {
      const res = await fetch('/api/files/write', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ path: filePath, content: editContent, project: slug }),
      })
      if (!res.ok) throw new Error('Save failed')
      setContent(editContent)
      setEditing(false)
      setEditContent('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }, [token, slug, filePath, editContent])

  // Keyboard shortcut: Ctrl+S to save in edit mode
  useEffect(() => {
    if (!editing) return
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        handleCancel()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [editing, handleSave, handleCancel])

  if (loading) {
    return (
      <div
        data-testid="file-viewer"
        className="flex flex-col w-full h-full bg-base03"
        onClick={onFocus}
      >
        <div className="flex items-center justify-center flex-1">
          <div className="w-5 h-5 border-2 border-base01/30 border-t-blue rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  if (error && content == null) {
    return (
      <div
        data-testid="file-viewer"
        className="flex flex-col w-full h-full bg-base03"
        onClick={onFocus}
      >
        <div className="flex items-center justify-center flex-1 p-4">
          <div className="text-center">
            <div className="text-red text-sm font-medium mb-1">Failed to load file</div>
            <div className="text-base01 text-xs">{error}</div>
            <button
              onClick={fetchContent}
              className="mt-2 px-3 py-1 text-xs text-blue border border-blue/50 rounded hover:bg-blue/10 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid="file-viewer"
      className="flex flex-col w-full h-full bg-base03"
      onClick={onFocus}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1">
        {language && (
          <span className="text-[10px] text-base01 bg-base02 px-1.5 py-0.5 rounded">
            {language}
          </span>
        )}
        {error && (
          <span className="text-[10px] text-red">{error}</span>
        )}
        <div className="ml-auto flex gap-1">
          {editing ? (
            <>
              <button
                data-testid="file-viewer-save"
                onClick={handleSave}
                disabled={saving}
                className="px-2 py-0.5 text-xs text-base03 bg-blue rounded hover:bg-blue/80 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                data-testid="file-viewer-cancel"
                onClick={handleCancel}
                className="px-2 py-0.5 text-xs text-base0 border border-base01/30 rounded hover:bg-base02 transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              data-testid="file-viewer-edit"
              onClick={handleEdit}
              className="px-2 py-0.5 text-xs text-base0 border border-base01/30 rounded hover:bg-base02 transition-colors"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {editing ? (
        <textarea
          ref={textareaRef}
          data-testid="file-viewer-editor"
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          className="flex-1 min-h-0 w-full bg-base03 text-base0 text-xs font-mono p-3 resize-none outline-none border-none"
          spellCheck={false}
        />
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="flex text-xs font-mono leading-5">
            {/* Line numbers */}
            <div className="shrink-0 text-right pr-3 pl-2 text-base01/60 select-none border-r border-base01/20 sticky left-0 bg-base03">
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i + 1}>{i + 1}</div>
              ))}
            </div>
            {/* Code content */}
            <pre className="flex-1 min-w-0 pl-3 pr-3 overflow-x-auto">
              <code
                data-testid="file-viewer-code"
                className="hljs"
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
