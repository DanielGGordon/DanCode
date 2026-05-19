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
 * Path to the JSON file that records the user's preferred sidebar order
 * (an array of slugs). The file is optional — when missing, listProjects
 * falls back to alphabetical sort by name.
 */
export function getProjectOrderPath() {
  return join(homedir(), '.dancode', 'project-order.json');
}

export async function readProjectOrder(orderPath = getProjectOrderPath()) {
  if (!existsSync(orderPath)) return [];
  try {
    const txt = await readFile(orderPath, 'utf-8');
    const parsed = JSON.parse(txt);
    if (Array.isArray(parsed)) {
      return parsed.filter((s) => typeof s === 'string');
    }
  } catch {}
  return [];
}

export async function writeProjectOrder(order, orderPath = getProjectOrderPath()) {
  if (!Array.isArray(order)) throw new TypeError('order must be an array of slugs');
  const clean = order.filter((s) => typeof s === 'string' && isValidSlug(s));
  await mkdir(join(orderPath, '..'), { recursive: true });
  await writeFile(orderPath, JSON.stringify(clean, null, 2) + '\n');
  return clean;
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

  const order = await readProjectOrder();
  if (order.length === 0) {
    return projects.sort((a, b) => a.name.localeCompare(b.name));
  }
  // Sort by index in `order`; anything not in `order` falls to the bottom
  // in alphabetical order so newly-created projects appear at the end.
  const rank = new Map(order.map((slug, i) => [slug, i]));
  return projects.sort((a, b) => {
    const ra = rank.has(a.slug) ? rank.get(a.slug) : Infinity;
    const rb = rank.has(b.slug) ? rank.get(b.slug) : Infinity;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
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
 * Rename a project. Generates a new slug from `newName`, moves the config file
 * to `<projectsDir>/<newSlug>.json`, and (if `layoutsBaseDir` is provided and
 * the source layout dir exists) moves `<layoutsBaseDir>/<oldSlug>` →
 * `<layoutsBaseDir>/<newSlug>`. Returns the updated project, or `null` if the
 * source project doesn't exist. Throws if the target slug already exists or
 * if `newName` doesn't slugify.
 */
export async function renameProject(slug, newName, {
  projectsDir = getProjectsDir(),
  layoutsBaseDir = null,
} = {}) {
  if (!isValidSlug(slug)) {
    throw new Error('Invalid project slug');
  }
  if (typeof newName !== 'string' || !newName.trim()) {
    const err = new Error('Project name is required');
    err.code = 'INVALID_NAME';
    throw err;
  }
  const trimmed = newName.trim();
  const newSlug = slugify(trimmed);
  if (!newSlug) {
    const err = new Error('Project name must contain at least one alphanumeric character');
    err.code = 'INVALID_NAME';
    throw err;
  }

  const oldPath = getProjectConfigPath(slug, projectsDir);
  if (!existsSync(oldPath)) {
    return null;
  }

  // Same-slug rename: just update the name (idempotent on slug)
  if (newSlug === slug) {
    return updateProject(slug, { name: trimmed }, projectsDir);
  }

  const newPath = getProjectConfigPath(newSlug, projectsDir);
  if (existsSync(newPath)) {
    const err = new Error(`A project with the name "${trimmed}" already exists`);
    err.code = 'CONFLICT';
    throw err;
  }

  const content = await readFile(oldPath, 'utf-8');
  const project = JSON.parse(content);
  const updated = { ...project, name: trimmed, slug: newSlug };

  // 1. Write new project config
  await writeFile(newPath, JSON.stringify(updated, null, 2) + '\n');

  // 2. Move layout directory (if it exists)
  if (layoutsBaseDir) {
    const { rename } = await import('node:fs/promises');
    const oldLayoutDir = join(layoutsBaseDir, slug);
    const newLayoutDir = join(layoutsBaseDir, newSlug);
    if (existsSync(oldLayoutDir)) {
      try {
        await rename(oldLayoutDir, newLayoutDir);
      } catch (e) {
        // Roll back: remove the new config and re-throw
        await rm(newPath);
        throw e;
      }
    }
  }

  // 3. Remove old project config (last, so a crash mid-rename leaves the new
  // config present rather than losing the project entirely)
  await rm(oldPath);

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
