/**
 * Layout persistence for DanCode projects.
 *
 * Layout describes the per-project workspace UI: which terminals exist (with cwd,
 * command, and Claude session metadata), which files are open in which pane, and
 * the split/tab tree structure. One file per project at
 * `<baseDir>/<slug>/layout.json`. Writes are atomic (write to .tmp, fsync,
 * rename). A serialization lock per-slug serializes concurrent writes so the
 * final state matches exactly one of the inputs.
 */

import { mkdir, readFile, writeFile, open, rename, unlink, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const VALID_TERMINAL_KEYS = new Set([
  'id',
  'cwd',
  'command',
  'claudeSessionId',
  'background',
  'label',
]);

const VALID_OPEN_FILE_KEYS = new Set(['path', 'pane', 'scrollTop']);

const VALID_LAYOUT_KEYS = new Set(['terminals', 'openFiles', 'splits', 'focusedPane']);

const VALID_SPLIT_DIRECTIONS = new Set(['vertical', 'horizontal']);

/**
 * Return a fresh empty default layout.
 */
export function defaultLayout() {
  return {
    terminals: [],
    openFiles: [],
    splits: { type: 'leaf', id: 'root' },
    focusedPane: 'root',
  };
}

function checkUnknownKeys(obj, allowed) {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return `Unknown field "${k}"`;
    }
  }
  return null;
}

function validateSplits(node, path = 'splits') {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return `${path} must be an object`;
  }

  if (node.type === 'leaf') {
    const allowed = new Set(['type', 'id']);
    const unknown = checkUnknownKeys(node, allowed);
    if (unknown) return `${path}: ${unknown}`;
    if (typeof node.id !== 'string' || !node.id) {
      return `${path}.id must be a non-empty string`;
    }
    return null;
  }

  if (node.type === 'split') {
    const allowed = new Set(['type', 'direction', 'ratio', 'children']);
    const unknown = checkUnknownKeys(node, allowed);
    if (unknown) return `${path}: ${unknown}`;
    if (!VALID_SPLIT_DIRECTIONS.has(node.direction)) {
      return `${path}.direction must be 'vertical' or 'horizontal'`;
    }
    if (typeof node.ratio !== 'number' || node.ratio < 0 || node.ratio > 1) {
      return `${path}.ratio must be a number between 0 and 1`;
    }
    if (!Array.isArray(node.children) || node.children.length < 2) {
      return `${path}.children must be an array with at least 2 entries`;
    }
    for (let i = 0; i < node.children.length; i++) {
      const err = validateSplits(node.children[i], `${path}.children[${i}]`);
      if (err) return err;
    }
    return null;
  }

  if (node.type === 'tabs') {
    const allowed = new Set(['type', 'active', 'children']);
    const unknown = checkUnknownKeys(node, allowed);
    if (unknown) return `${path}: ${unknown}`;
    if (!Array.isArray(node.children) || node.children.length < 1) {
      return `${path}.children must be a non-empty array`;
    }
    if (node.active !== undefined && typeof node.active !== 'number') {
      return `${path}.active must be a number`;
    }
    for (let i = 0; i < node.children.length; i++) {
      const err = validateSplits(node.children[i], `${path}.children[${i}]`);
      if (err) return err;
    }
    return null;
  }

  return `${path}.type must be 'leaf', 'split', or 'tabs'`;
}

/**
 * Validate a layout payload. Returns `{ valid: true }` or
 * `{ valid: false, error: string }`.
 */
export function validateLayout(layout) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
    return { valid: false, error: 'Layout must be an object' };
  }

  const unknown = checkUnknownKeys(layout, VALID_LAYOUT_KEYS);
  if (unknown) {
    return { valid: false, error: unknown };
  }

  if (!Array.isArray(layout.terminals)) {
    return { valid: false, error: 'terminals must be an array' };
  }
  for (let i = 0; i < layout.terminals.length; i++) {
    const t = layout.terminals[i];
    if (!t || typeof t !== 'object' || Array.isArray(t)) {
      return { valid: false, error: `terminals[${i}] must be an object` };
    }
    const tUnknown = checkUnknownKeys(t, VALID_TERMINAL_KEYS);
    if (tUnknown) {
      return { valid: false, error: `terminals[${i}]: ${tUnknown}` };
    }
    if (typeof t.id !== 'string' || !t.id) {
      return { valid: false, error: `terminals[${i}].id must be a non-empty string` };
    }
    if (t.cwd !== undefined && typeof t.cwd !== 'string') {
      return { valid: false, error: `terminals[${i}].cwd must be a string` };
    }
    if (t.command !== undefined && t.command !== null && typeof t.command !== 'string') {
      return { valid: false, error: `terminals[${i}].command must be a string or null` };
    }
    if (
      t.claudeSessionId !== undefined &&
      t.claudeSessionId !== null &&
      typeof t.claudeSessionId !== 'string'
    ) {
      return { valid: false, error: `terminals[${i}].claudeSessionId must be a string or null` };
    }
    if (t.background !== undefined && typeof t.background !== 'boolean') {
      return { valid: false, error: `terminals[${i}].background must be a boolean` };
    }
    if (t.label !== undefined && typeof t.label !== 'string') {
      return { valid: false, error: `terminals[${i}].label must be a string` };
    }
  }

  if (!Array.isArray(layout.openFiles)) {
    return { valid: false, error: 'openFiles must be an array' };
  }
  for (let i = 0; i < layout.openFiles.length; i++) {
    const f = layout.openFiles[i];
    if (!f || typeof f !== 'object' || Array.isArray(f)) {
      return { valid: false, error: `openFiles[${i}] must be an object` };
    }
    const fUnknown = checkUnknownKeys(f, VALID_OPEN_FILE_KEYS);
    if (fUnknown) {
      return { valid: false, error: `openFiles[${i}]: ${fUnknown}` };
    }
    if (typeof f.path !== 'string' || !f.path) {
      return { valid: false, error: `openFiles[${i}].path must be a non-empty string` };
    }
    if (typeof f.pane !== 'string' || !f.pane) {
      return { valid: false, error: `openFiles[${i}].pane must be a non-empty string` };
    }
    if (f.scrollTop !== undefined && typeof f.scrollTop !== 'number') {
      return { valid: false, error: `openFiles[${i}].scrollTop must be a number` };
    }
  }

  const splitsErr = validateSplits(layout.splits);
  if (splitsErr) return { valid: false, error: splitsErr };

  if (typeof layout.focusedPane !== 'string' || !layout.focusedPane) {
    return { valid: false, error: 'focusedPane must be a non-empty string' };
  }

  return { valid: true };
}

/**
 * Returns the path to a project's layout.json under baseDir.
 */
export function getLayoutPath(slug, baseDir) {
  return join(baseDir, slug, 'layout.json');
}

/**
 * Read the layout for a project, returning the default empty layout if none exists.
 */
export async function readLayout(slug, baseDir) {
  const path = getLayoutPath(slug, baseDir);
  if (!existsSync(path)) {
    return defaultLayout();
  }
  try {
    const content = await readFile(path, 'utf-8');
    const parsed = JSON.parse(content);
    return parsed;
  } catch {
    return defaultLayout();
  }
}

// Per-slug serialization lock so multiple in-process callers don't trample one
// another. The OS-level rename is atomic but two concurrent rename calls can
// still race (whichever lands last wins, and that's fine), but serializing
// them inside the process keeps the test's "exactly one of the inputs" claim
// straightforwardly true.
const writeLocks = new Map();

async function withWriteLock(key, fn) {
  const prev = writeLocks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((res) => { release = res; });
  writeLocks.set(key, prev.then(() => next));
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (writeLocks.get(key) === next) {
      writeLocks.delete(key);
    }
  }
}

/**
 * Write a layout for the project. Atomic: writes to layout.json.tmp, fsync,
 * then renames over layout.json. Throws if the layout fails validation.
 */
export async function writeLayout(slug, layout, baseDir) {
  const v = validateLayout(layout);
  if (!v.valid) {
    const err = new Error(`Invalid layout: ${v.error}`);
    err.code = 'INVALID_LAYOUT';
    throw err;
  }

  const finalPath = getLayoutPath(slug, baseDir);
  const projDir = dirname(finalPath);
  if (!existsSync(projDir)) {
    await mkdir(projDir, { recursive: true });
  }
  const tmpPath = `${finalPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;

  return withWriteLock(`${baseDir}::${slug}`, async () => {
    const body = JSON.stringify(layout, null, 2) + '\n';
    const fh = await open(tmpPath, 'w');
    try {
      await fh.writeFile(body, 'utf-8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    try {
      await rename(tmpPath, finalPath);
    } catch (e) {
      try { await unlink(tmpPath); } catch {}
      throw e;
    }
  });
}

/**
 * Walk the layout's openFiles, splitting them into those whose `path` still
 * resolves to a file inside `projectRoot` and those that do not. Returns a new
 * layout with only the extant files, plus a list of the missing ones.
 */
export async function removeMissingFiles(layout, projectRoot) {
  if (!projectRoot) {
    return { layout, missing: [] };
  }
  const present = [];
  const missing = [];
  for (const f of layout.openFiles || []) {
    let absolute;
    try {
      absolute = resolve(projectRoot, f.path);
    } catch {
      missing.push(f);
      continue;
    }
    // Path traversal guard: ignore anything that resolves outside the project.
    if (
      absolute !== projectRoot &&
      !absolute.startsWith(projectRoot.endsWith('/') ? projectRoot : projectRoot + '/')
    ) {
      missing.push(f);
      continue;
    }
    let ok = false;
    try {
      const s = await stat(absolute);
      ok = s.isFile();
    } catch {
      ok = false;
    }
    if (ok) present.push(f);
    else missing.push(f);
  }
  return { layout: { ...layout, openFiles: present }, missing };
}
