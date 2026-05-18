import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// ---- CPU sampling (Linux /proc/stat) ----

let prev = null; // { total, idle, t }

async function readCpuTotals() {
  const txt = await readFile('/proc/stat', 'utf8');
  const line = txt.split('\n', 1)[0];          // first line: aggregate
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  // user nice system idle iowait irq softirq steal guest guest_nice
  const idle = (parts[3] || 0) + (parts[4] || 0);
  const total = parts.reduce((a, b) => a + b, 0);
  return { total, idle };
}

async function cpuPercent() {
  let cur;
  try {
    cur = await readCpuTotals();
  } catch {
    return 0;
  }
  if (!prev) {
    prev = { ...cur, t: Date.now() };
    // brief sample so the first call is non-zero
    await new Promise((r) => setTimeout(r, 100));
    try {
      cur = await readCpuTotals();
    } catch {
      return 0;
    }
  }
  const dTotal = cur.total - prev.total;
  const dIdle = cur.idle - prev.idle;
  prev = { ...cur, t: Date.now() };
  if (dTotal <= 0) return 0;
  return Math.max(0, Math.min(100, ((dTotal - dIdle) / dTotal) * 100));
}

// ---- Memory (prefer /proc/meminfo MemAvailable) ----

async function memPercent() {
  try {
    const txt = await readFile('/proc/meminfo', 'utf8');
    const total = Number(txt.match(/MemTotal:\s+(\d+)/)?.[1]);
    const avail = Number(txt.match(/MemAvailable:\s+(\d+)/)?.[1]);
    if (total && avail) return ((total - avail) / total) * 100;
  } catch {}
  const { totalmem, freemem } = await import('node:os');
  const t = totalmem();
  return t ? ((t - freemem()) / t) * 100 : 0;
}

export async function getSystemStats() {
  const [cpu, mem] = await Promise.all([cpuPercent(), memPercent()]);
  return { cpuPercent: Math.round(cpu), memPercent: Math.round(mem) };
}

// ---- Directory listing for path autocomplete ----

/**
 * Expand a leading ~ to the user's home directory.
 */
function expandHome(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

/**
 * List subdirectories of `inputPath`. If `inputPath` ends with '/' (or is
 * empty/'~'), list entries directly inside it. Otherwise, list entries in
 * its parent that start with its basename — i.e., autocomplete.
 *
 * Returns { base, entries } where:
 *   - base is the directory whose contents are returned (absolute, no
 *     trailing slash)
 *   - entries is a sorted list of directory names inside `base`
 */
export async function listDirsForCompletion(inputPath) {
  const raw = expandHome(inputPath || '~');
  const abs = resolve(raw);

  let dirToList;
  let filter = '';
  // Treat the input as "list this directory" if it ends with a separator,
  // OR if the path itself exists and is a directory.
  const endsWithSep = inputPath?.endsWith('/');
  let isDir = false;
  try {
    isDir = (await stat(abs)).isDirectory();
  } catch {}

  if (endsWithSep || isDir) {
    dirToList = abs;
  } else {
    // Autocomplete: list parent, filter by basename prefix
    const idx = abs.lastIndexOf('/');
    dirToList = idx <= 0 ? '/' : abs.slice(0, idx);
    filter = abs.slice(idx + 1);
  }

  let entries = [];
  try {
    const dirents = await readdir(dirToList, { withFileTypes: true });
    entries = dirents
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => d.name)
      .filter((n) => !filter || n.toLowerCase().startsWith(filter.toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
  } catch (err) {
    const e = new Error(err.message);
    e.code = err.code;
    throw e;
  }

  return { base: dirToList, entries };
}
