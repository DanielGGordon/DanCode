export default function Sidebar({ projects, currentSlug, onSelect }) {
  return (
    <aside
      data-testid="sidebar"
      className="w-52 bg-base02 border-r border-base01/30 flex flex-col shrink-0 overflow-y-auto"
    >
      <div className="px-3 py-2 border-b border-base01/30">
        <h2 className="text-xs font-semibold text-base01 uppercase tracking-wider">Projects</h2>
      </div>
      <ul data-testid="sidebar-project-list" className="py-1">
        {(!projects || projects.length === 0) && (
          <li data-testid="sidebar-empty" className="px-3 py-2 text-xs text-base01">
            No projects yet
          </li>
        )}
        {(projects || []).map((p) => (
          <li
            key={p.slug}
            data-testid={`sidebar-project-${p.slug}`}
            className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
              p.slug === currentSlug
                ? 'text-base1 bg-base03/70 border-l-2 border-blue'
                : 'text-base0 hover:bg-base03/30 border-l-2 border-transparent'
            }`}
            onClick={() => onSelect?.(p.slug)}
          >
            {p.name}
          </li>
        ))}
      </ul>
    </aside>
  )
}
