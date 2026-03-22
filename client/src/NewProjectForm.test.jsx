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

describe('NewProjectForm', () => {
  it('renders name and path inputs with path pre-filled to ~/', () => {
    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )
    expect(getByTestId('project-name-input')).toBeDefined()
    expect(getByTestId('project-path-input').value).toBe('~/')
  })

  it('renders submit and cancel buttons', () => {
    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )
    expect(getByTestId('new-project-submit')).toBeDefined()
    expect(getByTestId('new-project-cancel')).toBeDefined()
  })

  it('does not show error initially', () => {
    const { queryByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )
    expect(queryByTestId('new-project-error')).toBeNull()
  })

  it('shows error when name is empty on submit', () => {
    const { getByTestId, queryByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )
    fireEvent.click(getByTestId('new-project-submit'))
    expect(getByTestId('new-project-error').textContent).toBe('Project name is required')
  })

  it('shows error when path is empty on submit', () => {
    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )
    fireEvent.change(getByTestId('project-name-input'), { target: { value: 'My Project' } })
    fireEvent.change(getByTestId('project-path-input'), { target: { value: '  ' } })
    fireEvent.click(getByTestId('new-project-submit'))
    expect(getByTestId('new-project-error').textContent).toBe('Project path is required')
  })

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn()
    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={onCancel} />
    )
    fireEvent.click(getByTestId('new-project-cancel'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('submits with correct payload and calls onCreated on success', async () => {
    const project = { name: 'Test', slug: 'test', path: '/home/user/test' }
    const fetchSpy = mockFetch(201, project)
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

    expect(fetchSpy).toHaveBeenCalledWith('/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer my-token',
      },
      body: JSON.stringify({ name: 'Test', path: '~/test' }),
    })
  })

  it('shows server error on 409 conflict', async () => {
    mockFetch(409, { error: 'A project with the name "Test" already exists' })
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
    mockFetch(400, { error: 'Project name is required' })
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
    let resolvePromise
    vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise((resolve) => { resolvePromise = resolve })
    )

    const { getByTestId } = render(
      <NewProjectForm token="tok" onCreated={() => {}} onCancel={() => {}} />
    )

    fireEvent.change(getByTestId('project-name-input'), { target: { value: 'Test' } })
    fireEvent.click(getByTestId('new-project-submit'))

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
    const fetchSpy = mockFetch(201, project)
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

    expect(fetchSpy).toHaveBeenCalledWith('/api/projects', expect.objectContaining({
      body: JSON.stringify({ name: 'Test', path: '~/test' }),
    }))
  })
})
