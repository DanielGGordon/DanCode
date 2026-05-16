import { test, expect } from '@playwright/test';
import { mkdir, writeFile, unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { login, createProject, cleanupProject } from '../e2e/e2e-helpers.js';

/**
 * Phase 4 acceptance E2E: missing-file warning banner.
 *
 * 1. Create a project. Seed it with a file `gone.md`.
 * 2. PUT a layout.json whose openFiles references gone.md.
 * 3. Delete gone.md from disk.
 * 4. Open the project from the sidebar.
 * 5. Assert a [data-testid="missing-file-warning"] banner appears.
 * 6. Click its Close button; assert the banner disappears AND that the
 *    next layout.json on disk no longer references gone.md.
 */

const E2E_HOME = process.env.DANCODE_E2E_HOME || join(homedir(), '.dancode-e2e');

test.describe('Missing-file warning banner (Phase 4)', () => {
  let token;
  const created = [];

  test.afterEach(async ({ request }) => {
    for (const { slug, projectPath } of created) {
      await cleanupProject(request, slug, token, projectPath);
    }
    created.length = 0;
  });

  test('banner shows for deleted file; close button removes it and updates layout.json', async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 720 });

    token = await login(page);
    const proj = await createProject(page, `Missing File ${Date.now()}`);
    created.push(proj);

    // Seed a file, then PUT a layout that references it.
    const gonePath = join(proj.projectPath, 'gone.md');
    await writeFile(gonePath, 'temporary');

    // Capture the default terminals so we can include them in the layout (the
    // schema requires terminal entries to have an id, and the project's stored
    // terminals must round-trip cleanly).
    const defaultTerms = await (await request.get(`/api/terminals?project=${proj.slug}`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();

    const layout = {
      terminals: defaultTerms.map((t) => ({
        id: t.id,
        cwd: t.cwd || proj.projectPath,
        command: t.command || null,
        claudeSessionId: null,
        background: false,
        label: t.label || 'Terminal',
      })),
      openFiles: [{ path: 'gone.md', pane: 'file-0', scrollTop: 0 }],
      splits: { type: 'leaf', id: 'root' },
      focusedPane: defaultTerms[0]?.id || 'root',
    };
    const putRes = await request.put(`/api/projects/${proj.slug}/layout`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: layout,
    });
    expect(putRes.ok()).toBe(true);

    // Now delete the file on disk so the next GET sees it as missing.
    await unlink(gonePath);
    expect(existsSync(gonePath)).toBe(false);

    // Logout/login and reopen the project so the client picks up the layout.
    await page.evaluate(() => localStorage.removeItem('dancode-auth-token'));
    await page.reload();
    token = await login(page);
    await reopenProject(page, proj.slug);

    // Project still loads — terminals are visible.
    await expect(page.getByTestId('terminal-pane-0')).toBeVisible({ timeout: 15000 });

    // Missing-file warning banner appears for gone.md.
    const banner = page.locator('[data-testid="missing-file-warning"]');
    await expect(banner).toBeVisible({ timeout: 15000 });
    await expect(banner).toContainText('gone.md');

    // Click Close.
    const closeBtn = page.locator('[data-testid="missing-file-warning-close"]');
    await closeBtn.click();
    await expect(banner).toBeHidden({ timeout: 10000 });

    // Wait for the layout-PUT debounce (500ms) + RTT to flush, then check
    // that the layout.json on disk no longer references gone.md.
    await page.waitForTimeout(1500);

    // Fetch via API (uses the same temp HOME the server is using).
    const getRes = await request.get(`/api/projects/${proj.slug}/layout`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.ok()).toBe(true);
    const updated = await getRes.json();
    const paths = (updated.openFiles || []).map((f) => f.path);
    expect(paths).not.toContain('gone.md');
  });
});

async function reopenProject(page, slug) {
  const sidebarEntry = page.getByTestId(`sidebar-project-${slug}`);
  await sidebarEntry.waitFor({ state: 'visible', timeout: 15000 });
  await sidebarEntry.click();
}
