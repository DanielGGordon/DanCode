import Terminal from './Terminal.jsx'

export const ALL_PANES = [
  { index: 0, label: 'CLI' },
  { index: 1, label: 'Claude' },
  { index: 2, label: 'Ralph' },
]

export default function PaneLayout({ token, slug, panes = ALL_PANES }) {
  return (
    <div data-testid="pane-layout" className="flex flex-row w-full h-full">
      {panes.map(({ index, label }) => (
        <div
          key={index}
          data-testid={`pane-${index}`}
          className="flex-1 min-w-0 flex flex-col border-r border-base01/30 last:border-r-0"
        >
          <div className="px-3 py-1 text-xs font-medium text-base01 bg-base02 border-b border-base01/30 select-none">
            {label}
          </div>
          <div className="flex-1 min-h-0">
            <Terminal token={token} slug={slug} pane={index} />
          </div>
        </div>
      ))}
    </div>
  )
}
