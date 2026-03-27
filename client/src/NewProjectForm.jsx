import { useState } from 'react'

export default function NewProjectForm({ token, onCreated, onCancel }) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('~/')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmedName = name.trim()
    const trimmedPath = path.trim()

    if (!trimmedName) {
      setError('Project name is required')
      return
    }
    if (!trimmedPath) {
      setError('Project path is required')
      return
    }

    setError('')
    setSubmitting(true)

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: trimmedName, path: trimmedPath }),
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
            {submitting ? 'Creating...' : 'Create Project'}
          </button>
        </div>
      </form>
    </div>
  )
}
