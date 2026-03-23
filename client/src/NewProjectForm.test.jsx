import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react'
import NewProjectForm from './NewProjectForm.jsx'

beforeEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
})

function mockFetch(status, body = {}) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })
}

/**
 * Mock fetch to handle multiple routes: /api/tmux/sessions returns
 * the given sessions array, and all other calls use the provided status/body.
 */
function mockFetchWithSessions(sessions, status, body = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (url === '/api/tmux/sessions') {
      return { ok: true, status: 200, json: () => Promise.resolve(sessions) }
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }
  })
}

describe('NewProjectForm', () => {
  it('renders name and path inputs with path pre-filled to ~/', async () => {
    mockFetch(200, [])
    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )
    expect(getByTestId('project-name-input')).toBeDefined()
    expect(getByTestId('project-path-input').value).toBe('~/')
  })

  it('renders submit and cancel buttons', () => {
    mockFetch(200, [])
    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )
    expect(getByTestId('new-project-submit')).toBeDefined()
    expect(getByTestId('new-project-cancel')).toBeDefined()
  })

  it('does not show error initially', () => {
    mockFetch(200, [])
    const { queryByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )
    expect(queryByTestId('new-project-error')).toBeNull()
  })

  it('shows error when name is empty on submit', () => {
    mockFetch(200, [])
    const { getByTestId, queryByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )
    fireEvent.click(getByTestId('new-project-submit'))
    expect(getByTestId('new-project-error').textContent).toBe('Project name is required')
  })

  it('shows error when path is empty on submit', () => {
    mockFetch(200, [])
    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )
    fireEvent.change(getByTestId('project-name-input'), { target: { value: 'My Project' } })
    fireEvent.change(getByTestId('project-path-input'), { target: { value: '  ' } })
    fireEvent.click(getByTestId('new-project-submit'))
    expect(getByTestId('new-project-error').textContent).toBe('Project path is required')
  })

  it('calls onCancel when cancel button is clicked', () => {
    mockFetch(200, [])
    const onCancel = vi.fn()
    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={onCancel} />
    )
    fireEvent.click(getByTestId('new-project-cancel'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('submits with correct payload and calls onCreated on success', async () => {
    const project = { name: 'Test', slug: 'test', path: '/home/user/test' }
    const fetchSpy = mockFetchWithSessions([], 201, project)
    const onCreated = vi.fn()

    const { getByTestId } = render(
      <NewProjectForm token="my-token" onCreated={onCreated} onCancel={() => {}} />
    )

    fireEvent.change(getByTestId('project-name-input'), { target: { value: 'Test' } })
    fireEvent.change(getByTestId('project-path-input'), { target: { value: '~/test' } })
    fireEvent.click(getByTestId('new-project-submit'))

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(project)
    })

    // Find the POST call (not the sessions GET)
    const postCall = fetchSpy.mock.calls.find(
      (c) => c[0] === '/api/projects' && c[1]?.method === 'POST'
    )
    expect(postCall).toBeDefined()
    expect(postCall[1].headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer my-token',
    })
    expect(JSON.parse(postCall[1].body)).toEqual({ name: 'Test', path: '~/test' })
  })

  it('shows server error on 409 conflict', async () => {
    mockFetchWithSessions([], 409, { error: 'A project with the name "Test" already exists' })
    const onCreated = vi.fn()

    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={onCreated} onCancel={() => {}} />
    )

    fireEvent.change(getByTestId('project-name-input'), { target: { value: 'Test' } })
    fireEvent.click(getByTestId('new-project-submit'))

    await waitFor(() => {
      expect(getByTestId('new-project-error').textContent).toBe(
        'A project with the name "Test" already exists'
      )
    })
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('shows generic error on 400 response', async () => {
    mockFetchWithSessions([], 400, { error: 'Project name is required' })
    const onCreated = vi.fn()

    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={onCreated} onCancel={() => {}} />
    )

    fireEvent.change(getByTestId('project-name-input'), { target: { value: 'Test' } })
    fireEvent.click(getByTestId('new-project-submit'))

    await waitFor(() => {
      expect(getByTestId('new-project-error').textContent).toBe('Project name is required')
    })
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('shows network error when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))
    const onCreated = vi.fn()

    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={onCreated} onCancel={() => {}} />
    )

    fireEvent.change(getByTestId('project-name-input'), { target: { value: 'Test' } })
    fireEvent.click(getByTestId('new-project-submit'))

    await waitFor(() => {
      expect(getByTestId('new-project-error').textContent).toBe('Unable to reach server')
    })
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('disables submit button while submitting', async () => {
    // First call is sessions fetch, second is the POST
    let resolvePromise
    let callCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/tmux/sessions') {
        return { ok: true, status: 200, json: () => Promise.resolve([]) }
      }
      callCount++
      return new Promise((resolve) => { resolvePromise = resolve })
    })

    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )

    fireEvent.change(getByTestId('project-name-input'), { target: { value: 'Test' } })
    fireEvent.click(getByTestId('new-project-submit'))

    await waitFor(() => expect(callCount).toBe(1))

    expect(getByTestId('new-project-submit').disabled).toBe(true)
    expect(getByTestId('new-project-submit').textContent).toBe('Creating...')

    // Resolve to clean up
    resolvePromise({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ name: 'Test', slug: 'test', path: '/test' }),
    })
  })

  it('trims name and path before submitting', async () => {
    const project = { name: 'Test', slug: 'test', path: '/home/user/test' }
    const fetchSpy = mockFetchWithSessions([], 201, project)
    const onCreated = vi.fn()

    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={onCreated} onCancel={() => {}} />
    )

    fireEvent.change(getByTestId('project-name-input'), { target: { value: '  Test  ' } })
    fireEvent.change(getByTestId('project-path-input'), { target: { value: '  ~/test  ' } })
    fireEvent.click(getByTestId('new-project-submit'))

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled()
    })

    const postCall = fetchSpy.mock.calls.find(
      (c) => c[0] === '/api/projects' && c[1]?.method === 'POST'
    )
    expect(JSON.parse(postCall[1].body)).toEqual({ name: 'Test', path: '~/test' })
  })
})

describe('NewProjectForm – adopt session toggle', () => {
  it('renders the adopt session toggle', async () => {
    mockFetch(200, [])
    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )
    await waitFor(() => {
      expect(getByTestId('adopt-session-toggle')).toBeDefined()
    })
  })

  it('toggle is disabled when no orphaned sessions exist', async () => {
    mockFetch(200, [])
    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )
    await waitFor(() => {
      expect(getByTestId('adopt-session-toggle').disabled).toBe(true)
    })
    expect(getByTestId('no-sessions-available')).toBeDefined()
    expect(getByTestId('no-sessions-available').textContent).toBe('No sessions available')
  })

  it('toggle is enabled when orphaned sessions exist', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/tmux/sessions') {
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ name: 'my-session' }]),
        }
      }
      return { ok: true, status: 200, json: () => Promise.resolve([]) }
    })

    const { getByTestId, queryByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )
    await waitFor(() => {
      expect(getByTestId('adopt-session-toggle').disabled).toBe(false)
    })
    expect(queryByTestId('no-sessions-available')).toBeNull()
  })

  it('toggling on shows session dropdown and hides path input', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/tmux/sessions') {
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ name: 'my-session' }, { name: 'other-session' }]),
        }
      }
      return { ok: true, status: 200, json: () => Promise.resolve([]) }
    })

    const { getByTestId, queryByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )

    await waitFor(() => {
      expect(getByTestId('adopt-session-toggle').disabled).toBe(false)
    })

    // Path input visible, no dropdown
    expect(getByTestId('project-path-input')).toBeDefined()
    expect(queryByTestId('adopt-session-select')).toBeNull()

    // Toggle adopt mode on
    fireEvent.click(getByTestId('adopt-session-toggle'))

    // Dropdown appears, path input hidden
    expect(getByTestId('adopt-session-select')).toBeDefined()
    expect(queryByTestId('project-path-input')).toBeNull()

    // Dropdown has the sessions
    const select = getByTestId('adopt-session-select')
    expect(select.options.length).toBe(3) // "Select a session..." + 2 sessions
    expect(select.options[1].value).toBe('my-session')
    expect(select.options[2].value).toBe('other-session')
  })

  it('toggling off hides dropdown and shows path input again', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/tmux/sessions') {
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ name: 'my-session' }]),
        }
      }
      return { ok: true, status: 200, json: () => Promise.resolve([]) }
    })

    const { getByTestId, queryByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )

    await waitFor(() => {
      expect(getByTestId('adopt-session-toggle').disabled).toBe(false)
    })

    fireEvent.click(getByTestId('adopt-session-toggle'))
    expect(getByTestId('adopt-session-select')).toBeDefined()

    fireEvent.click(getByTestId('adopt-session-toggle'))
    expect(queryByTestId('adopt-session-select')).toBeNull()
    expect(getByTestId('project-path-input')).toBeDefined()
  })

  it('shows error when submitting in adopt mode without selecting a session', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/tmux/sessions') {
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ name: 'my-session' }]),
        }
      }
      return { ok: true, status: 200, json: () => Promise.resolve([]) }
    })

    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )

    await waitFor(() => {
      expect(getByTestId('adopt-session-toggle').disabled).toBe(false)
    })

    fireEvent.click(getByTestId('adopt-session-toggle'))
    fireEvent.change(getByTestId('project-name-input'), { target: { value: 'Test' } })
    fireEvent.click(getByTestId('new-project-submit'))

    expect(getByTestId('new-project-error').textContent).toBe(
      'Please select a tmux session to adopt'
    )
  })

  it('submits with adoptSession in payload when in adopt mode', async () => {
    const project = { name: 'Test', slug: 'test', path: '/home/user' }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      if (url === '/api/tmux/sessions') {
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ name: 'my-session' }]),
        }
      }
      return { ok: true, status: 201, json: () => Promise.resolve(project) }
    })
    const onCreated = vi.fn()

    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={onCreated} onCancel={() => {}} />
    )

    await waitFor(() => {
      expect(getByTestId('adopt-session-toggle').disabled).toBe(false)
    })

    fireEvent.click(getByTestId('adopt-session-toggle'))
    fireEvent.change(getByTestId('project-name-input'), { target: { value: 'Test' } })
    fireEvent.change(getByTestId('adopt-session-select'), { target: { value: 'my-session' } })
    fireEvent.click(getByTestId('new-project-submit'))

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(project)
    })

    const postCall = fetchSpy.mock.calls.find(
      (c) => c[0] === '/api/projects' && c[1]?.method === 'POST'
    )
    expect(postCall).toBeDefined()
    const body = JSON.parse(postCall[1].body)
    expect(body.adoptSession).toBe('my-session')
    expect(body.name).toBe('Test')
  })

  it('submit button text changes to "Adopt Session" in adopt mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/tmux/sessions') {
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ name: 'my-session' }]),
        }
      }
      return { ok: true, status: 200, json: () => Promise.resolve([]) }
    })

    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )

    expect(getByTestId('new-project-submit').textContent).toBe('Create Project')

    await waitFor(() => {
      expect(getByTestId('adopt-session-toggle').disabled).toBe(false)
    })

    fireEvent.click(getByTestId('adopt-session-toggle'))
    expect(getByTestId('new-project-submit').textContent).toBe('Adopt Session')
  })

  it('toggle has correct aria-checked attribute', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/tmux/sessions') {
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ name: 'my-session' }]),
        }
      }
      return { ok: true, status: 200, json: () => Promise.resolve([]) }
    })

    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )

    await waitFor(() => {
      expect(getByTestId('adopt-session-toggle').disabled).toBe(false)
    })

    expect(getByTestId('adopt-session-toggle').getAttribute('aria-checked')).toBe('false')
    fireEvent.click(getByTestId('adopt-session-toggle'))
    expect(getByTestId('adopt-session-toggle').getAttribute('aria-checked')).toBe('true')
  })

  it('clears selected session when toggling adopt mode off', async () => {
    const project = { name: 'Test', slug: 'test', path: '/home/user' }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (url === '/api/tmux/sessions') {
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ name: 'my-session' }]),
        }
      }
      return { ok: true, status: 201, json: () => Promise.resolve(project) }
    })

    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )

    await waitFor(() => {
      expect(getByTestId('adopt-session-toggle').disabled).toBe(false)
    })

    // Toggle on, select a session, toggle off, toggle on again — selection should be cleared
    fireEvent.click(getByTestId('adopt-session-toggle'))
    fireEvent.change(getByTestId('adopt-session-select'), { target: { value: 'my-session' } })
    expect(getByTestId('adopt-session-select').value).toBe('my-session')

    fireEvent.click(getByTestId('adopt-session-toggle'))
    fireEvent.click(getByTestId('adopt-session-toggle'))
    expect(getByTestId('adopt-session-select').value).toBe('')
  })

  it('fetches sessions with auth token on mount', async () => {
    const fetchSpy = mockFetch(200, [])

    render(
      <NewProjectForm token="my-token" onCreated={() => {}} onCancel={() => {}} />
    )

    await waitFor(() => {
      const sessionsCall = fetchSpy.mock.calls.find((c) => c[0] === '/api/tmux/sessions')
      expect(sessionsCall).toBeDefined()
      expect(sessionsCall[1].headers.Authorization).toBe('Bearer my-token')
    })
  })
})
