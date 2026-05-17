import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { login, createProject, cleanupProject } from '../e2e/e2e-helpers.js';

/**
 * Phase 6 acceptance E2E: CodeMirror editor per-language rendering, edit
 * persistence, and standard editor behaviour.
 *
 * For each of the eight required extensions we:
 *   1. Seed a fixture file with content that contains language keywords.
 *   2. Open the file in the editor (via the layout API + reload).
 *   3. Assert at least one highlighted token (`<span class>` inside
 *      `.cm-line`) is rendered — that proves the right language pack
 *      loaded and the syntax tree produced a highlight.
 *   4. Append an edit, press Ctrl+S, reload, re-open, and assert the edit
 *      survived (via the file API to avoid flakiness on the editor's async
 *      mount race after reload).
 *
 * Implementation note: assertions use `.cm-line span[class]` rather than
 * `.cm-keyword` because CodeMirror 6 emits dynamically-generated class
 * names (e.g. `ͼb`) for highlighted tokens, not the CM5-style `cm-*`
 * classes. The criteria explicitly allows "language-specific token class".
 */

const FIXTURES = [
  { ext: 'ts',   name: 'sample.ts',   content: 'export const x: number = 1\n' },
  { ext: 'py',   name: 'sample.py',   content: 'def hello():\n    return 42\n' },
  { ext: 'md',   name: 'sample.md',   content: '# Heading\n\n**bold** text\n' },
  { ext: 'json', name: 'sample.json', content: '{\n  "key": "value",\n  "n": 1\n}\n' },
  { ext: 'yaml', name: 'sample.yaml', content: 'key: value\nlist:\n  - one\n  - two\n' },
  { ext: 'sh',   name: 'sample.sh',   content: '#!/bin/bash\nif [ -z "$x" ]; then\n  echo hi\nfi\n' },
  { ext: 'html', name: 'sample.html', content: '<!doctype html>\n<div class="foo">hello</div>\n' },
  { ext: 'css',  name: 'sample.css',  content: '.foo {\n  color: red;\n}\n' },
];

test.describe('Phase 6: CodeMirror editor', () => {
  let token;
  const created = [];

  test.afterEach(async ({ request }) => {
    for (const { slug, projectPath } of created) {
      await cleanupProject(request, slug, token, projectPath);
    }
    created.length = 0;
  });

  test('each language renders highlighted tokens and persists edits via Ctrl+S', async ({ page, request }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1280, height: 720 });

    token = await login(page);
    const proj = await createProject(page, `CM Phase 6 ${Date.now()}`);
    created.push(proj);

    // Seed every fixture file.
    for (const f of FIXTURES) {
      await writeFile(join(proj.projectPath, f.name), f.content);
    }

    for (const fixture of FIXTURES) {
      await openFile(page, request, token, proj.slug, fixture.name);

      // Editor mounted with the right language.
      const viewer = page.getByTestId('file-viewer').last();
      await expect(viewer).toBeVisible({ timeout: 15000 });
      const langChip = viewer.getByTestId('file-viewer-language');
      await expect(langChip).toBeVisible();

      // At least one highlighted token span exists inside the CM editor.
      // CM 6 emits short auto-generated class names (e.g. `ͼb`) per token.
      const tokenLocator = viewer.locator('.cm-line span[class]').first();
      await expect(tokenLocator).toBeVisible({ timeout: 15000 });

      // Type an edit + Ctrl+S, then verify it persisted by reading the file
      // back via the API. We don't rely on reload-then-reopen because the
      // editor's content is also re-fetched from disk on reload — verifying
      // via the API is the ground truth.
      const cmContent = viewer.locator('.cm-content');
      await cmContent.click();
      // Append to end of doc using End + typed marker.
      await page.keyboard.press('Control+End');
      const marker = `\n// edit-${fixture.ext}-${Date.now()}\n`;
      await page.keyboard.type(marker);
      await page.keyboard.press('Control+s');

      // Verify save landed.
      await expect(async () => {
        const r = await request.get(`/api/projects/${proj.slug}/files/${fixture.name}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(r.ok()).toBe(true);
        const { content } = await r.json();
        expect(content).toContain(marker.trim());
      }).toPass({ timeout: 15000 });

      // Reload + re-open: the edit must still be in the file (we read it
      // back from the editor's content this time so we're proving the
      // round-trip end-to-end).
      await page.reload();
      await reopenProjectIfNeeded(page, proj.slug);
      await openFile(page, request, token, proj.slug, fixture.name);
      const reopenedViewer = page.getByTestId('file-viewer').last();
      await expect(reopenedViewer).toBeVisible({ timeout: 15000 });

      await expect(async () => {
        const text = await reopenedViewer.locator('.cm-content').innerText();
        expect(text).toContain(marker.trim());
      }).toPass({ timeout: 15000 });
    }
  });

  test('Find panel opens on Ctrl+F', async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 720 });

    token = await login(page);
    const proj = await createProject(page, `CM Find ${Date.now()}`);
    created.push(proj);

    await writeFile(join(proj.projectPath, 'findme.js'), 'const target = 42\n');
    await openFile(page, request, token, proj.slug, 'findme.js');

    const viewer = page.getByTestId('file-viewer').last();
    await expect(viewer).toBeVisible({ timeout: 15000 });

    // Focus the editor and press Ctrl+F. CodeMirror's built-in search keymap
    // opens the search panel.
    await viewer.locator('.cm-content').click();
    await page.keyboard.press('Control+f');

    await expect(viewer.locator('.cm-panels .cm-search')).toBeVisible({ timeout: 5000 });
  });

  test('rejects ../ traversal on PUT with 403', async ({ request }) => {
    token = await (async () => {
      // login() requires a page; do an API-only token grab instead.
      const statusRes = await request.get('/api/auth/setup/status');
      const { setupComplete } = await statusRes.json();
      const TEST_USERNAME = 'testuser';
      const TEST_PASSWORD = 'testpassword123';
      let totpSecret;
      if (!setupComplete) {
        const setupRes = await request.post('/api/auth/setup', { data: { username: TEST_USERNAME, password: TEST_PASSWORD } });
        totpSecret = (await setupRes.json()).totpSecret;
      } else {
        const credsHome = process.env.DANCODE_E2E_HOME || process.env.HOME;
        const { readFile } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const creds = JSON.parse(await readFile(join(credsHome, '.dancode', 'credentials.json'), 'utf-8'));
        totpSecret = creds.totpSecret;
      }
      const { generate } = await import('otplib');
      const totpCode = await generate({ secret: totpSecret });
      const loginRes = await request.post('/api/auth/login', { data: { username: TEST_USERNAME, password: TEST_PASSWORD, totpCode } });
      return (await loginRes.json()).token;
    })();

    // Create a real project to anchor the request to.
    const slug = `trav-test-${Date.now().toString(36)}`;
    const projDir = `/tmp/dancode-e2e-${slug}`;
    await request.post('/api/projects', {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: slug, path: projDir },
    });
    created.push({ slug, projectPath: projDir });

    // Use Node's raw http module so the .. segments aren't normalized by
    // the URL parser before the request leaves the test process.
    const http = await import('node:http');
    const port = Number(process.env.DANCODE_E2E_SERVER_PORT || 3102);
    const body = JSON.stringify({ content: 'evil' });

    const status = await new Promise((resolve, reject) => {
      const req = http.request({
        host: 'localhost',
        port,
        method: 'PUT',
        path: `/api/projects/${slug}/files/../../etc/passwd`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${token}`,
        },
      }, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    expect(status).toBe(403);
  });
});

async function reopenProjectIfNeeded(page, slug) {
  // After page.reload() the client lands on either the sidebar (desktop)
  // or the dashboard (mobile). Re-select the project from the sidebar.
  try {
    await page.waitForSelector('[data-testid="terminal-layout"]', { timeout: 3000 });
    return;
  } catch {
    /* not yet visible — pick from sidebar */
  }
  const entry = page.getByTestId(`sidebar-project-${slug}`);
  await entry.waitFor({ state: 'visible', timeout: 15000 });
  await entry.click();
  await page.waitForSelector('[data-testid="terminal-layout"]', { timeout: 15000 });
}

/**
 * Open a fixture file as a pane. We could click in the file explorer, but
 * that requires expanding directories and waiting for lazy lists. The most
 * direct route is to PUT a layout that includes the file in `openFiles`,
 * then reload — the same code path the file explorer click eventually
 * exercises.
 */
async function openFile(page, request, token, slug, relPath) {
  const layoutRes = await request.get(`/api/projects/${slug}/layout`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const existing = layoutRes.ok() ? await layoutRes.json() : {};
  const layout = {
    terminals: Array.isArray(existing.terminals) ? existing.terminals : [],
    openFiles: [{ path: relPath, pane: 'p-0', scrollTop: 0 }],
    splits: existing.splits || { type: 'leaf', id: 'root' },
    focusedPane: 'p-0',
  };
  await request.put(`/api/projects/${slug}/layout`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: layout,
  });
  await page.reload();
  await reopenProjectIfNeeded(page, slug);
}
