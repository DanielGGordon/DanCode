import { useState, useCallback, useEffect } from 'react'
import Terminal from './Terminal.jsx'

export const ALL_PANES = [
  { index: 0, label: 'CLI' },
  { index: 1, label: 'Claude' },
  { index: 2, label: 'Ralph' },
]

export const MOBILE_BREAKPOINT = 768

export default function PaneLayout({ token, slug, panes = ALL_PANES }) {
  const [focusedPane, setFocusedPane] = useState(0)
  const [layoutMode, setLayoutMode] = useState('split')
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
  )

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = (e) => setIsMobile(e.matches)
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange)
    } else {
      mql.addListener(onChange)
    }
    setIsMobile(mql.matches)
    return () => {
      if (mql.removeEventListener) {
        mql.removeEventListener('change', onChange)
      } else {
        mql.removeListener(onChange)
      }
    }
  }, [])

  const effectiveLayout = isMobile ? 'tabs' : layoutMode

  const handlePaneClick = useCallback((index) => {
    setFocusedPane(index)
  }, [])

  const toggleLayout = useCallback(() => {
    setLayoutMode((prev) => (prev === 'split' ? 'tabs' : 'split'))
  }, [])

  return (
    <div data-testid="pane-layout" className="flex flex-col w-full h-full">
      {/* Layout toolbar */}
      <div className="flex items-center px-2 py-1 bg-base02 border-b border-base01/30">
        {effectiveLayout === 'tabs' && (
          <div className="flex gap-1 mr-2" data-testid="tab-bar">
            {panes.map(({ index, label }) => {
              const isActive = focusedPane === index
              return (
                <button
                  key={index}
                  data-testid={`tab-${index}`}
                  onClick={() => setFocusedPane(index)}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    isActive
                      ? 'text-base1 bg-base03 border border-blue/50'
                      : 'text-base01 bg-base02 border border-base01/30 hover:text-base0'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        )}
        {!isMobile && (
          <button
            data-testid="layout-toggle"
            onClick={toggleLayout}
            className="ml-auto px-2 py-1 text-xs text-base01 hover:text-base0 border border-base01/30 rounded transition-colors"
          >
            {layoutMode === 'split' ? 'Tabs' : 'Split'}
          </button>
        )}
      </div>

      {/* Pane content */}
      {effectiveLayout === 'split' ? (
        <div className="flex flex-row flex-1 min-h-0">
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
      ) : (
        <div className="flex-1 min-h-0 flex flex-col" data-testid="tabbed-content">
          {panes.map(({ index, label }) => {
            const isActive = focusedPane === index
            return (
              <div
                key={index}
                data-testid={`pane-${index}`}
                className={`flex-1 min-h-0 flex flex-col ${isActive ? '' : 'hidden'}`}
              >
                <Terminal
                  token={token}
                  slug={slug}
                  pane={index}
                  focused={isActive}
                  onFocus={() => setFocusedPane(index)}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
