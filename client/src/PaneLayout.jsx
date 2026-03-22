import { useState, useCallback } from 'react'
import Terminal from './Terminal.jsx'

export const ALL_PANES = [
  { index: 0, label: 'CLI' },
  { index: 1, label: 'Claude' },
  { index: 2, label: 'Ralph' },
]

export default function PaneLayout({ token, slug, panes = ALL_PANES }) {
  const [focusedPane, setFocusedPane] = useState(0)

  const handlePaneClick = useCallback((index) => {
    setFocusedPane(index)
  }, [])

  return (
    <div data-testid="pane-layout" className="flex flex-row w-full h-full">
      {panes.map(({ index, label }) => {
        const isFocused = focusedPane === index
        return (
          <div
            key={index}
            data-testid={`pane-${index}`}
            className={`flex-1 min-w-0 flex flex-col border-r last:border-r-0 ${
              isFocused ? 'border-blue/50' : 'border-base01/30'
            }`}
            onClick={() => handlePaneClick(index)}
          >
            <div
              className={`px-3 py-1 text-xs font-medium border-b select-none ${
                isFocused
                  ? 'text-base1 bg-base02 border-blue/50'
                  : 'text-base01 bg-base02 border-base01/30'
              }`}
            >
              {label}
            </div>
            <div className="flex-1 min-h-0">
              <Terminal
                token={token}
                slug={slug}
                pane={index}
                focused={isFocused}
                onFocus={() => setFocusedPane(index)}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
