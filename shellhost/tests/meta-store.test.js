import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MetaStore } from '../src/meta-store.js';

describe('MetaStore', () => {
  let baseDir;
  let store;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'meta-'));
    store = new MetaStore({ baseDir });
  });

  afterEach(async () => {
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  it('write persists meta.json under <baseDir>/<id>/', async () => {
    const meta = {
      id: 'aaa',
      projectSlug: 'p',
      cwd: '/tmp',
      command: 'sleep 9',
      createdAt: '2026-05-15T20:00:00.000Z',
      lastActiveAt: '2026-05-15T20:01:00.000Z',
    };
    await store.write(meta);
    const file = join(baseDir, 'aaa', 'meta.json');
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    expect(parsed).toEqual(meta);
  });

  it('read returns null when meta.json does not exist', () => {
    expect(store.read('nope')).toBeNull();
  });

  it('read returns parsed meta for an existing id', async () => {
    await store.write({ id: 't1', projectSlug: 'p', cwd: '/x', command: null });
    const got = store.read('t1');
    expect(got).toMatchObject({ id: 't1', projectSlug: 'p', cwd: '/x' });
  });

  it('update mutates only the supplied fields and rewrites the file', async () => {
    await store.write({ id: 't1', projectSlug: 'p', cwd: '/x', command: null, lastActiveAt: 'a' });
    await store.update('t1', { lastActiveAt: 'b', extra: 1 });
    const got = store.read('t1');
    expect(got.lastActiveAt).toBe('b');
    expect(got.extra).toBe(1);
    expect(got.projectSlug).toBe('p');
  });

  it('list returns every meta.json found under baseDir', async () => {
    await store.write({ id: 't1', projectSlug: 'a', cwd: '/x' });
    await store.write({ id: 't2', projectSlug: 'b', cwd: '/y' });
    // Also include an empty dir and a stray file — list should ignore both.
    await mkdir(join(baseDir, 'empty-dir'), { recursive: true });
    await writeFile(join(baseDir, 'stray.txt'), 'noise');
    const all = store.list().sort((a, b) => a.id.localeCompare(b.id));
    expect(all.map((m) => m.id)).toEqual(['t1', 't2']);
  });

  it('list skips malformed meta.json silently', async () => {
    await mkdir(join(baseDir, 'bad'), { recursive: true });
    await writeFile(join(baseDir, 'bad', 'meta.json'), '{not json');
    await store.write({ id: 'ok', projectSlug: 'p' });
    const all = store.list();
    expect(all.map((m) => m.id)).toEqual(['ok']);
  });

  it('remove deletes only meta.json (not scrollback files)', async () => {
    await store.write({ id: 't1', projectSlug: 'p' });
    await mkdir(join(baseDir, 't1'), { recursive: true });
    await writeFile(join(baseDir, 't1', 'scrollback.log'), 'log');
    store.remove('t1');
    expect(existsSync(join(baseDir, 't1', 'meta.json'))).toBe(false);
    // Scrollback file left intact for the ScrollbackStore to handle.
    expect(existsSync(join(baseDir, 't1', 'scrollback.log'))).toBe(true);
  });

  it('write is atomic (rename) so a torn file never appears', async () => {
    // 50 parallel writes with distinct payloads. After the burst settles, the
    // file content must JSON.parse to one of the exact inputs (no torn JSON).
    const payloads = [];
    for (let i = 0; i < 50; i++) {
      payloads.push({ id: 't', projectSlug: 'p', counter: i, lastActiveAt: String(i) });
    }
    await Promise.all(payloads.map((p) => store.write(p)));
    const parsed = JSON.parse(await readFile(join(baseDir, 't', 'meta.json'), 'utf8'));
    expect(parsed.id).toBe('t');
    expect(payloads.some((p) => p.counter === parsed.counter)).toBe(true);
  });
});
