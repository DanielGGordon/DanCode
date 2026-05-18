import { useEffect, useRef, useState } from 'react'

/**
 * Longest common prefix among a list of strings. Used for Tab-completion in
 * the path picker: when the user hits Tab and there are multiple matches,
 * we fill in as much as is unambiguous.
 */
function longestCommonPrefix(strs) {
  if (!strs.length) return ''
  let prefix = strs[0]
  for (let i = 1; i < strs.length; i++) {
    while (!strs[i].toLowerCase().startsWith(prefix.toLowerCase())) {
      prefix = prefix.slice(0, -1)
      if (!prefix) return ''
    }
  }
  return prefix
}

export default function NewProjectForm({ token, onCreated, onCancel }) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('~/')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Path autocomplete state
  const [suggestions, setSuggestions] = useState([]) // string[] of directory names
  const [suggestBase, setSuggestBase] = useState('') // absolute base dir
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const pathInputRef = useRef(null)
  const wrapperRef = useRef(null)

  // Fetch suggestions whenever the path changes
  useEffect(() => {
    if (!token) return
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/system/dirs?path=${encodeURIComponent(path)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        })
        if (!res.ok) {
          setSuggestions([])
          return
        }
        const data = await res.json()
        setSuggestions(Array.isArray(data.entries) ? data.entries : [])
        setSuggestBase(typeof data.base === 'string' ? data.base : '')
        setHighlight(-1)
      } catch {}
    }, 80)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [path, token])

  // Close dropdown on click outside
  useEffect(() => {
    function onDown(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // Compose a final path string by appending `dir` to the current input.
  // If the input ends with '/', we just append. Otherwise we replace the
  // trailing basename with `dir`.
  function applyEntry(dir, { trailingSlash = true } = {}) {
    let next
    if (!path || path.endsWith('/')) {
      next = path + dir
    } else {
      const idx = path.lastIndexOf('/')
      next = idx >= 0 ? path.slice(0, idx + 1) + dir : dir
    }
    if (trailingSlash) next += '/'
    setPath(next)
    setHighlight(-1)
    // Trigger a fresh fetch by leaving the dropdown open
    setOpen(true)
    requestAnimationFrame(() => pathInputRef.current?.focus())
  }

  function handleTab(e) {
    e.preventDefault()
    if (suggestions.length === 0) return
    if (suggestions.length === 1) {
      applyEntry(suggestions[0])
      return
    }
    // Multiple matches → complete the longest common prefix, leave dropdown open
    const prefix = longestCommonPrefix(suggestions)
    if (!prefix) { setOpen(true); return }
    // Replace just the trailing basename portion with the prefix
    const slash = path.lastIndexOf('/')
    const base = slash >= 0 ? path.slice(0, slash + 1) : ''
    const cur = slash >= 0 ? path.slice(slash + 1) : path
    if (prefix.length > cur.length) {
      setPath(base + prefix)
    }
    setOpen(true)
  }

  function handlePathKeyDown(e) {
    if (e.key === 'Tab' && !e.shiftKey) {
      handleTab(e)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlight((h) => Math.min(suggestions.length - 1, h + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(-1, h - 1))
      return
    }
    if (e.key === 'Enter') {
      if (open && highlight >= 0 && suggestions[highlight]) {
        e.preventDefault()
        applyEntry(suggestions[highlight])
      }
      // Otherwise let the form submit naturally
      return
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        setOpen(false)
      }
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmedName = name.trim()
    const trimmedPath = path.trim()

    if (!trimmedName) {
      setError('Project name is required')
      return
    }
    if (!trimmedPath) {
      setError('Project path is required')
      return
    }

    setError('')
    setSubmitting(true)

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: trimmedName, path: trimmedPath }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to create project')
        setSubmitting(false)
        return
      }

      onCreated(data)
    } catch {
      setError('Unable to reach server')
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-base03">
      <form
        onSubmit={handleSubmit}
        data-testid="new-project-form"
        className="flex flex-col gap-4 p-8 rounded-lg bg-base02 border border-base01/30 shadow-lg w-full max-w-md"
      >
        <h2 className="text-xl font-semibold text-base1 text-center">New Project</h2>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-base0">Project Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Project"
            data-testid="project-name-input"
            className="px-3 py-2 rounded bg-base03 border border-base01/50 text-base0 placeholder-base01 focus:outline-none focus:border-blue"
          />
        </label>

        <label className="flex flex-col gap-1 relative" ref={wrapperRef}>
          <span className="text-sm text-base0">Directory Path</span>
          <input
            ref={pathInputRef}
            type="text"
            value={path}
            onChange={(e) => { setPath(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onKeyDown={handlePathKeyDown}
            placeholder="~/projects/my-project"
            data-testid="project-path-input"
            autoComplete="off"
            spellCheck={false}
            className="px-3 py-2 rounded bg-base03 border border-base01/50 text-base0 placeholder-base01 focus:outline-none focus:border-blue font-mono text-sm"
          />
          {open && suggestions.length > 0 && (
            <ul
              data-testid="path-suggestions"
              className="absolute top-full left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-base02 border border-base01/40 rounded shadow-lg z-50 py-1"
            >
              {suggestBase && (
                <li className="px-3 py-1 text-[10px] text-base01 uppercase tracking-wider truncate">{suggestBase}</li>
              )}
              {suggestions.map((dir, i) => (
                <li key={dir}>
                  <button
                    type="button"
                    data-testid={`path-suggestion-${dir}`}
                    onMouseDown={(e) => { e.preventDefault(); applyEntry(dir) }}
                    className={`w-full text-left px-3 py-1 text-sm font-mono transition-colors ${
                      i === highlight
                        ? 'bg-base03/70 text-base1'
                        : 'text-base0 hover:bg-base03/40 hover:text-base1'
                    }`}
                  >
                    {dir}/
                  </button>
                </li>
              ))}
            </ul>
          )}
          <span className="text-[10px] text-base01">
            Tab to complete &middot; ↑/↓ to navigate &middot; Enter to select
          </span>
        </label>

        {error && (
          <p data-testid="new-project-error" className="text-sm text-red text-center">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            data-testid="new-project-cancel"
            className="flex-1 px-4 py-2 rounded border border-base01/50 text-base0 hover:bg-base03 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            data-testid="new-project-submit"
            className="flex-1 px-4 py-2 rounded bg-blue text-base3 font-medium hover:bg-blue/80 transition-colors disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create Project'}
          </button>
        </div>
      </form>
    </div>
  )
}
