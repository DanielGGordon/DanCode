import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import {
  slugify,
  getProjectsDir,
  getProjectConfigPath,
  validateProjectInput,
  resolvePath,
  createProject,
  listProjects,
  getProject,
  deleteProject,
  isValidSlug,
} from '../src/projects.js';

describe('slugify', () => {
  it('converts name to lowercase with hyphens', () => {
    expect(slugify('My Project')).toBe('my-project');
  });

  it('replaces multiple spaces with a single hyphen', () => {
    expect(slugify('My   Cool   Project')).toBe('my-cool-project');
  });

  it('removes non-alphanumeric characters', () => {
    expect(slugify('Project @#$ Name!')).toBe('project-name');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugify('---hello---')).toBe('hello');
  });

  it('handles already-slugified names', () => {
    expect(slugify('my-project')).toBe('my-project');
  });

  it('returns empty string for non-alphanumeric input', () => {
    expect(slugify('!!!')).toBe('');
  });

  it('handles numbers', () => {
    expect(slugify('Project 42')).toBe('project-42');
  });
});

describe('getProjectsDir', () => {
  it('returns ~/.dancode/projects', () => {
    expect(getProjectsDir()).toBe(join(homedir(), '.dancode', 'projects'));
  });
});

describe('getProjectConfigPath', () => {
  it('returns <dir>/<slug>.json', () => {
    expect(getProjectConfigPath('my-project', '/tmp/projects')).toBe('/tmp/projects/my-project.json');
  });

  it('uses default projects dir when no dir is given', () => {
    const expected = join(homedir(), '.dancode', 'projects', 'test.json');
    expect(getProjectConfigPath('test')).toBe(expected);
  });
});

describe('resolvePath', () => {
  it('expands ~ to home directory', () => {
    expect(resolvePath('~/projects')).toBe(join(homedir(), 'projects'));
  });

  it('expands bare ~ to home directory', () => {
    expect(resolvePath('~')).toBe(homedir());
  });

  it('leaves absolute paths unchanged', () => {
    expect(resolvePath('/tmp/foo')).toBe('/tmp/foo');
  });
});

describe('validateProjectInput', () => {
  it('accepts valid name and path', () => {
    expect(validateProjectInput('My Project', '/tmp/foo')).toEqual({ valid: true });
  });

  it('accepts path starting with ~', () => {
    expect(validateProjectInput('Test', '~/projects/test')).toEqual({ valid: true });
  });

  it('rejects missing name', () => {
    const result = validateProjectInput('', '/tmp/foo');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('name');
  });

  it('rejects null name', () => {
    const result = validateProjectInput(null, '/tmp/foo');
    expect(result.valid).toBe(false);
  });

  it('rejects whitespace-only name', () => {
    const result = validateProjectInput('   ', '/tmp/foo');
    expect(result.valid).toBe(false);
  });

  it('rejects name with no alphanumeric characters', () => {
    const result = validateProjectInput('!!!', '/tmp/foo');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('alphanumeric');
  });

  it('rejects missing path', () => {
    const result = validateProjectInput('Test', '');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('path');
  });

  it('rejects relative path', () => {
    const result = validateProjectInput('Test', 'relative/path');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('absolute');
  });

  it('rejects ~user paths that resolvePath cannot expand', () => {
    const result = validateProjectInput('Test', '~other/project');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('absolute');
  });
});

describe('project config CRUD', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dancode-projects-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('createProject', () => {
    it('creates a config file with correct fields', async () => {
      const project = await createProject('My Project', '/tmp/test', tempDir);

      expect(project.name).toBe('My Project');
      expect(project.slug).toBe('my-project');
      expect(project.path).toBe('/tmp/test');
      expect(project.createdAt).toBeDefined();

      const configPath = getProjectConfigPath('my-project', tempDir);
      expect(existsSync(configPath)).toBe(true);

      const content = JSON.parse(await readFile(configPath, 'utf-8'));
      expect(content.name).toBe('My Project');
    });

    it('creates the projects directory if it does not exist', async () => {
      const nestedDir = join(tempDir, 'nested', 'projects');
      const project = await createProject('Test', '/tmp/test', nestedDir);

      expect(project.slug).toBe('test');
      expect(existsSync(join(nestedDir, 'test.json'))).toBe(true);
    });

    it('trims name and path', async () => {
      const project = await createProject('  Spaced  ', '  /tmp/test  ', tempDir);
      expect(project.name).toBe('Spaced');
      expect(project.path).toBe('/tmp/test');
    });

    it('resolves ~ in path', async () => {
      const project = await createProject('Test', '~/projects/test', tempDir);
      expect(project.path).toBe(join(homedir(), 'projects/test'));
    });

    it('creates the project directory if it does not exist', async () => {
      const projectDir = join(tempDir, 'new-project-dir');
      expect(existsSync(projectDir)).toBe(false);
      await createProject('Dir Test', projectDir, tempDir);
      expect(existsSync(projectDir)).toBe(true);
    });

    it('succeeds if the project directory already exists', async () => {
      const projectDir = join(tempDir, 'existing-dir');
      await mkdir(projectDir, { recursive: true });
      const project = await createProject('Existing Dir', projectDir, tempDir);
      expect(project.path).toBe(projectDir);
      expect(existsSync(projectDir)).toBe(true);
    });

    it('throws on duplicate project name', async () => {
      await createProject('Duplicate', '/tmp/a', tempDir);
      await expect(createProject('Duplicate', '/tmp/b', tempDir))
        .rejects.toThrow('already exists');
    });

    it('throws on invalid inputs', async () => {
      await expect(createProject('', '/tmp/test', tempDir))
        .rejects.toThrow('name is required');
      await expect(createProject('Valid', 'relative', tempDir))
        .rejects.toThrow('absolute');
      await expect(createProject('!!!', '/tmp/test', tempDir))
        .rejects.toThrow('alphanumeric');
    });

    it('throws on duplicate slug (different casing)', async () => {
      await createProject('My Project', '/tmp/a', tempDir);
      await expect(createProject('MY PROJECT', '/tmp/b', tempDir))
        .rejects.toThrow('already exists');
    });
  });

  describe('listProjects', () => {
    it('returns empty array when no projects exist', async () => {
      const projects = await listProjects(tempDir);
      expect(projects).toEqual([]);
    });

    it('returns empty array when directory does not exist', async () => {
      const projects = await listProjects(join(tempDir, 'nonexistent'));
      expect(projects).toEqual([]);
    });

    it('skips non-JSON files in the projects directory', async () => {
      await createProject('Only One', '/tmp/only', tempDir);
      await writeFile(join(tempDir, 'README.txt'), 'not a project');
      await writeFile(join(tempDir, '.hidden'), 'ignore me');

      const projects = await listProjects(tempDir);
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('Only One');
    });

    it('skips malformed JSON config files', async () => {
      await createProject('Valid', '/tmp/valid', tempDir);
      await writeFile(join(tempDir, 'broken.json'), '{invalid json!!!');

      const projects = await listProjects(tempDir);
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('Valid');
    });

    it('returns all projects sorted by name', async () => {
      await createProject('Zebra', '/tmp/z', tempDir);
      await createProject('Alpha', '/tmp/a', tempDir);
      await createProject('Middle', '/tmp/m', tempDir);

      const projects = await listProjects(tempDir);
      expect(projects).toHaveLength(3);
      expect(projects[0].name).toBe('Alpha');
      expect(projects[1].name).toBe('Middle');
      expect(projects[2].name).toBe('Zebra');
    });
  });

  describe('getProject', () => {
    it('returns project by slug', async () => {
      await createProject('Test Project', '/tmp/test', tempDir);
      const project = await getProject('test-project', tempDir);
      expect(project.name).toBe('Test Project');
    });

    it('returns null for non-existent project', async () => {
      const project = await getProject('nonexistent', tempDir);
      expect(project).toBeNull();
    });

    it('rejects path-traversal slugs', async () => {
      await expect(getProject('../etc', tempDir)).rejects.toThrow('Invalid project slug');
      await expect(getProject('foo/bar', tempDir)).rejects.toThrow('Invalid project slug');
    });
  });

  describe('deleteProject', () => {
    it('removes config file and returns true', async () => {
      await createProject('ToDelete', '/tmp/del', tempDir);
      const result = await deleteProject('todelete', tempDir);
      expect(result).toBe(true);
      expect(existsSync(getProjectConfigPath('todelete', tempDir))).toBe(false);
    });

    it('returns false for non-existent project', async () => {
      const result = await deleteProject('nonexistent', tempDir);
      expect(result).toBe(false);
    });

    it('rejects path-traversal slugs', async () => {
      await expect(deleteProject('../etc', tempDir)).rejects.toThrow('Invalid project slug');
      await expect(deleteProject('..%2Fauth', tempDir)).rejects.toThrow('Invalid project slug');
      await expect(deleteProject('foo/bar', tempDir)).rejects.toThrow('Invalid project slug');
    });
  });

  describe('isValidSlug', () => {
    it('accepts valid slugs', () => {
      expect(isValidSlug('my-project')).toBe(true);
      expect(isValidSlug('test')).toBe(true);
      expect(isValidSlug('project-42')).toBe(true);
    });

    it('rejects path traversal attempts', () => {
      expect(isValidSlug('../etc')).toBe(false);
      expect(isValidSlug('foo/bar')).toBe(false);
      expect(isValidSlug('..%2Fauth')).toBe(false);
    });

    it('rejects empty or non-string values', () => {
      expect(isValidSlug('')).toBe(false);
      expect(isValidSlug(null)).toBe(false);
      expect(isValidSlug(undefined)).toBe(false);
    });

    it('rejects slugs with leading or trailing hyphens', () => {
      expect(isValidSlug('-leading')).toBe(false);
      expect(isValidSlug('trailing-')).toBe(false);
    });
  });
});
