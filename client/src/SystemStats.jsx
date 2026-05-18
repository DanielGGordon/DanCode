import { useEffect, useState } from 'react'

/**
 * Map a 0–100 percent value to a color along a green → yellow → red ramp.
 * Red kicks in at >= 80% as requested.
 */
function colorFor(pct) {
  if (pct >= 80) return '#dc322f'   // solarized red
  if (pct >= 60) return '#cb4b16'   // orange
  if (pct >= 40) return '#b58900'   // yellow
  return '#859900'                  // green
}

function Bar({ label, pct }) {
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-base01 font-mono">
      <span className="w-7 shrink-0 uppercase">{label}</span>
      <div className="flex-1 h-1.5 bg-base03 rounded-sm overflow-hidden">
        <div
          className="h-full transition-[width,background-color] duration-500"
          style={{ width: `${clamped}%`, backgroundColor: colorFor(clamped) }}
        />
      </div>
      <span className="w-8 shrink-0 text-right tabular-nums" style={{ color: colorFor(clamped) }}>
        {Math.round(clamped)}%
      </span>
    </div>
  )
}

export default function SystemStats({ token, intervalMs = 7000 }) {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false

    async function refresh() {
      try {
        const res = await fetch('/api/system/stats', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setStats(data)
      } catch {}
    }

    refresh()
    const id = setInterval(refresh, intervalMs)
    return () => { cancelled = true; clearInterval(id) }
  }, [token, intervalMs])

  return (
    <div data-testid="system-stats" className="px-2 py-1.5 border-t border-base01/30 flex flex-col gap-1">
      <Bar label="CPU" pct={stats?.cpuPercent ?? 0} />
      <Bar label="MEM" pct={stats?.memPercent ?? 0} />
    </div>
  )
}
