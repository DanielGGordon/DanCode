import { useState, useEffect, useRef } from 'react'

export function fuzzyMatch(query, text) {
  if (!query) return true
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  let qi = 0
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++
  }
  return qi === q.length
}

export default function CommandPalette({ open, onClose, projects, currentSlug, onSelect }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      // Focus input on next tick so the element is rendered
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  if (!open) return null

  const filtered = (projects || []).filter((p) => fuzzyMatch(query, p.name))

  return (
    <div
      data-testid="command-palette-backdrop"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        data-testid="command-palette"
        className="mt-[15vh] w-full max-w-lg bg-base02 border border-base01/50 rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b border-base01/30">
          <input
            ref={inputRef}
            data-testid="command-palette-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects…"
            className="w-full px-3 py-2 text-sm text-base1 bg-base03 border border-base01/30 rounded placeholder-base01 outline-none focus:border-blue/50"
          />
        </div>
        <ul data-testid="command-palette-list" className="max-h-64 overflow-y-auto py-1">
          {filtered.length === 0 && projects?.length === 0 && (
            <li data-testid="command-palette-empty" className="px-4 py-3 text-sm text-base01">
              No projects yet. Create one with the + New Project button.
            </li>
          )}
          {filtered.length === 0 && projects?.length > 0 && (
            <li data-testid="command-palette-no-match" className="px-4 py-3 text-sm text-base01">
              No matching projects
            </li>
          )}
          {filtered.map((p) => (
            <li
              key={p.slug}
              data-testid={`command-palette-item-${p.slug}`}
              className={`px-4 py-2 text-sm cursor-pointer transition-colors ${
                p.slug === currentSlug
                  ? 'text-blue bg-base03/50'
                  : 'text-base0 hover:bg-base03/30'
              }`}
              onClick={() => onSelect(p.slug)}
            >
              {p.name}
              {p.slug === currentSlug && (
                <span className="ml-2 text-xs text-base01">current</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
