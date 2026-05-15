import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScrollbackStore } from '../src/scrollback.js';

describe('ScrollbackStore', () => {
  let baseDir;
  let store;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'sb-'));
  });

  afterEach(async () => {
    try { store?.closeAll(); } catch { /* ignore */ }
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
  });

  it('append writes the chunk to scrollback.log on disk', async () => {
    store = new ScrollbackStore({ baseDir });
    store.append('t1', 'hello world\n');
    store.flush('t1');
    const file = await readFile(join(baseDir, 't1', 'scrollback.log'), 'utf8');
    expect(file).toBe('hello world\n');
  });

  it('append from multiple terminals lands in independent files', async () => {
    store = new ScrollbackStore({ baseDir });
    store.append('a', 'one');
    store.append('b', 'two');
    store.append('a', 'three');
    store.flush('a');
    store.flush('b');
    expect(await readFile(join(baseDir, 'a', 'scrollback.log'), 'utf8')).toBe('onethree');
    expect(await readFile(join(baseDir, 'b', 'scrollback.log'), 'utf8')).toBe('two');
  });

  it('readTail on a terminal with no prior output returns empty', () => {
    store = new ScrollbackStore({ baseDir });
    expect(store.readTail('nope')).toBe('');
  });

  it('readTail returns the appended data when under tailBytes', () => {
    store = new ScrollbackStore({ baseDir, tailBytes: 1024 });
    store.append('t1', 'abc');
    store.append('t1', 'def');
    expect(store.readTail('t1')).toBe('abcdef');
  });

  it('readTail truncates to the last tailBytes when content is larger', () => {
    store = new ScrollbackStore({ baseDir, tailBytes: 5 });
    store.append('t1', '0123456789');
    expect(store.readTail('t1')).toBe('56789');
  });

  it('rotates at maxBytes: renames scrollback.log to scrollback.log.1 and starts fresh', async () => {
    store = new ScrollbackStore({ baseDir, maxBytes: 16 });
    store.append('t1', '01234567'); // 8 bytes -- under threshold, no rotation yet
    store.append('t1', '89abcdef'); // 16 bytes total -- triggers rotation
    store.append('t1', 'ZZZ');       // goes into fresh current
    store.flush('t1');

    const dir = join(baseDir, 't1');
    const files = (await readdir(dir)).sort();
    expect(files).toEqual(['scrollback.log', 'scrollback.log.1']);
    const rot = await readFile(join(dir, 'scrollback.log.1'), 'utf8');
    const cur = await readFile(join(dir, 'scrollback.log'), 'utf8');
    expect(rot).toBe('0123456789abcdef');
    expect(cur).toBe('ZZZ');
  });

  it('readTail across rotation returns last bytes spanning both files in chronological order', () => {
    // maxBytes=10, tailBytes=8: write 12 bytes total ('ABCDEFGHIJKL'), expect last 8 chars
    store = new ScrollbackStore({ baseDir, maxBytes: 10, tailBytes: 8 });
    store.append('t1', 'ABCDEFGHIJ'); // hits 10, rotates this chunk
    store.append('t1', 'KL');         // current = 'KL'
    expect(store.readTail('t1')).toBe('EFGHIJKL');
  });

  it('rotating again overwrites the previous .log.1 (only two files ever)', async () => {
    store = new ScrollbackStore({ baseDir, maxBytes: 4 });
    store.append('t1', 'AAAA'); // rotates -> .log.1 = 'AAAA', current empty
    store.append('t1', 'BBBB'); // rotates -> .log.1 = 'BBBB' (was 'AAAA'), current empty
    store.append('t1', 'CC');
    store.flush('t1');

    const files = (await readdir(join(baseDir, 't1'))).sort();
    expect(files).toEqual(['scrollback.log', 'scrollback.log.1']);
    expect(await readFile(join(baseDir, 't1', 'scrollback.log.1'), 'utf8')).toBe('BBBB');
    expect(await readFile(join(baseDir, 't1', 'scrollback.log'), 'utf8')).toBe('CC');
  });

  it('removeTerminal deletes the on-disk directory', async () => {
    store = new ScrollbackStore({ baseDir });
    store.append('t1', 'data');
    store.flush('t1');
    expect(existsSync(join(baseDir, 't1'))).toBe(true);
    store.removeTerminal('t1');
    expect(existsSync(join(baseDir, 't1'))).toBe(false);
  });

  it('disk usage after 2.5MB writes: exactly two files, total size <= 2.1MB', async () => {
    store = new ScrollbackStore({ baseDir, maxBytes: 1_000_000 });
    const chunk = 'X'.repeat(10_000); // 10KB
    for (let i = 0; i < 250; i++) store.append('t1', chunk); // 2.5MB total
    store.flush('t1');

    const dir = join(baseDir, 't1');
    const files = await readdir(dir);
    expect(files.sort()).toEqual(['scrollback.log', 'scrollback.log.1']);
    let total = 0;
    for (const f of files) total += (await stat(join(dir, f))).size;
    expect(total).toBeLessThanOrEqual(2_100_000);
  });
});
