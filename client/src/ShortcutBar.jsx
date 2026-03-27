/**
 * ShortcutBar — horizontal scrolling bar of common terminal key shortcuts.
 * Appears above the soft keyboard on mobile when the terminal is in input mode.
 *
 * Each button is a minimum 44px tap target (iOS/Android accessibility guideline).
 * Tapping a button sends the corresponding key sequence to the terminal via onSend.
 */

const SHORTCUTS = [
  { label: 'Ctrl+C', seq: '\x03' },
  { label: 'Ctrl+V', seq: null, action: 'paste' },
  { label: 'Ctrl+D', seq: '\x04' },
  { label: 'Tab', seq: '\t' },
  { label: '\u2191', seq: '\x1b[A' },
  { label: '\u2193', seq: '\x1b[B' },
  { label: 'Esc', seq: '\x1b' },
]

export default function ShortcutBar({ onSend, onPaste }) {
  const handleTap = (shortcut) => {
    if (shortcut.action === 'paste') {
      if (onPaste) onPaste()
      return
    }
    if (shortcut.seq && onSend) {
      onSend(shortcut.seq)
    }
  }

  return (
    <div
      data-testid="shortcut-bar"
      className="flex items-center gap-1.5 px-2 py-1.5 bg-base02 border-t border-base01/30 overflow-x-auto"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      {SHORTCUTS.map((s) => (
        <button
          key={s.label}
          data-testid={`shortcut-${s.label.toLowerCase().replace(/[+\u2191\u2193]/g, (m) => {
            if (m === '+') return '-'
            if (m === '\u2191') return 'up'
            if (m === '\u2193') return 'down'
            return m
          })}`}
          onClick={() => handleTap(s)}
          className="shrink-0 px-3 py-2 text-xs font-medium text-base1 bg-base03 border border-base01/40 rounded-md active:bg-blue/20 active:border-blue/50 transition-colors select-none"
          style={{ minWidth: '44px', minHeight: '44px', touchAction: 'manipulation' }}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}
