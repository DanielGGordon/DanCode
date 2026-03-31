import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  safePath,
  listDirectory,
  readFileContent,
  writeFileContent,
  createDirectory,
  renameFile,
  deleteFile,
  clearGitignoreCache,
  getGitignoreCache,
} from '../src/files.js';

let testRoot;

beforeEach(async () => {
  testRoot = join(tmpdir(), `dancode-files-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testRoot, { recursive: true });
});

afterEach(async () => {
  clearGitignoreCache();
  await rm(testRoot, { recursive: true, force: true });
});

// ---------- safePath ----------

describe('safePath', () => {
  it('resolves a simple relative path', async () => {
    await writeFile(join(testRoot, 'file.txt'), 'hello');
    const result = await safePath(testRoot, 'file.txt');
    expect(result).toBe(join(testRoot, 'file.txt'));
  });

  it('resolves "." to the project root', async () => {
    const result = await safePath(testRoot, '.');
    expect(result).toBe(testRoot);
  });

  it('rejects ../ traversal', async () => {
    await expect(safePath(testRoot, '../etc/passwd')).rejects.toThrow();
    try {
      await safePath(testRoot, '../etc/passwd');
    } catch (err) {
      expect(err.code).toBe('TRAVERSAL');
    }
  });

  it('rejects deeply nested ../ traversal', async () => {
    await mkdir(join(testRoot, 'a', 'b'), { recursive: true });
    await expect(safePath(testRoot, 'a/b/../../../etc')).rejects.toThrow();
  });

  it('rejects absolute paths outside the root', async () => {
    await expect(safePath(testRoot, '/etc/passwd')).rejects.toThrow();
  });

  it('rejects symlinks pointing outside project', async () => {
    const outsideDir = join(tmpdir(), `dancode-outside-${Date.now()}`);
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, 'secret.txt'), 'secret');
    await symlink(outsideDir, join(testRoot, 'escape-link'));

    await expect(safePath(testRoot, 'escape-link')).rejects.toThrow();

    await rm(outsideDir, { recursive: true, force: true });
  });

  it('allows symlinks within the project', async () => {
    await mkdir(join(testRoot, 'real'));
    await writeFile(join(testRoot, 'real', 'file.txt'), 'data');
    await symlink(join(testRoot, 'real'), join(testRoot, 'link'));

    const result = await safePath(testRoot, 'link');
    expect(result).toBe(join(testRoot, 'link'));
  });
});

// ---------- listDirectory ----------

describe('listDirectory', () => {
  it('lists files and directories with metadata', async () => {
    await writeFile(join(testRoot, 'file.txt'), 'hello');
    await mkdir(join(testRoot, 'subdir'));

    const entries = await listDirectory(testRoot, '.');
    expect(entries).toHaveLength(2);

    const dir = entries.find((e) => e.name === 'subdir');
    expect(dir).toBeDefined();
    expect(dir.type).toBe('directory');

    const file = entries.find((e) => e.name === 'file.txt');
    expect(file).toBeDefined();
    expect(file.type).toBe('file');
    expect(file.size).toBe(5);
    expect(file.modified).toBeTruthy();
  });

  it('sorts directories before files', async () => {
    await writeFile(join(testRoot, 'aaa.txt'), 'a');
    await mkdir(join(testRoot, 'zzz'));

    const entries = await listDirectory(testRoot, '.');
    expect(entries[0].name).toBe('zzz');
    expect(entries[1].name).toBe('aaa.txt');
  });

  it('hides dotfiles by default', async () => {
    await writeFile(join(testRoot, '.hidden'), 'secret');
    await writeFile(join(testRoot, 'visible.txt'), 'hello');

    const entries = await listDirectory(testRoot, '.');
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('visible.txt');
  });

  it('shows dotfiles when showHidden is true', async () => {
    await writeFile(join(testRoot, '.hidden'), 'secret');
    await writeFile(join(testRoot, 'visible.txt'), 'hello');

    const entries = await listDirectory(testRoot, '.', { showHidden: true });
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.find((e) => e.name === '.hidden')).toBeDefined();
  });

  it('respects .gitignore patterns', async () => {
    await writeFile(join(testRoot, '.gitignore'), 'node_modules/\n*.log\n');
    await mkdir(join(testRoot, 'node_modules'));
    await writeFile(join(testRoot, 'debug.log'), 'log data');
    await writeFile(join(testRoot, 'app.js'), 'code');

    const entries = await listDirectory(testRoot, '.', { showHidden: true });
    const names = entries.map((e) => e.name);
    expect(names).toContain('app.js');
    expect(names).toContain('.gitignore');
    expect(names).not.toContain('node_modules');
    expect(names).not.toContain('debug.log');
  });

  it('shows gitignored files when showIgnored is true', async () => {
    await writeFile(join(testRoot, '.gitignore'), 'node_modules/\n');
    await mkdir(join(testRoot, 'node_modules'));
    await writeFile(join(testRoot, 'app.js'), 'code');

    const entries = await listDirectory(testRoot, '.', { showHidden: true, showIgnored: true });
    const names = entries.map((e) => e.name);
    expect(names).toContain('node_modules');
    expect(names).toContain('app.js');
  });

  it('hides .git directory by default', async () => {
    await mkdir(join(testRoot, '.git'));
    await writeFile(join(testRoot, 'file.txt'), 'hello');

    const entries = await listDirectory(testRoot, '.', { showHidden: true });
    const names = entries.map((e) => e.name);
    expect(names).not.toContain('.git');
  });

  it('rejects path traversal in directory path', async () => {
    await expect(listDirectory(testRoot, '../')).rejects.toThrow();
  });
});

// ---------- readFileContent ----------

describe('readFileContent', () => {
  it('reads a text file', async () => {
    await writeFile(join(testRoot, 'hello.txt'), 'Hello, World!');
    const content = await readFileContent(testRoot, 'hello.txt');
    expect(content).toBe('Hello, World!');
  });

  it('rejects reading a directory', async () => {
    await mkdir(join(testRoot, 'dir'));
    await expect(readFileContent(testRoot, 'dir')).rejects.toThrow('Cannot read a directory');
  });

  it('rejects files larger than 1MB', async () => {
    const bigContent = 'x'.repeat(1024 * 1024 + 1);
    await writeFile(join(testRoot, 'big.txt'), bigContent);
    await expect(readFileContent(testRoot, 'big.txt')).rejects.toThrow('1MB');
  });

  it('rejects path traversal', async () => {
    await expect(readFileContent(testRoot, '../../etc/passwd')).rejects.toThrow();
  });

  it('throws for non-existent files', async () => {
    await expect(readFileContent(testRoot, 'missing.txt')).rejects.toThrow();
  });
});

// ---------- writeFileContent ----------

describe('writeFileContent', () => {
  it('writes a new file', async () => {
    await writeFileContent(testRoot, 'new.txt', 'New content');
    const content = await readFileContent(testRoot, 'new.txt');
    expect(content).toBe('New content');
  });

  it('overwrites an existing file', async () => {
    await writeFile(join(testRoot, 'file.txt'), 'old');
    await writeFileContent(testRoot, 'file.txt', 'new');
    const content = await readFileContent(testRoot, 'file.txt');
    expect(content).toBe('new');
  });

  it('creates parent directories', async () => {
    await writeFileContent(testRoot, 'deep/nested/file.txt', 'deep content');
    const content = await readFileContent(testRoot, 'deep/nested/file.txt');
    expect(content).toBe('deep content');
  });

  it('rejects path traversal', async () => {
    await expect(writeFileContent(testRoot, '../escape.txt', 'bad')).rejects.toThrow();
  });
});

// ---------- createDirectory ----------

describe('createDirectory', () => {
  it('creates a new directory', async () => {
    await createDirectory(testRoot, 'newdir');
    expect(existsSync(join(testRoot, 'newdir'))).toBe(true);
  });

  it('creates nested directories', async () => {
    await createDirectory(testRoot, 'a/b/c');
    expect(existsSync(join(testRoot, 'a/b/c'))).toBe(true);
  });

  it('rejects path traversal', async () => {
    await expect(createDirectory(testRoot, '../escaped')).rejects.toThrow();
  });
});

// ---------- renameFile ----------

describe('renameFile', () => {
  it('renames a file', async () => {
    await writeFile(join(testRoot, 'old.txt'), 'content');
    await renameFile(testRoot, 'old.txt', 'new.txt');

    expect(existsSync(join(testRoot, 'old.txt'))).toBe(false);
    expect(existsSync(join(testRoot, 'new.txt'))).toBe(true);
  });

  it('moves a file to a subdirectory', async () => {
    await writeFile(join(testRoot, 'file.txt'), 'content');
    await renameFile(testRoot, 'file.txt', 'sub/file.txt');

    expect(existsSync(join(testRoot, 'file.txt'))).toBe(false);
    expect(existsSync(join(testRoot, 'sub/file.txt'))).toBe(true);
  });

  it('renames a directory', async () => {
    await mkdir(join(testRoot, 'olddir'));
    await renameFile(testRoot, 'olddir', 'newdir');

    expect(existsSync(join(testRoot, 'olddir'))).toBe(false);
    expect(existsSync(join(testRoot, 'newdir'))).toBe(true);
  });

  it('rejects path traversal on source', async () => {
    await expect(renameFile(testRoot, '../escape', 'dest')).rejects.toThrow();
  });

  it('rejects path traversal on destination', async () => {
    await writeFile(join(testRoot, 'file.txt'), 'content');
    await expect(renameFile(testRoot, 'file.txt', '../escape.txt')).rejects.toThrow();
  });
});

// ---------- deleteFile ----------

describe('deleteFile', () => {
  it('deletes a file', async () => {
    await writeFile(join(testRoot, 'file.txt'), 'content');
    await deleteFile(testRoot, 'file.txt');
    expect(existsSync(join(testRoot, 'file.txt'))).toBe(false);
  });

  it('deletes a directory recursively', async () => {
    await mkdir(join(testRoot, 'dir/sub'), { recursive: true });
    await writeFile(join(testRoot, 'dir/sub/file.txt'), 'content');
    await deleteFile(testRoot, 'dir');
    expect(existsSync(join(testRoot, 'dir'))).toBe(false);
  });

  it('rejects deleting the project root', async () => {
    await expect(deleteFile(testRoot, '.')).rejects.toThrow('project root');
  });

  it('rejects path traversal', async () => {
    await expect(deleteFile(testRoot, '../somefile')).rejects.toThrow();
  });
});

// ---------- gitignore cache ----------

describe('gitignore cache', () => {
  it('reuses cached ignore instance within TTL window', async () => {
    await writeFile(join(testRoot, '.gitignore'), 'node_modules/\n');
    await mkdir(join(testRoot, 'node_modules'));
    await writeFile(join(testRoot, 'app.js'), 'code');

    // First call populates the cache
    await listDirectory(testRoot, '.');
    const cache = getGitignoreCache();
    expect(cache.size).toBe(1);

    const firstEntry = [...cache.values()][0];
    const firstIg = firstEntry.ig;

    // Second call should reuse the cached instance
    await listDirectory(testRoot, '.');
    const secondEntry = [...cache.values()][0];
    expect(secondEntry.ig).toBe(firstIg);
  });

  it('no re-read of .gitignore within TTL window', async () => {
    await writeFile(join(testRoot, '.gitignore'), 'node_modules/\n');
    await mkdir(join(testRoot, 'node_modules'));
    await writeFile(join(testRoot, 'app.js'), 'code');

    // First listing: node_modules excluded
    const entries1 = await listDirectory(testRoot, '.', { showHidden: true });
    expect(entries1.map(e => e.name)).not.toContain('node_modules');

    // Modify .gitignore to allow node_modules — but cache should still exclude it
    await writeFile(join(testRoot, '.gitignore'), '# nothing ignored\n');

    const entries2 = await listDirectory(testRoot, '.', { showHidden: true });
    // Cache still in effect — node_modules should still be excluded
    expect(entries2.map(e => e.name)).not.toContain('node_modules');
  });

  it('invalidates cache after TTL expires', async () => {
    vi.useFakeTimers();

    try {
      await writeFile(join(testRoot, '.gitignore'), 'node_modules/\n');
      await mkdir(join(testRoot, 'node_modules'));
      await writeFile(join(testRoot, 'app.js'), 'code');

      // First listing: node_modules excluded
      await listDirectory(testRoot, '.', { showHidden: true });

      // Modify .gitignore to allow node_modules
      await writeFile(join(testRoot, '.gitignore'), '# nothing ignored\n');

      // Advance time past the 30s TTL
      vi.advanceTimersByTime(31_000);

      // Now node_modules should appear (cache invalidated, .gitignore re-read)
      const entries = await listDirectory(testRoot, '.', { showHidden: true });
      expect(entries.map(e => e.name)).toContain('node_modules');
    } finally {
      vi.useRealTimers();
    }
  });

  it('caches per project root independently', async () => {
    const testRoot2 = join(tmpdir(), `dancode-files-test2-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testRoot2, { recursive: true });

    try {
      await writeFile(join(testRoot, '.gitignore'), '*.log\n');
      await writeFile(join(testRoot, 'debug.log'), 'log');
      await writeFile(join(testRoot, 'app.js'), 'code');

      await writeFile(join(testRoot2, '.gitignore'), '*.txt\n');
      await writeFile(join(testRoot2, 'notes.txt'), 'notes');
      await writeFile(join(testRoot2, 'app.js'), 'code');

      await listDirectory(testRoot, '.');
      await listDirectory(testRoot2, '.');

      const cache = getGitignoreCache();
      expect(cache.size).toBe(2);
    } finally {
      await rm(testRoot2, { recursive: true, force: true });
    }
  });

  it('showIgnored bypasses cache usage', async () => {
    await writeFile(join(testRoot, '.gitignore'), 'node_modules/\n');
    await mkdir(join(testRoot, 'node_modules'));
    await writeFile(join(testRoot, 'app.js'), 'code');

    // showIgnored=true should not use the cache
    const entries = await listDirectory(testRoot, '.', { showHidden: true, showIgnored: true });
    const names = entries.map(e => e.name);
    expect(names).toContain('node_modules');
    expect(names).toContain('app.js');
  });
});
