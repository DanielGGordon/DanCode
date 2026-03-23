import { useState, useEffect } from 'react'

export default function NewProjectForm({ token, onCreated, onCancel }) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('~/')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [adoptMode, setAdoptMode] = useState(false)
  const [orphanedSessions, setOrphanedSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [selectedSession, setSelectedSession] = useState('')

  useEffect(() => {
    let cancelled = false
    async function fetchSessions() {
      try {
        const res = await fetch('/api/tmux/sessions', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok && !cancelled) {
          const data = await res.json()
          setOrphanedSessions(data)
        }
      } catch {
        // silently ignore — toggle will show as disabled
      } finally {
        if (!cancelled) setSessionsLoading(false)
      }
    }
    fetchSessions()
    return () => { cancelled = true }
  }, [token])

  function handleAdoptToggle() {
    if (orphanedSessions.length === 0) return
    setAdoptMode((prev) => {
      if (prev) setSelectedSession('')
      return !prev
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmedName = name.trim()
    const trimmedPath = path.trim()

    if (!trimmedName) {
      setError('Project name is required')
      return
    }
    if (!adoptMode && !trimmedPath) {
      setError('Project path is required')
      return
    }
    if (adoptMode && !selectedSession) {
      setError('Please select a tmux session to adopt')
      return
    }

    setError('')
    setSubmitting(true)

    const body = { name: trimmedName, path: trimmedPath }
    if (adoptMode) {
      body.adoptSession = selectedSession
    }

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to create project')
        setSubmitting(false)
        return
      }

      onCreated(data)
    } catch {
      setError('Unable to reach server')
      setSubmitting(false)
    }
  }

  const hasOrphanedSessions = orphanedSessions.length > 0

  return (
    <div className="w-full h-full flex items-center justify-center bg-base03">
      <form
        onSubmit={handleSubmit}
        data-testid="new-project-form"
        className="flex flex-col gap-4 p-8 rounded-lg bg-base02 border border-base01/30 shadow-lg w-full max-w-md"
      >
        <h2 className="text-xl font-semibold text-base1 text-center">New Project</h2>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-base0">Project Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Project"
            data-testid="project-name-input"
            className="px-3 py-2 rounded bg-base03 border border-base01/50 text-base0 placeholder-base01 focus:outline-none focus:border-blue"
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={adoptMode}
            disabled={!hasOrphanedSessions}
            onClick={handleAdoptToggle}
            data-testid="adopt-session-toggle"
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
              adoptMode ? 'bg-blue' : 'bg-base01/50'
            } ${!hasOrphanedSessions ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-base3 shadow transform transition-transform ${
                adoptMode ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
          <span className="text-sm text-base0">
            Adopt existing tmux session
          </span>
          {!sessionsLoading && !hasOrphanedSessions && (
            <span data-testid="no-sessions-available" className="text-xs text-base01 italic">
              No sessions available
            </span>
          )}
        </div>

        {adoptMode && hasOrphanedSessions && (
          <label className="flex flex-col gap-1">
            <span className="text-sm text-base0">Tmux Session</span>
            <select
              value={selectedSession}
              onChange={(e) => setSelectedSession(e.target.value)}
              data-testid="adopt-session-select"
              className="px-3 py-2 rounded bg-base03 border border-base01/50 text-base0 focus:outline-none focus:border-blue"
            >
              <option value="">Select a session...</option>
              {orphanedSessions.map((s) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
          </label>
        )}

        {!adoptMode && (
          <label className="flex flex-col gap-1">
            <span className="text-sm text-base0">Directory Path</span>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="~/projects/my-project"
              data-testid="project-path-input"
              className="px-3 py-2 rounded bg-base03 border border-base01/50 text-base0 placeholder-base01 focus:outline-none focus:border-blue"
            />
          </label>
        )}

        {error && (
          <p data-testid="new-project-error" className="text-sm text-red text-center">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            data-testid="new-project-cancel"
            className="flex-1 px-4 py-2 rounded border border-base01/50 text-base0 hover:bg-base03 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            data-testid="new-project-submit"
            className="flex-1 px-4 py-2 rounded bg-blue text-base3 font-medium hover:bg-blue/80 transition-colors disabled:opacity-50"
          >
            {submitting ? 'Creating...' : adoptMode ? 'Adopt Session' : 'Create Project'}
          </button>
        </div>
      </form>
    </div>
  )
}
