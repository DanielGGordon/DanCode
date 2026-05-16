import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  defaultLayout,
  validateLayout,
  readLayout,
  writeLayout,
  getLayoutPath,
  removeMissingFiles,
} from '../src/layout.js';

describe('defaultLayout', () => {
  it('returns an empty terminals, openFiles, and a single root pane', () => {
    const l = defaultLayout();
    expect(l).toEqual({
      terminals: [],
      openFiles: [],
      splits: { type: 'leaf', id: 'root' },
      focusedPane: 'root',
    });
  });
});

describe('validateLayout', () => {
  it('accepts a valid default layout', () => {
    const r = validateLayout(defaultLayout());
    expect(r.valid).toBe(true);
  });

  it('rejects unknown top-level fields', () => {
    const bad = { ...defaultLayout(), surprise: 42 };
    const r = validateLayout(bad);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/unknown/i);
  });

  it('rejects non-object payload', () => {
    expect(validateLayout(null).valid).toBe(false);
    expect(validateLayout('hi').valid).toBe(false);
    expect(validateLayout([]).valid).toBe(false);
  });

  it('rejects terminals that are not arrays', () => {
    expect(validateLayout({ ...defaultLayout(), terminals: 'no' }).valid).toBe(false);
  });

  it('rejects terminal entries missing id', () => {
    const bad = {
      ...defaultLayout(),
      terminals: [{ cwd: '/tmp', command: 'bash' }],
    };
    const r = validateLayout(bad);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/id/i);
  });

  it('rejects unknown fields inside a terminal entry', () => {
    const bad = {
      ...defaultLayout(),
      terminals: [{ id: 'a', cwd: '/tmp', command: 'bash', mystery: 1 }],
    };
    expect(validateLayout(bad).valid).toBe(false);
  });

  it('accepts a fully populated layout', () => {
    const good = {
      terminals: [
        { id: 'a', cwd: '/tmp', command: 'bash', claudeSessionId: null, background: false },
        { id: 'b', cwd: '/home', command: 'fish', claudeSessionId: 'abc', background: true },
      ],
      openFiles: [
        { path: 'README.md', pane: 'p1', scrollTop: 0 },
        { path: 'src/index.js', pane: 'p2', scrollTop: 120 },
      ],
      splits: {
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        children: [
          { type: 'leaf', id: 'p1' },
          { type: 'leaf', id: 'p2' },
        ],
      },
      focusedPane: 'p1',
    };
    const r = validateLayout(good);
    expect(r.valid).toBe(true);
  });

  it('rejects splits with unknown direction', () => {
    const bad = {
      ...defaultLayout(),
      splits: {
        type: 'split',
        direction: 'diagonal',
        ratio: 0.5,
        children: [
          { type: 'leaf', id: 'a' },
          { type: 'leaf', id: 'b' },
        ],
      },
    };
    expect(validateLayout(bad).valid).toBe(false);
  });

  it('rejects openFile with missing path', () => {
    const bad = {
      ...defaultLayout(),
      openFiles: [{ pane: 'p1', scrollTop: 0 }],
    };
    expect(validateLayout(bad).valid).toBe(false);
  });
});

describe('layout read/write round-trip', () => {
  let baseDir;
  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'dancode-layout-rw-'));
  });
  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('returns the default layout when none exists yet', async () => {
    const l = await readLayout('demo', baseDir);
    expect(l).toEqual(defaultLayout());
  });

  it('round-trips a layout through writeLayout/readLayout', async () => {
    const l = {
      terminals: [{ id: 'a', cwd: '/tmp', command: 'bash', claudeSessionId: null, background: false }],
      openFiles: [{ path: 'README.md', pane: 'p1', scrollTop: 0 }],
      splits: { type: 'leaf', id: 'p1' },
      focusedPane: 'p1',
    };
    await writeLayout('demo', l, baseDir);
    const read = await readLayout('demo', baseDir);
    expect(read).toEqual(l);
  });

  it('writes via tmp file then renames (no tmp lingering)', async () => {
    await writeLayout('demo', defaultLayout(), baseDir);
    const dir = join(baseDir, 'demo');
    const files = await readdir(dir);
    expect(files).toContain('layout.json');
    expect(files).not.toContain('layout.json.tmp');
  });

  it('creates the per-project directory if it does not exist', async () => {
    await writeLayout('brand-new', defaultLayout(), baseDir);
    expect(existsSync(join(baseDir, 'brand-new', 'layout.json'))).toBe(true);
  });

  it('rejects invalid layouts on write', async () => {
    await expect(writeLayout('demo', { surprise: 1 }, baseDir)).rejects.toThrow();
  });
});

describe('writeLayout atomic under concurrency', () => {
  let baseDir;
  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'dancode-layout-conc-'));
  });
  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('20 parallel writes never produce a torn file', async () => {
    const inputs = [];
    for (let i = 0; i < 20; i++) {
      inputs.push({
        terminals: [{ id: `t${i}`, cwd: `/tmp/${i}`, command: 'bash', claudeSessionId: null, background: false }],
        openFiles: [],
        splits: { type: 'leaf', id: 'root' },
        focusedPane: 'root',
      });
    }
    await Promise.all(inputs.map((l) => writeLayout('race', l, baseDir)));

    const text = await readFile(join(baseDir, 'race', 'layout.json'), 'utf-8');
    const parsed = JSON.parse(text);

    // The final layout must match exactly one of the 20 inputs.
    const idx = inputs.findIndex((l) => JSON.stringify(l) === JSON.stringify(parsed));
    expect(idx).toBeGreaterThanOrEqual(0);
  });
});

describe('removeMissingFiles', () => {
  let projectRoot;
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'dancode-rmmissing-'));
    await mkdir(join(projectRoot, 'sub'), { recursive: true });
    await writeFile(join(projectRoot, 'exists.md'), 'hi');
    await writeFile(join(projectRoot, 'sub', 'present.txt'), 'x');
  });
  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('separates extant and missing files', async () => {
    const layout = {
      ...defaultLayout(),
      openFiles: [
        { path: 'exists.md', pane: 'p1', scrollTop: 0 },
        { path: 'missing.md', pane: 'p2', scrollTop: 5 },
        { path: 'sub/present.txt', pane: 'p3', scrollTop: 0 },
        { path: 'gone/deleted.js', pane: 'p4', scrollTop: 0 },
      ],
    };
    const { layout: cleaned, missing } = await removeMissingFiles(layout, projectRoot);
    expect(missing.map((f) => f.path).sort()).toEqual(['gone/deleted.js', 'missing.md']);
    expect(cleaned.openFiles.map((f) => f.path).sort()).toEqual(['exists.md', 'sub/present.txt']);
  });

  it('returns the layout unchanged if all files exist', async () => {
    const layout = {
      ...defaultLayout(),
      openFiles: [{ path: 'exists.md', pane: 'p1', scrollTop: 0 }],
    };
    const { layout: cleaned, missing } = await removeMissingFiles(layout, projectRoot);
    expect(missing).toEqual([]);
    expect(cleaned).toEqual(layout);
  });
});

describe('getLayoutPath', () => {
  it('returns <baseDir>/<slug>/layout.json', () => {
    expect(getLayoutPath('demo', '/base')).toBe('/base/demo/layout.json');
  });
});
