import { useEffect } from 'react'

const SHORTCUTS = [
  { keys: ['Ctrl/Cmd', 'K'], desc: 'Open the command palette (jump to any project)' },
  { keys: ['Alt', '→'], desc: 'Switch to the next project' },
  { keys: ['Alt', '←'], desc: 'Switch to the previous project' },
  { keys: ['Shift', '?'], desc: 'Open this help dialog' },
  { keys: ['Esc'], desc: 'Close palettes, menus, and this dialog' },
  { keys: ['Tab'], desc: 'In the new-project path field, complete the directory name' },
  { keys: ['↑', '/', '↓'], desc: 'In the path field, move through directory suggestions' },
]

function Key({ children }) {
  return (
    <kbd className="px-1.5 py-0.5 text-xs font-mono text-base1 bg-base03 border border-base01/40 rounded shadow-sm">
      {children}
    </kbd>
  )
}

export default function HelpModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      data-testid="help-modal-backdrop"
      className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        data-testid="help-modal"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-base02 border border-base01/30 rounded-lg shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-base01/30">
          <h2 className="text-sm font-semibold text-base1">Keyboard Shortcuts</h2>
          <button
            data-testid="help-modal-close"
            onClick={onClose}
            className="text-base01 hover:text-base0 text-lg leading-none"
            aria-label="Close help"
          >
            {'×'}
          </button>
        </div>
        <ul className="py-2">
          {SHORTCUTS.map(({ keys, desc }, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-4 px-4 py-1.5 text-sm text-base0"
            >
              <span className="flex-1">{desc}</span>
              <span className="flex items-center gap-1 shrink-0">
                {keys.map((k, j) => (
                  <span key={j} className="flex items-center gap-1">
                    {j > 0 && k !== '/' && <span className="text-base01">+</span>}
                    {k === '/' ? <span className="text-base01">/</span> : <Key>{k}</Key>}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <div className="px-4 py-2 border-t border-base01/30 text-[11px] text-base01">
          Press <Key>Esc</Key> to close.
        </div>
      </div>
    </div>
  )
}
