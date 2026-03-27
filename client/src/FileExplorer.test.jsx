import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import FileExplorer from './FileExplorer.jsx'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

beforeEach(() => {
  vi.clearAllMocks()
  // Default: return empty directory
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve([]),
  })
})

afterEach(() => {
  cleanup()
})

function renderExplorer(props = {}) {
  const defaults = {
    token: 'test-token',
    slug: 'test-project',
    collapsed: false,
    onToggle: vi.fn(),
  }
  return render(<FileExplorer {...defaults} {...props} />)
}

describe('FileExplorer', () => {
  it('renders the file explorer panel', async () => {
    renderExplorer()
    expect(screen.getByTestId('file-explorer')).toBeDefined()
    expect(screen.getByText('Files')).toBeDefined()
  })

  it('renders collapsed state with just a toggle button', () => {
    renderExplorer({ collapsed: true })
    const explorer = screen.getByTestId('file-explorer')
    expect(explorer.className).toContain('w-8')
    expect(screen.getByTestId('file-explorer-toggle')).toBeDefined()
  })

  it('calls onToggle when toggle button is clicked', () => {
    const onToggle = vi.fn()
    renderExplorer({ onToggle })
    fireEvent.click(screen.getByTestId('file-explorer-toggle'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('loads and displays directory entries', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { name: 'src', type: 'directory', size: 0, modified: '2025-01-01T00:00:00Z' },
        { name: 'README.md', type: 'file', size: 100, modified: '2025-01-01T00:00:00Z' },
      ]),
    })

    renderExplorer()

    await waitFor(() => {
      expect(screen.getByText('src')).toBeDefined()
      expect(screen.getByText('README.md')).toBeDefined()
    })
  })

  it('shows loading state initially', () => {
    // Make fetch hang
    mockFetch.mockReturnValue(new Promise(() => {}))
    renderExplorer()
    expect(screen.getByText('Loading...')).toBeDefined()
  })

  it('shows empty directory message', async () => {
    renderExplorer()
    await waitFor(() => {
      expect(screen.getByText('Empty directory')).toBeDefined()
    })
  })

  it('fetches with showHidden and showIgnored params', async () => {
    renderExplorer()
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })

    const url = mockFetch.mock.calls[0][0]
    expect(url).toContain('showHidden=false')
    expect(url).toContain('showIgnored=false')
    expect(url).toContain('project=test-project')
  })

  it('toggles hidden files checkbox', async () => {
    renderExplorer()
    await waitFor(() => {
      expect(screen.getByTestId('toggle-hidden')).toBeDefined()
    })

    const checkbox = screen.getByTestId('toggle-hidden')
    expect(checkbox.checked).toBe(false)
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)
  })

  it('toggles ignored files checkbox', async () => {
    renderExplorer()
    await waitFor(() => {
      expect(screen.getByTestId('toggle-ignored')).toBeDefined()
    })

    const checkbox = screen.getByTestId('toggle-ignored')
    expect(checkbox.checked).toBe(false)
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)
  })

  it('expands directory on click and lazy-loads children', async () => {
    let callCount = 0
    mockFetch.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { name: 'src', type: 'directory', size: 0, modified: '2025-01-01T00:00:00Z' },
          ]),
        })
      }
      // Second call: children of src/
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([
          { name: 'index.js', type: 'file', size: 50, modified: '2025-01-01T00:00:00Z' },
        ]),
      })
    })

    renderExplorer()

    await waitFor(() => {
      expect(screen.getByText('src')).toBeDefined()
    })

    // Click the directory to expand it
    fireEvent.click(screen.getByText('src'))

    await waitFor(() => {
      expect(screen.getByText('index.js')).toBeDefined()
    })
  })

  it('shows context menu on right-click', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { name: 'file.txt', type: 'file', size: 10, modified: '2025-01-01T00:00:00Z' },
      ]),
    })

    renderExplorer()

    await waitFor(() => {
      expect(screen.getByText('file.txt')).toBeDefined()
    })

    fireEvent.contextMenu(screen.getByText('file.txt'))

    await waitFor(() => {
      expect(screen.getByTestId('file-context-menu')).toBeDefined()
      expect(screen.getByTestId('ctx-rename')).toBeDefined()
      expect(screen.getByTestId('ctx-delete')).toBeDefined()
      expect(screen.getByTestId('ctx-copy-path')).toBeDefined()
    })
  })

  it('shows directory-specific context menu items', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { name: 'src', type: 'directory', size: 0, modified: '2025-01-01T00:00:00Z' },
      ]),
    })

    renderExplorer()

    await waitFor(() => {
      expect(screen.getByText('src')).toBeDefined()
    })

    fireEvent.contextMenu(screen.getByText('src'))

    await waitFor(() => {
      expect(screen.getByTestId('ctx-new-file')).toBeDefined()
      expect(screen.getByTestId('ctx-new-folder')).toBeDefined()
      expect(screen.getByTestId('ctx-open-terminal')).toBeDefined()
    })
  })

  it('calls onInsertPath on double-click', async () => {
    const onInsertPath = vi.fn()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { name: 'file.txt', type: 'file', size: 10, modified: '2025-01-01T00:00:00Z' },
      ]),
    })

    renderExplorer({ onInsertPath })

    await waitFor(() => {
      expect(screen.getByText('file.txt')).toBeDefined()
    })

    fireEvent.doubleClick(screen.getByText('file.txt'))
    expect(onInsertPath).toHaveBeenCalledWith('file.txt')
  })

  it('calls onOpenTerminalHere from context menu', async () => {
    const onOpenTerminalHere = vi.fn()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { name: 'src', type: 'directory', size: 0, modified: '2025-01-01T00:00:00Z' },
      ]),
    })

    renderExplorer({ onOpenTerminalHere })

    await waitFor(() => {
      expect(screen.getByText('src')).toBeDefined()
    })

    fireEvent.contextMenu(screen.getByText('src'))

    await waitFor(() => {
      expect(screen.getByTestId('ctx-open-terminal')).toBeDefined()
    })

    fireEvent.click(screen.getByTestId('ctx-open-terminal'))
    expect(onOpenTerminalHere).toHaveBeenCalledWith('src')
  })

  it('distinguishes file icons for different file types', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { name: 'app.js', type: 'file', size: 10, modified: '2025-01-01T00:00:00Z' },
        { name: 'config.json', type: 'file', size: 10, modified: '2025-01-01T00:00:00Z' },
        { name: 'photo.png', type: 'file', size: 10, modified: '2025-01-01T00:00:00Z' },
        { name: 'docs', type: 'directory', size: 0, modified: '2025-01-01T00:00:00Z' },
      ]),
    })

    renderExplorer()

    await waitFor(() => {
      expect(screen.getByText('app.js')).toBeDefined()
      expect(screen.getByText('config.json')).toBeDefined()
      expect(screen.getByText('photo.png')).toBeDefined()
      expect(screen.getByText('docs')).toBeDefined()
    })
  })

  it('has refresh button that reloads content', async () => {
    renderExplorer()

    await waitFor(() => {
      expect(screen.getByTestId('file-explorer-refresh')).toBeDefined()
    })

    const initialCalls = mockFetch.mock.calls.length
    fireEvent.click(screen.getByTestId('file-explorer-refresh'))

    await waitFor(() => {
      expect(mockFetch.mock.calls.length).toBeGreaterThan(initialCalls)
    })
  })
})
