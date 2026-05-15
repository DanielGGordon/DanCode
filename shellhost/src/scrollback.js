import {
  mkdirSync,
  openSync,
  writeSync,
  closeSync,
  fstatSync,
  renameSync,
  statSync,
  readSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * Disk-persisted PTY scrollback.
 *
 * Each terminal gets its own directory: `<baseDir>/<terminalId>/`.
 * Output is appended synchronously to `scrollback.log`. When the active log
 * reaches `maxBytes`, it is renamed to `scrollback.log.1` (overwriting any
 * prior rotation file) and a fresh empty `scrollback.log` is opened. At most
 * two on-disk files exist per terminal at any moment.
 *
 * `readTail` returns the last ~tailBytes bytes across both files in
 * chronological order. The rotation file is always older than the current
 * file.
 *
 * Writes are write-through (no batching in user space) so a hard crash
 * cannot lose chunks already returned from `append`. We hold an open file
 * descriptor per terminal to avoid the per-chunk open/close overhead but
 * still issue a single `writeSync` per append.
 */
export class ScrollbackStore {
  /**
   * @param {object} [opts]
   * @param {string} [opts.baseDir]  Root directory; per-terminal subdirs live under it.
   * @param {number} [opts.maxBytes] Max active-log size before rotation. Default 1MB.
   * @param {number} [opts.tailBytes] Max bytes to return from readTail. Default 50KB.
   */
  constructor({ baseDir, maxBytes = 1_000_000, tailBytes = 50 * 1024 } = {}) {
    if (!baseDir || typeof baseDir !== 'string') {
      throw new TypeError('ScrollbackStore: baseDir is required');
    }
    this.baseDir = baseDir;
    this.maxBytes = maxBytes;
    this.tailBytes = tailBytes;
    this._open = new Map(); // terminalId -> { fd, size }
  }

  _dir(terminalId) {
    return join(this.baseDir, terminalId);
  }

  _logPath(terminalId) {
    return join(this._dir(terminalId), 'scrollback.log');
  }

  _rotPath(terminalId) {
    return join(this._dir(terminalId), 'scrollback.log.1');
  }

  _ensureOpen(terminalId) {
    const cached = this._open.get(terminalId);
    if (cached) return cached;
    const dir = this._dir(terminalId);
    mkdirSync(dir, { recursive: true });
    const path = this._logPath(terminalId);
    // 'a' opens for appending; creates if missing.
    const fd = openSync(path, 'a');
    let size = 0;
    try { size = fstatSync(fd).size; } catch { /* fresh file */ }
    const entry = { fd, size };
    this._open.set(terminalId, entry);
    return entry;
  }

  /**
   * Append a chunk of PTY output to the terminal's scrollback. Synchronous
   * write-through: by the time this call returns, the bytes have been handed
   * to the kernel.
   */
  append(terminalId, chunk) {
    if (!chunk || chunk.length === 0) return;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    const entry = this._ensureOpen(terminalId);
    writeSync(entry.fd, buf);
    entry.size += buf.length;
    if (entry.size >= this.maxBytes) {
      this._rotate(terminalId);
    }
  }

  _rotate(terminalId) {
    const entry = this._open.get(terminalId);
    if (entry) {
      try { closeSync(entry.fd); } catch { /* ignore */ }
      this._open.delete(terminalId);
    }
    const logPath = this._logPath(terminalId);
    const rotPath = this._rotPath(terminalId);
    try {
      // rename atomically replaces any existing rotation file, so at most 2
      // files ever exist for the terminal.
      renameSync(logPath, rotPath);
    } catch { /* file may not exist if rotated mid-write race; ignore */ }
    // Reopen a fresh empty log on next append (lazy).
  }

  /**
   * Flush kernel buffers for the terminal (best-effort; not required for
   * correctness but useful in tests that fstat the file right after append).
   * No-op when no fd is open.
   */
  flush(terminalId) {
    // writeSync already hands the bytes to the kernel; fstat will see them.
    // We expose this as an explicit hook for tests + future fsync support.
    const entry = this._open.get(terminalId);
    if (!entry) return;
    // Intentionally do not fsync — Phase 2 trades durability against perf,
    // and the criterion is just "write-through, no batching".
  }

  /**
   * Read the last ~tailBytes bytes for a terminal, spanning the rotation
   * file and the current file in chronological order. Returns '' if there's
   * no on-disk scrollback yet.
   */
  readTail(terminalId) {
    const logPath = this._logPath(terminalId);
    const rotPath = this._rotPath(terminalId);

    const curSize = sizeOf(logPath);
    const rotSize = sizeOf(rotPath);
    if (curSize === 0 && rotSize === 0) return '';

    let need = this.tailBytes;
    let fromCur = '';
    let fromRot = '';

    if (curSize > 0) {
      const takeCur = Math.min(curSize, need);
      fromCur = readLastBytes(logPath, takeCur);
      need -= takeCur;
    }
    if (need > 0 && rotSize > 0) {
      const takeRot = Math.min(rotSize, need);
      fromRot = readLastBytes(rotPath, takeRot);
    }
    return fromRot + fromCur;
  }

  /**
   * Close and remove all on-disk state for a terminal.
   */
  removeTerminal(terminalId) {
    const entry = this._open.get(terminalId);
    if (entry) {
      try { closeSync(entry.fd); } catch { /* ignore */ }
      this._open.delete(terminalId);
    }
    const dir = this._dir(terminalId);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }

  /**
   * Close every open fd. Called on shellhost shutdown.
   */
  closeAll() {
    for (const [, entry] of this._open) {
      try { closeSync(entry.fd); } catch { /* ignore */ }
    }
    this._open.clear();
  }
}

function sizeOf(path) {
  try { return statSync(path).size; } catch { return 0; }
}

function readLastBytes(path, nBytes) {
  if (nBytes <= 0) return '';
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const take = Math.min(size, nBytes);
    if (take === 0) return '';
    const buf = Buffer.alloc(take);
    readSync(fd, buf, 0, take, size - take);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
  }
}

