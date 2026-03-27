import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

const FILE_EXPLORER_KEY = 'dancode-file-explorer'

// File type icon mapping
function getFileIcon(name, type) {
  if (type === 'directory') return '\u{1F4C1}' // folder
  const ext = name.split('.').pop()?.toLowerCase()
  const codeExts = ['js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'php', 'swift', 'kt']
  const configExts = ['json', 'yaml', 'yml', 'toml', 'ini', 'env', 'cfg', 'conf', 'xml']
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']
  const docExts = ['md', 'txt', 'rst', 'doc', 'pdf']
  if (codeExts.includes(ext)) return '\u{1F4C4}' // code file
  if (configExts.includes(ext)) return '\u2699\uFE0F' // config
  if (imageExts.includes(ext)) return '\u{1F5BC}\uFE0F' // image
  if (docExts.includes(ext)) return '\u{1F4DD}' // document
  return '\u{1F4C3}' // generic file
}

function TreeNode({ entry, path, depth, token, slug, onContextMenu, expandedDirs, toggleDir, loadChildren, children: childrenMap, showHidden, showIgnored, onDragStart, onDoubleClick, renaming, renameRef, onRenameSubmit, onRenameCancel, newItem, newItemRef, onNewItemSubmit, onNewItemCancel }) {
  const fullPath = path ? `${path}/${entry.name}` : entry.name
  const isDir = entry.type === 'directory'
  const isExpanded = expandedDirs.has(fullPath)
  const dirChildren = childrenMap[fullPath]
  const isRenaming = renaming?.path === fullPath

  const handleClick = useCallback(() => {
    if (isDir) {
      toggleDir(fullPath)
      if (!isExpanded && !dirChildren) {
        loadChildren(fullPath)
      }
    }
  }, [isDir, fullPath, isExpanded, dirChildren, toggleDir, loadChildren])

  const handleDragStart = useCallback((e) => {
    if (!isDir) {
      e.dataTransfer.setData('text/plain', fullPath)
      e.dataTransfer.setData('application/x-dancode-file', fullPath)
      e.dataTransfer.effectAllowed = 'copy'
      if (onDragStart) onDragStart(fullPath)
    }
  }, [isDir, fullPath, onDragStart])

  const handleDoubleClick = useCallback((e) => {
    if (!isDir && onDoubleClick) {
      e.preventDefault()
      onDoubleClick(fullPath)
    }
  }, [isDir, fullPath, onDoubleClick])

  if (isRenaming) {
    return (
      <div className="flex items-center px-1 py-0.5" style={{ paddingLeft: `${depth * 16 + 8}px` }}>
        <input
          ref={renameRef}
          data-testid="rename-input"
          className="flex-1 min-w-0 bg-base03 text-base1 text-xs px-1 py-0.5 rounded border border-blue/50 outline-none"
          defaultValue={renaming.name}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRenameSubmit(renaming.path, e.target.value)
            if (e.key === 'Escape') onRenameCancel()
          }}
          onBlur={(e) => onRenameSubmit(renaming.path, e.target.value)}
        />
      </div>
    )
  }

  return (
    <div>
      <div
        data-testid={`file-entry-${fullPath}`}
        data-file-path={fullPath}
        data-file-type={entry.type}
        className="flex items-center px-1 py-0.5 text-xs cursor-pointer hover:bg-base03/50 transition-colors group select-none"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => onContextMenu(e, fullPath, entry.type)}
        draggable={!isDir}
        onDragStart={handleDragStart}
      >
        {isDir && (
          <span className="w-3 text-center mr-0.5 text-base01 text-[10px]">
            {isExpanded ? '\u25BC' : '\u25B6'}
          </span>
        )}
        {!isDir && <span className="w-3 mr-0.5" />}
        <span className="mr-1 text-[11px]">{getFileIcon(entry.name, entry.type)}</span>
        <span className={`truncate ${isDir ? 'text-base1 font-medium' : 'text-base0'}`}>
          {entry.name}
        </span>
      </div>
      {isDir && isExpanded && dirChildren && (
        <div>
          {dirChildren.map((child) => (
            <TreeNode
              key={child.name}
              entry={child}
              path={fullPath}
              depth={depth + 1}
              token={token}
              slug={slug}
              onContextMenu={onContextMenu}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
              loadChildren={loadChildren}
              children={childrenMap}
              showHidden={showHidden}
              showIgnored={showIgnored}
              onDragStart={onDragStart}
              onDoubleClick={onDoubleClick}
              renaming={renaming}
              renameRef={renameRef}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              newItem={newItem}
              newItemRef={newItemRef}
              onNewItemSubmit={onNewItemSubmit}
              onNewItemCancel={onNewItemCancel}
            />
          ))}
          {/* New item input inside this expanded directory */}
          {newItem && newItem.parentPath === fullPath && (
            <div className="flex items-center px-1 py-0.5" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
              <span className="mr-1 text-[11px]">{newItem.type === 'directory' ? '\u{1F4C1}' : '\u{1F4C3}'}</span>
              <input
                ref={newItemRef}
                data-testid="new-item-input"
                className="flex-1 min-w-0 bg-base03 text-base1 text-xs px-1 py-0.5 rounded border border-blue/50 outline-none"
                placeholder={newItem.type === 'directory' ? 'New folder name...' : 'New file name...'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onNewItemSubmit(e.target.value)
                  if (e.key === 'Escape') onNewItemCancel()
                }}
                onBlur={(e) => onNewItemSubmit(e.target.value)}
              />
            </div>
          )}
          {dirChildren.length === 0 && !newItem?.parentPath === fullPath && (
            <div className="text-[10px] text-base01 italic" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
              (empty)
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function FileExplorer({ token, slug, collapsed, onToggle, onOpenTerminalHere, onInsertPath }) {
  const [rootEntries, setRootEntries] = useState([])
  const [children, setChildren] = useState({}) // { path: entries[] }
  const [expandedDirs, setExpandedDirs] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [showIgnored, setShowIgnored] = useState(false)
  const [contextMenu, setContextMenu] = useState(null) // { x, y, path, type }
  const [renaming, setRenaming] = useState(null) // { path, name }
  const [newItem, setNewItem] = useState(null) // { parentPath, type }
  const menuRef = useRef(null)
  const renameRef = useRef(null)
  const newItemRef = useRef(null)

  // Fetch directory contents
  const fetchDir = useCallback(async (dirPath = '.') => {
    if (!token || !slug) return []
    const params = new URLSearchParams({
      path: dirPath,
      project: slug,
      showHidden: String(showHidden),
      showIgnored: String(showIgnored),
    })
    try {
      const res = await fetch(`/api/files?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) return res.json()
    } catch {}
    return []
  }, [token, slug, showHidden, showIgnored])

  // Load root directory
  useEffect(() => {
    if (!slug || !token) return
    let cancelled = false
    setLoading(true)
    fetchDir('.').then((entries) => {
      if (!cancelled) {
        setRootEntries(entries)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [slug, token, fetchDir])

  // Load children of a directory
  const loadChildren = useCallback(async (dirPath) => {
    const entries = await fetchDir(dirPath)
    setChildren((prev) => ({ ...prev, [dirPath]: entries }))
  }, [fetchDir])

  // Toggle directory expansion
  const toggleDir = useCallback((dirPath) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(dirPath)) {
        next.delete(dirPath)
      } else {
        next.add(dirPath)
      }
      return next
    })
  }, [])

  // Refresh current view
  const refresh = useCallback(async () => {
    const entries = await fetchDir('.')
    setRootEntries(entries)
    // Refresh expanded dirs
    const expanded = Array.from(expandedDirs)
    for (const dir of expanded) {
      const dirEntries = await fetchDir(dir)
      setChildren((prev) => ({ ...prev, [dir]: dirEntries }))
    }
  }, [fetchDir, expandedDirs])

  // When toggles change, reload expanded directories
  useEffect(() => {
    if (!slug || !token) return
    // Re-fetch expanded dirs with new toggle settings
    const expanded = Array.from(expandedDirs)
    for (const dir of expanded) {
      loadChildren(dir)
    }
  }, [showHidden, showIgnored])

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setContextMenu(null)
    }
    const handleKey = (e) => { if (e.key === 'Escape') setContextMenu(null) }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  // Auto-focus rename input
  useEffect(() => {
    if (renaming && renameRef.current) {
      renameRef.current.focus()
      // Select just the filename without extension
      const dotIndex = renaming.name.lastIndexOf('.')
      if (dotIndex > 0) {
        renameRef.current.setSelectionRange(0, dotIndex)
      } else {
        renameRef.current.select()
      }
    }
  }, [renaming])

  // Auto-focus new item input
  useEffect(() => {
    if (newItem && newItemRef.current) {
      newItemRef.current.focus()
    }
  }, [newItem])

  // Context menu handler
  const handleContextMenu = useCallback((e, path, type) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, path, type })
  }, [])

  // Copy path to clipboard
  const handleCopyPath = useCallback(async (path) => {
    try {
      await navigator.clipboard.writeText(path)
    } catch {
      // Fallback for non-HTTPS
      const textarea = document.createElement('textarea')
      textarea.value = path
      textarea.style.cssText = 'position:fixed;opacity:0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    setContextMenu(null)
  }, [])

  // Delete file/directory
  const handleDelete = useCallback(async (path) => {
    setContextMenu(null)
    if (!confirm(`Delete "${path}"?`)) return
    try {
      const params = new URLSearchParams({ path, project: slug })
      await fetch(`/api/files?${params}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      await refresh()
    } catch {}
  }, [token, slug, refresh])

  // Rename submit
  const handleRenameSubmit = useCallback(async (oldPath, newName) => {
    setRenaming(null)
    if (!newName?.trim() || !oldPath) return
    const parts = oldPath.split('/')
    parts[parts.length - 1] = newName.trim()
    const newPath = parts.join('/')
    if (newPath === oldPath) return

    try {
      await fetch('/api/files/rename', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ oldPath, newPath, project: slug }),
      })
      await refresh()
    } catch {}
  }, [token, slug, refresh])

  // New file/folder submit
  const handleNewItemSubmit = useCallback(async (name) => {
    if (!newItem || !name?.trim()) {
      setNewItem(null)
      return
    }
    const parentPath = newItem.parentPath
    const fullPath = parentPath ? `${parentPath}/${name.trim()}` : name.trim()

    try {
      if (newItem.type === 'directory') {
        await fetch('/api/files/mkdir', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ path: fullPath, project: slug }),
        })
      } else {
        await fetch('/api/files/write', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ path: fullPath, content: '', project: slug }),
        })
      }
      setNewItem(null)
      await refresh()
      // Expand the parent dir if it's not root
      if (parentPath) {
        setExpandedDirs((prev) => {
          const next = new Set(prev)
          next.add(parentPath)
          return next
        })
        await loadChildren(parentPath)
      }
    } catch {
      setNewItem(null)
    }
  }, [newItem, token, slug, refresh, loadChildren])

  // Double-click: copy path to clipboard or insert into terminal
  const handleDoubleClick = useCallback((path) => {
    if (onInsertPath) {
      onInsertPath(path)
    } else {
      handleCopyPath(path)
    }
  }, [onInsertPath, handleCopyPath])

  // Open terminal here
  const handleOpenTerminalHere = useCallback((dirPath) => {
    setContextMenu(null)
    if (onOpenTerminalHere) onOpenTerminalHere(dirPath)
  }, [onOpenTerminalHere])

  if (collapsed) {
    return (
      <aside
        data-testid="file-explorer"
        className="w-8 bg-base02 border-r border-base01/30 flex flex-col shrink-0"
      >
        <button
          data-testid="file-explorer-toggle"
          onClick={onToggle}
          className="p-2 text-base01 hover:text-base0 transition-colors text-xs"
          title="Show file explorer"
        >
          {'\u{1F4C1}'}
        </button>
      </aside>
    )
  }

  return (
    <aside
      data-testid="file-explorer"
      className="w-56 bg-base02 border-r border-base01/30 flex flex-col shrink-0 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center px-2 py-1.5 border-b border-base01/30">
        <h2 className="text-xs font-semibold text-base01 uppercase tracking-wider flex-1">Files</h2>
        <div className="flex gap-1">
          <button
            data-testid="file-explorer-refresh"
            onClick={refresh}
            className="text-base01 hover:text-base0 text-xs transition-colors"
            title="Refresh"
          >
            {'\u21BB'}
          </button>
          <button
            data-testid="file-explorer-toggle"
            onClick={onToggle}
            className="text-base01 hover:text-base0 text-xs transition-colors"
            title="Hide file explorer"
          >
            {'\u25C0'}
          </button>
        </div>
      </div>

      {/* Toggles */}
      <div className="flex gap-2 px-2 py-1 border-b border-base01/30">
        <label className="flex items-center gap-1 text-[10px] text-base01 cursor-pointer">
          <input
            data-testid="toggle-hidden"
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
            className="w-3 h-3"
          />
          Hidden
        </label>
        <label className="flex items-center gap-1 text-[10px] text-base01 cursor-pointer">
          <input
            data-testid="toggle-ignored"
            type="checkbox"
            checked={showIgnored}
            onChange={(e) => setShowIgnored(e.target.checked)}
            className="w-3 h-3"
          />
          Ignored
        </label>
      </div>

      {/* Tree view */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1" data-testid="file-tree">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <span className="text-xs text-base01">Loading...</span>
          </div>
        ) : rootEntries.length === 0 ? (
          <div className="px-2 py-2 text-xs text-base01 italic">Empty directory</div>
        ) : (
          <>
            {rootEntries.map((entry) => (
              <TreeNode
                key={entry.name}
                entry={entry}
                path=""
                depth={0}
                token={token}
                slug={slug}
                onContextMenu={handleContextMenu}
                expandedDirs={expandedDirs}
                toggleDir={toggleDir}
                loadChildren={loadChildren}
                children={children}
                showHidden={showHidden}
                showIgnored={showIgnored}
                onDragStart={() => {}}
                onDoubleClick={handleDoubleClick}
                renaming={renaming}
                renameRef={renameRef}
                onRenameSubmit={handleRenameSubmit}
                onRenameCancel={() => setRenaming(null)}
                newItem={newItem}
                newItemRef={newItemRef}
                onNewItemSubmit={handleNewItemSubmit}
                onNewItemCancel={() => setNewItem(null)}
              />
            ))}
            {/* New item input at root level */}
            {newItem && !newItem.parentPath && (
              <div className="flex items-center px-2 py-0.5" style={{ paddingLeft: '8px' }}>
                <span className="mr-1 text-[11px]">{newItem.type === 'directory' ? '\u{1F4C1}' : '\u{1F4C3}'}</span>
                <input
                  ref={newItemRef}
                  data-testid="new-item-input"
                  className="flex-1 min-w-0 bg-base03 text-base1 text-xs px-1 py-0.5 rounded border border-blue/50 outline-none"
                  placeholder={newItem.type === 'directory' ? 'New folder name...' : 'New file name...'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleNewItemSubmit(e.target.value)
                    if (e.key === 'Escape') setNewItem(null)
                  }}
                  onBlur={(e) => handleNewItemSubmit(e.target.value)}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          data-testid="file-context-menu"
          className="fixed z-50 min-w-40 bg-base02 border border-base01/30 rounded shadow-lg py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.type === 'directory' && (
            <>
              <button
                data-testid="ctx-new-file"
                className="w-full text-left px-3 py-1.5 text-xs text-base0 hover:bg-base03/50 hover:text-base1 transition-colors"
                onClick={() => {
                  setNewItem({ parentPath: contextMenu.path, type: 'file' })
                  setContextMenu(null)
                  // Expand the directory
                  setExpandedDirs((prev) => new Set([...prev, contextMenu.path]))
                  if (!children[contextMenu.path]) loadChildren(contextMenu.path)
                }}
              >
                New File
              </button>
              <button
                data-testid="ctx-new-folder"
                className="w-full text-left px-3 py-1.5 text-xs text-base0 hover:bg-base03/50 hover:text-base1 transition-colors"
                onClick={() => {
                  setNewItem({ parentPath: contextMenu.path, type: 'directory' })
                  setContextMenu(null)
                  setExpandedDirs((prev) => new Set([...prev, contextMenu.path]))
                  if (!children[contextMenu.path]) loadChildren(contextMenu.path)
                }}
              >
                New Folder
              </button>
              <button
                data-testid="ctx-open-terminal"
                className="w-full text-left px-3 py-1.5 text-xs text-base0 hover:bg-base03/50 hover:text-base1 transition-colors"
                onClick={() => handleOpenTerminalHere(contextMenu.path)}
              >
                Open Terminal Here
              </button>
              <div className="border-t border-base01/30 my-1" />
            </>
          )}
          <button
            data-testid="ctx-copy-path"
            className="w-full text-left px-3 py-1.5 text-xs text-base0 hover:bg-base03/50 hover:text-base1 transition-colors"
            onClick={() => handleCopyPath(contextMenu.path)}
          >
            Copy Path
          </button>
          <button
            data-testid="ctx-rename"
            className="w-full text-left px-3 py-1.5 text-xs text-base0 hover:bg-base03/50 hover:text-base1 transition-colors"
            onClick={() => {
              const name = contextMenu.path.split('/').pop()
              setRenaming({ path: contextMenu.path, name })
              setContextMenu(null)
            }}
          >
            Rename
          </button>
          <div className="border-t border-base01/30 my-1" />
          <button
            data-testid="ctx-delete"
            className="w-full text-left px-3 py-1.5 text-xs text-red/80 hover:bg-base03/50 hover:text-red transition-colors"
            onClick={() => handleDelete(contextMenu.path)}
          >
            Delete
          </button>
        </div>
      )}

    </aside>
  )
}
