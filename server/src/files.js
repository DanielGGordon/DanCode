import { readFile, writeFile, readdir, mkdir, rename, rm, stat, lstat, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import ignore from 'ignore';

const MAX_FILE_SIZE = 1024 * 1024; // 1MB

/**
 * Resolve a requested path against a project root and validate it stays within bounds.
 * Returns the absolute resolved path, or throws if the path escapes the project directory.
 * Handles symlinks by resolving them and checking the real path.
 */
export async function safePath(projectRoot, requestedPath) {
  const absRoot = resolve(projectRoot);
  // Join and resolve the requested path against the project root
  const joined = resolve(absRoot, requestedPath || '.');

  // First check: the joined path must be within or equal to the root
  if (!joined.startsWith(absRoot + '/') && joined !== absRoot) {
    throw Object.assign(new Error('Path is outside the project directory'), { code: 'TRAVERSAL' });
  }

  // If the target exists, resolve symlinks and re-check
  if (existsSync(joined)) {
    const real = await realpath(joined);
    if (!real.startsWith(absRoot + '/') && real !== absRoot) {
      throw Object.assign(new Error('Symlink target is outside the project directory'), { code: 'TRAVERSAL' });
    }
  }

  return joined;
}

/**
 * Load .gitignore patterns from a project root directory.
 * Returns an ignore instance that can test paths against the patterns.
 */
async function loadGitignore(projectRoot) {
  const ig = ignore();
  const gitignorePath = join(projectRoot, '.gitignore');
  if (existsSync(gitignorePath)) {
    try {
      const content = await readFile(gitignorePath, 'utf-8');
      ig.add(content);
    } catch {
      // Ignore read errors
    }
  }
  // Always ignore .git directory
  ig.add('.git');
  return ig;
}

/**
 * List directory contents with metadata.
 * Options:
 *   showHidden: boolean (default false) - show dotfiles
 *   showIgnored: boolean (default false) - show .gitignore'd files
 *
 * Returns array of { name, type, size, modified }
 */
export async function listDirectory(projectRoot, relativePath, options = {}) {
  const { showHidden = false, showIgnored = false } = options;
  const absPath = await safePath(projectRoot, relativePath || '.');

  const entries = await readdir(absPath, { withFileTypes: true });
  const ig = showIgnored ? null : await loadGitignore(projectRoot);

  // Compute the relative directory path from project root for gitignore matching
  const relDir = relative(projectRoot, absPath);

  const results = [];

  for (const entry of entries) {
    // Filter hidden files
    if (!showHidden && entry.name.startsWith('.')) continue;

    // Filter gitignored files
    if (ig) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      // For directories, append trailing slash for gitignore matching
      const testPath = entry.isDirectory() ? `${relPath}/` : relPath;
      if (ig.ignores(testPath)) continue;
    }

    try {
      const fullPath = join(absPath, entry.name);
      const stats = await stat(fullPath);
      results.push({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: stats.size,
        modified: stats.mtime.toISOString(),
      });
    } catch {
      // Skip entries we can't stat (broken symlinks, etc.)
    }
  }

  // Sort: directories first, then alphabetical
  results.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return results;
}

/**
 * Read a file's contents as text.
 * Rejects files larger than 1MB.
 */
export async function readFileContent(projectRoot, relativePath) {
  const absPath = await safePath(projectRoot, relativePath);

  const stats = await stat(absPath);
  if (stats.isDirectory()) {
    throw Object.assign(new Error('Cannot read a directory'), { code: 'EISDIR' });
  }
  if (stats.size > MAX_FILE_SIZE) {
    throw Object.assign(new Error('File exceeds 1MB limit'), { code: 'TOOLARGE' });
  }

  return readFile(absPath, 'utf-8');
}

/**
 * Write content to a file. Creates parent directories if needed.
 */
export async function writeFileContent(projectRoot, relativePath, content) {
  const absPath = await safePath(projectRoot, relativePath);

  // Ensure parent directory exists
  const dir = dirname(absPath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  await writeFile(absPath, content, 'utf-8');
}

/**
 * Create a directory (recursive).
 */
export async function createDirectory(projectRoot, relativePath) {
  const absPath = await safePath(projectRoot, relativePath);
  await mkdir(absPath, { recursive: true });
}

/**
 * Rename or move a file/directory.
 */
export async function renameFile(projectRoot, oldRelPath, newRelPath) {
  const oldAbs = await safePath(projectRoot, oldRelPath);
  const newAbs = await safePath(projectRoot, newRelPath);

  // Ensure parent directory of destination exists
  const newDir = dirname(newAbs);
  if (!existsSync(newDir)) {
    await mkdir(newDir, { recursive: true });
  }

  await rename(oldAbs, newAbs);
}

/**
 * Delete a file or directory (recursive for directories).
 */
export async function deleteFile(projectRoot, relativePath) {
  const absPath = await safePath(projectRoot, relativePath);

  // Don't allow deleting the project root itself
  if (resolve(absPath) === resolve(projectRoot)) {
    throw Object.assign(new Error('Cannot delete the project root directory'), { code: 'FORBIDDEN' });
  }

  await rm(absPath, { recursive: true, force: true });
}
