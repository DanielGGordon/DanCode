export default function Sidebar({ projects, currentSlug, onSelect, tmuxStatus, collapsed, onToggle }) {
  return (
    <aside
      data-testid="sidebar"
      className={`${collapsed ? 'w-10' : 'w-52'} bg-base02 border-r border-base01/30 flex flex-col shrink-0 overflow-y-auto transition-all duration-150`}
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
          {collapsed ? '▶' : '◀'}
        </button>
      </div>
      {!collapsed && <ul data-testid="sidebar-project-list" className="py-1">
        {(!projects || projects.length === 0) && (
          <li data-testid="sidebar-empty" className="px-3 py-2 text-xs text-base01">
            No projects yet
          </li>
        )}
        {(projects || []).map((p) => {
          const status = tmuxStatus?.[p.slug]
          const dotClass = status === true
            ? 'bg-green'
            : status === false
              ? 'bg-base01/40'
              : 'bg-base01/20 animate-pulse'
          const dotTitle = status === true
            ? 'tmux session running'
            : status === false
              ? 'no tmux session'
              : 'checking status…'
          return (
            <li
              key={p.slug}
              data-testid={`sidebar-project-${p.slug}`}
              className={`px-3 py-2 text-sm cursor-pointer transition-colors flex items-center gap-2 ${
                p.slug === currentSlug
                  ? 'text-base1 bg-base03/70 border-l-2 border-blue'
                  : 'text-base0 hover:bg-base03/30 border-l-2 border-transparent'
              }`}
              onClick={() => onSelect?.(p.slug)}
            >
              <span
                data-testid={`sidebar-status-${p.slug}`}
                className={`inline-block w-2 h-2 rounded-full shrink-0 ${dotClass}`}
                title={dotTitle}
              />
              {p.name}
            </li>
          )
        })}
      </ul>}
    </aside>
  )
}
