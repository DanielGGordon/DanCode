import { readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Convert a project name to a URL-safe slug.
 * Lowercase, hyphens for separators, no leading/trailing hyphens.
 */
export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Returns the directory where project configs are stored.
 */
export function getProjectsDir() {
  return join(homedir(), '.dancode', 'projects');
}

/**
 * Returns the path to a specific project's config file.
 */
export function getProjectConfigPath(slug, projectsDir = getProjectsDir()) {
  return join(projectsDir, `${slug}.json`);
}

/**
 * Validate project creation inputs.
 * Returns { valid: true } or { valid: false, error: string }.
 */
export function validateProjectInput(name, path) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    return { valid: false, error: 'Project name is required' };
  }

  if (!path || typeof path !== 'string' || !path.trim()) {
    return { valid: false, error: 'Project path is required' };
  }

  const slug = slugify(name.trim());
  if (!slug) {
    return { valid: false, error: 'Project name must contain at least one alphanumeric character' };
  }

  // Path must be absolute; only bare ~ and ~/ are supported (not ~user)
  const trimmedPath = path.trim();
  if (!trimmedPath.startsWith('/') && trimmedPath !== '~' && !trimmedPath.startsWith('~/')) {
    return { valid: false, error: 'Project path must be absolute (start with / or ~/)' };
  }

  return { valid: true };
}

/**
 * Resolve a path, expanding ~ to the home directory.
 */
export function resolvePath(p) {
  if (p.startsWith('~/')) {
    return join(homedir(), p.slice(2));
  }
  if (p === '~') {
    return homedir();
  }
  return p;
}

/**
 * Create a project config file. Returns the project object.
 * Throws if a project with the same slug already exists.
 * Creates the project directory if it does not exist.
 */
export async function createProject(name, path, projectsDir = getProjectsDir()) {
  const validation = validateProjectInput(name, path);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const trimmedName = name.trim();
  const trimmedPath = path.trim();
  const slug = slugify(trimmedName);
  const resolvedPath = resolvePath(trimmedPath);

  // Ensure projects directory exists
  if (!existsSync(projectsDir)) {
    await mkdir(projectsDir, { recursive: true });
  }

  // Check for duplicate
  const configPath = getProjectConfigPath(slug, projectsDir);
  if (existsSync(configPath)) {
    throw new Error(`A project with the name "${trimmedName}" already exists`);
  }

  // Create the project directory before persisting config.
  // This avoids leaving a broken config entry if mkdir fails.
  if (!existsSync(resolvedPath)) {
    await mkdir(resolvedPath, { recursive: true });
  }

  const project = {
    name: trimmedName,
    slug,
    path: resolvedPath,
    createdAt: new Date().toISOString(),
  };

  await writeFile(configPath, JSON.stringify(project, null, 2) + '\n');
  return project;
}

/**
 * Create a project config that adopts an existing tmux session.
 * Unlike createProject, this does not require a directory path
 * and does not create a tmux session — it links to the given one.
 *
 * @param {string} name - project display name
 * @param {string} tmuxSession - name of the existing tmux session to adopt
 * @param {string} [projectsDir] - override for projects config directory
 * @returns {Promise<object>} the created project config
 */
export async function createAdoptedProject(name, tmuxSession, projectsDir = getProjectsDir()) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Project name is required');
  }

  const trimmedName = name.trim();
  const slug = slugify(trimmedName);
  if (!slug) {
    throw new Error('Project name must contain at least one alphanumeric character');
  }

  // Ensure projects directory exists
  if (!existsSync(projectsDir)) {
    await mkdir(projectsDir, { recursive: true });
  }

  // Check for duplicate
  const configPath = getProjectConfigPath(slug, projectsDir);
  if (existsSync(configPath)) {
    throw new Error(`A project with the name "${trimmedName}" already exists`);
  }

  const project = {
    name: trimmedName,
    slug,
    tmuxSession,
    createdAt: new Date().toISOString(),
  };

  await writeFile(configPath, JSON.stringify(project, null, 2) + '\n');
  return project;
}

/**
 * List all configured projects.
 */
export async function listProjects(projectsDir = getProjectsDir()) {
  if (!existsSync(projectsDir)) {
    return [];
  }

  const files = await readdir(projectsDir);
  const projects = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const content = await readFile(join(projectsDir, file), 'utf-8');
      projects.push(JSON.parse(content));
    } catch {
      // Skip malformed or unreadable config files
    }
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get a single project by slug. Returns null if not found.
 */
export async function getProject(slug, projectsDir = getProjectsDir()) {
  if (!isValidSlug(slug)) {
    throw new Error('Invalid project slug');
  }
  const configPath = getProjectConfigPath(slug, projectsDir);
  if (!existsSync(configPath)) {
    return null;
  }
  const content = await readFile(configPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Returns true if `slug` is a valid slugified name (lowercase alphanumeric + hyphens,
 * no leading/trailing hyphens, no path separators).
 */
export function isValidSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}

/**
 * Update a project config by slug. Merges `updates` into the existing config.
 * Returns the updated project object, or null if not found.
 */
export async function updateProject(slug, updates, projectsDir = getProjectsDir()) {
  if (!isValidSlug(slug)) {
    throw new Error('Invalid project slug');
  }
  const configPath = getProjectConfigPath(slug, projectsDir);
  if (!existsSync(configPath)) {
    return null;
  }
  const content = await readFile(configPath, 'utf-8');
  const project = JSON.parse(content);
  const updated = { ...project };
  for (const [key, value] of Object.entries(updates)) {
    if (value && typeof value === 'object' && !Array.isArray(value) &&
        project[key] && typeof project[key] === 'object' && !Array.isArray(project[key])) {
      updated[key] = { ...project[key], ...value };
    } else {
      updated[key] = value;
    }
  }
  await writeFile(configPath, JSON.stringify(updated, null, 2) + '\n');
  return updated;
}

/**
 * Delete a project config by slug. Returns true if deleted, false if not found.
 */
export async function deleteProject(slug, projectsDir = getProjectsDir()) {
  if (!isValidSlug(slug)) {
    throw new Error('Invalid project slug');
  }
  const configPath = getProjectConfigPath(slug, projectsDir);
  if (!existsSync(configPath)) {
    return false;
  }
  await rm(configPath);
  return true;
}
