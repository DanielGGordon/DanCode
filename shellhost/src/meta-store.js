import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
  renameSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * Disk-persisted terminal metadata.
 *
 * Each terminal gets its own directory under <baseDir>/<terminalId>/, the
 * same directory used by ScrollbackStore. This object owns the `meta.json`
 * file in that directory. ScrollbackStore owns the log files.
 *
 * Writes go through a `<id>.tmp` file in the same directory and are renamed
 * over the live `meta.json`, so a crash mid-write cannot leave a torn JSON
 * payload on disk.
 */
export class MetaStore {
  /**
   * @param {object} opts
   * @param {string} opts.baseDir - parent directory for per-terminal state.
   */
  constructor({ baseDir } = {}) {
    if (!baseDir || typeof baseDir !== 'string') {
      throw new TypeError('MetaStore: baseDir is required');
    }
    this.baseDir = baseDir;
  }

  _dir(id) {
    return join(this.baseDir, id);
  }

  _path(id) {
    return join(this._dir(id), 'meta.json');
  }

  /**
   * Atomically write the meta object to <baseDir>/<id>/meta.json. The
   * meta object must include an `id` field; everything else is opaque to
   * this store.
   */
  async write(meta) {
    if (!meta || typeof meta !== 'object' || !meta.id) {
      throw new TypeError('MetaStore.write: meta.id is required');
    }
    const dir = this._dir(meta.id);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `meta.json.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
    writeFileSync(tmp, JSON.stringify(meta));
    renameSync(tmp, this._path(meta.id));
  }

  /**
   * Synchronous shorthand for `write` when the caller doesn't want to await.
   */
  writeSync(meta) {
    if (!meta || typeof meta !== 'object' || !meta.id) {
      throw new TypeError('MetaStore.writeSync: meta.id is required');
    }
    const dir = this._dir(meta.id);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `meta.json.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
    writeFileSync(tmp, JSON.stringify(meta));
    renameSync(tmp, this._path(meta.id));
  }

  /**
   * Read the meta for `id`, or return null if it doesn't exist (or is
   * unreadable / malformed).
   */
  read(id) {
    const p = this._path(id);
    if (!existsSync(p)) return null;
    try {
      const txt = readFileSync(p, 'utf8');
      return JSON.parse(txt);
    } catch {
      return null;
    }
  }

  /**
   * Read-modify-write the meta file for `id`, merging the partial object
   * into the existing payload. If no meta exists yet, the partial object is
   * written verbatim (and must include `id`).
   */
  async update(id, partial) {
    const existing = this.read(id) || { id };
    const next = { ...existing, ...partial, id: existing.id || id };
    await this.write(next);
    return next;
  }

  /**
   * Return all meta objects found under baseDir. Subdirectories without a
   * meta.json or with an unreadable / malformed one are silently skipped.
   */
  list() {
    const out = [];
    if (!existsSync(this.baseDir)) return out;
    let entries;
    try {
      entries = readdirSync(this.baseDir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(this.baseDir, entry.name, 'meta.json');
      if (!existsSync(path)) continue;
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (parsed && typeof parsed === 'object' && parsed.id) out.push(parsed);
      } catch {
        // Malformed — skip.
      }
    }
    return out;
  }

  /**
   * Remove just the meta.json file for `id`. The terminal directory and any
   * scrollback files inside it are left intact — ScrollbackStore manages
   * those.
   */
  remove(id) {
    const p = this._path(id);
    try {
      const st = statSync(p);
      if (st.isFile()) unlinkSync(p);
    } catch { /* missing or already gone */ }
  }
}
