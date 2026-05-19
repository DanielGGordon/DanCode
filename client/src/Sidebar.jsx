import { useState, useEffect, useRef, useCallback } from 'react'
import SystemStats from './SystemStats.jsx'

function ClaudeDot({ state }) {
  if (state !== 'waiting' && state !== 'working') return null
  const isWaiting = state === 'waiting'
  return (
    <span
      data-testid={`claude-dot-${state}`}
      title={isWaiting ? 'Claude is waiting for you' : 'Claude is working'}
      aria-label={isWaiting ? 'Claude is waiting for you' : 'Claude is working'}
      className={`shrink-0 w-2 h-2 rounded-full ${
        isWaiting ? 'bg-red shadow-[0_0_4px_rgba(220,50,47,0.8)]' : 'bg-yellow animate-pulse'
      }`}
    />
  )
}

export default function Sidebar({ projects, currentSlug, onSelect, onDelete, onRename, onReorder, collapsed, onToggle, token, claudeState = {} }) {
  const [menu, setMenu] = useState(null) // { slug, x, y }
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [renaming, setRenaming] = useState(null) // { slug, name }
  const [dragSlug, setDragSlug] = useState(null)
  const [dropSlug, setDropSlug] = useState(null) // slug whose row the drop-indicator hovers above
  const menuRef = useRef(null)
  const renameRef = useRef(null)

  const handleDragStart = useCallback((e, slug) => {
    setDragSlug(slug)
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', slug) } catch {}
  }, [])

  const handleDragOver = useCallback((e, slug) => {
    if (!dragSlug || dragSlug === slug) return
    e.preventDefault()
    try { e.dataTransfer.dropEffect = 'move' } catch {}
    if (dropSlug !== slug) setDropSlug(slug)
  }, [dragSlug, dropSlug])

  const handleDrop = useCallback((e, targetSlug) => {
    e.preventDefault()
    const source = dragSlug
    setDragSlug(null)
    setDropSlug(null)
    if (!source || source === targetSlug || !Array.isArray(projects)) return
    const slugs = projects.map((p) => p.slug)
    const from = slugs.indexOf(source)
    const to = slugs.indexOf(targetSlug)
    if (from < 0 || to < 0) return
    const next = slugs.slice()
    next.splice(from, 1)
    next.splice(to, 0, source)
    onReorder?.(next)
  }, [dragSlug, projects, onReorder])

  const handleDragEnd = useCallback(() => {
    setDragSlug(null)
    setDropSlug(null)
  }, [])

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!menu) return
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(null)
    }
    const handleKey = (e) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [menu])

  // Auto-focus rename input
  useEffect(() => {
    if (renaming && renameRef.current) {
      renameRef.current.focus()
      renameRef.current.select()
    }
  }, [renaming])

  const handleContextMenu = useCallback((e, slug) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ slug, x: e.clientX, y: e.clientY })
    setConfirmDelete(null)
  }, [])

  const handleRenameSubmit = useCallback((slug, newName) => {
    if (newName && newName.trim()) {
      onRename?.(slug, newName.trim())
    }
    setRenaming(null)
  }, [onRename])

  return (
    <aside
      data-testid="sidebar"
      className={`${collapsed ? 'w-10' : 'w-52'} bg-base02 border-r border-base01/30 flex flex-col shrink-0 transition-all duration-150 min-h-0`}
    >
      <div className={`flex items-center border-b border-base01/30 ${collapsed ? 'justify-center py-2' : 'px-3 py-2'}`}>
        {!collapsed && (
          <h2 className="text-xs font-semibold text-base01 uppercase tracking-wider flex-1">Projects</h2>
        )}
        <button
          data-testid="sidebar-toggle"
          onClick={() => onToggle?.()}
          className="text-base01 hover:text-base0 transition-colors text-xs leading-none"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '\u25b6' : '\u25c0'}
        </button>
      </div>
      {!collapsed && <ul data-testid="sidebar-project-list" className="py-1 flex-1 overflow-y-auto min-h-0">
        {(!projects || projects.length === 0) && (
          <li data-testid="sidebar-empty" className="px-3 py-2 text-xs text-base01">
            No projects yet
          </li>
        )}
        {(projects || []).map((p) => {
          const isDragging = dragSlug === p.slug
          const isDropTarget = dropSlug === p.slug && dragSlug && dragSlug !== p.slug
          return (
            <li
              key={p.slug}
              data-testid={`sidebar-project-${p.slug}`}
              draggable={renaming?.slug !== p.slug}
              onDragStart={(e) => handleDragStart(e, p.slug)}
              onDragOver={(e) => handleDragOver(e, p.slug)}
              onDrop={(e) => handleDrop(e, p.slug)}
              onDragEnd={handleDragEnd}
              onDragLeave={() => { if (dropSlug === p.slug) setDropSlug(null) }}
              className={`px-3 py-2 text-sm cursor-pointer transition-colors flex items-center gap-2 ${
                p.slug === currentSlug
                  ? 'text-base1 bg-base03/70 border-l-2 border-blue'
                  : 'text-base0 hover:bg-base03/30 border-l-2 border-transparent'
              } ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'border-t border-t-blue' : ''}`}
              onClick={() => onSelect?.(p.slug)}
              onContextMenu={(e) => handleContextMenu(e, p.slug)}
            >
              {renaming?.slug === p.slug ? (
                <input
                  ref={renameRef}
                  data-testid={`sidebar-rename-input-${p.slug}`}
                  className="flex-1 min-w-0 bg-base03 text-base1 text-sm px-1 py-0.5 rounded border border-blue/50 outline-none"
                  defaultValue={renaming.name}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameSubmit(p.slug, e.target.value)
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  onBlur={(e) => handleRenameSubmit(p.slug, e.target.value)}
                />
              ) : (
                <>
                  <span className="flex-1 truncate">{p.name}</span>
                  <ClaudeDot state={claudeState[p.slug]} />
                </>
              )}
            </li>
          )
        })}
      </ul>}

      {!collapsed && <SystemStats token={token} />}

      {/* Context menu */}
      {menu && (
        <div
          ref={menuRef}
          data-testid="sidebar-context-menu"
          className="fixed z-50 min-w-40 bg-base02 border border-base01/30 rounded shadow-lg py-1"
          style={{ left: menu.x, top: menu.y }}
        >
          {confirmDelete === menu.slug ? (
            <div className="px-3 py-2 text-xs">
              <span className="text-base0">Delete project?</span>
              <div className="flex gap-2 mt-1">
                <button
                  data-testid="context-delete-confirm"
                  className="text-red hover:text-red/80 font-medium"
                  onClick={() => { setMenu(null); setConfirmDelete(null); onDelete?.(menu.slug) }}
                >
                  Yes
                </button>
                <button
                  className="text-base01 hover:text-base0"
                  onClick={() => setConfirmDelete(null)}
                >
                  No
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                data-testid="context-rename"
                className="w-full text-left px-3 py-1.5 text-sm text-base0 hover:bg-base03/50 hover:text-base1 transition-colors"
                onClick={() => {
                  const project = projects.find((p) => p.slug === menu.slug)
                  setRenaming({ slug: menu.slug, name: project?.name || menu.slug })
                  setMenu(null)
                }}
              >
                Rename
              </button>
              <div className="border-t border-base01/30 my-1" />
              <button
                data-testid="context-delete"
                className="w-full text-left px-3 py-1.5 text-sm text-red/80 hover:bg-base03/50 hover:text-red transition-colors"
                onClick={() => setConfirmDelete(menu.slug)}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  )
}
