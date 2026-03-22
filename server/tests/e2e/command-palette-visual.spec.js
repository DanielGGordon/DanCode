import { test, expect } from './fixture.js';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PROJECT_NAME = `Visual Palette ${Date.now()}`;

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function login(page) {
  const tokenPath = join(homedir(), '.dancode', 'auth-token');
  const token = (await readFile(tokenPath, 'utf-8')).trim();

  await page.goto('/');
  const tokenInput = page.getByTestId('token-input');
  await expect(tokenInput).toBeVisible();
  await tokenInput.fill(token);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('new-project-button')).toBeVisible();

  return token;
}

async function createProject(page, name) {
  const slug = slugify(name);
  const projectPath = `/tmp/dancode-visual-palette-${slug}-${Date.now()}`;

  await page.getByTestId('new-project-button').click();
  const form = page.getByTestId('new-project-form');
  await expect(form).toBeVisible();

  await page.getByTestId('project-name-input').fill(name);
  const pathInput = page.getByTestId('project-path-input');
  await pathInput.clear();
  await pathInput.fill(projectPath);
  await page.getByTestId('new-project-submit').click();

  await expect(page.locator(`[data-testid="terminal"][data-slug="${slug}"]`).first()).toBeVisible({ timeout: 15000 });

  return { slug, projectPath };
}

test.describe('Command palette visual', () => {
  let slug;
  let token;
  let projectPath;

  test.afterEach(async ({ request }) => {
    if (!token || !slug) return;

    try {
      await request.delete(`/api/projects/${slug}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* best-effort */ }
    try {
      await execFileAsync('tmux', ['kill-session', '-t', `dancode-${slug}`]);
    } catch { /* session may not exist */ }
    if (projectPath) {
      try {
        await rm(projectPath, { recursive: true, force: true });
      } catch { /* best-effort */ }
    }
  });

  test('command palette passes visual assertion', async ({ page, aiAssert }) => {
    token = await login(page);

    // Create a project so the palette has items to display
    ({ slug, projectPath } = await createProject(page, PROJECT_NAME));

    // Defocus terminal so Ctrl+K is not captured by xterm
    await page.locator('header').click();

    // Open command palette
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await expect(page.getByTestId('command-palette-input')).toBeVisible();

    await aiAssert('a command palette overlay is centered on the screen with a search input and a list of projects', undefined, {
      domIncluded: true,
      screenshotIncluded: true,
    });
  });
});
