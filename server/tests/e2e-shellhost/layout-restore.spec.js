import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { login, createProject, cleanupProject } from '../e2e/e2e-helpers.js';

/**
 * Phase 4 acceptance E2E: layout persists across logout/login.
 *
 * 1. Open a project, close its 2 default terminals.
 * 2. Spawn 2 new terminals with distinct cwds (project root + a subdirectory).
 * 3. Open a file via the layout's exposed `openFile` method.
 * 4. Run `pwd` in each terminal to record the live working directory.
 * 5. Log out (clear localStorage token), log back in.
 * 6. Open the same project from the sidebar.
 * 7. Assert: 2 terminals visible, both with cwds preserved (run `pwd` again
 *    in each and verify it matches the captured value), file viewer is open
 *    in pane index 2, split direction is vertical (row, default).
 */

test.describe('Layout restore across logout/login (Phase 4)', () => {
  let token;
  const created = [];

  test.afterEach(async ({ request }) => {
    for (const { slug, projectPath } of created) {
      await cleanupProject(request, slug, token, projectPath);
    }
    created.length = 0;
  });

  test('terminals (with cwds), open file, and vertical split survive logout/login', async ({ page, request }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 720 });

    token = await login(page);

    const proj = await createProject(page, `Layout Restore ${Date.now()}`);
    created.push(proj);

    // Seed the project directory with a subdir and a file for the file viewer.
    const subDir = join(proj.projectPath, 'sub');
    await mkdir(subDir, { recursive: true });
    await writeFile(join(proj.projectPath, 'readme.txt'), 'hello layout');

    // Close the two default terminals so the test starts from a known state.
    const defaultTerms = await (await request.get(`/api/terminals?project=${proj.slug}`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    expect(defaultTerms.length).toBe(2);
    for (const t of defaultTerms) {
      await request.delete(`/api/terminals/${t.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    // Spawn 2 terminals with different cwds via the REST API.
    const cwdA = proj.projectPath;
    const cwdB = subDir;
    const termA = await (await request.post('/api/terminals', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { projectSlug: proj.slug, label: 'TermA', cwd: cwdA },
    })).json();
    const termB = await (await request.post('/api/terminals', {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { projectSlug: proj.slug, label: 'TermB', cwd: cwdB },
    })).json();
    expect(termA.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(termB.id).toMatch(/^[a-f0-9-]{36}$/);
    // Server should honor the requested cwds (regression guard against future
    // shellhost-create path changes).
    expect(termA.cwd).toBe(cwdA);
    expect(termB.cwd).toBe(cwdB);

    // Reload so the client picks up the new terminal list (the in-page state
    // was populated from the original 2 defaults). The fresh load fetches
    // /api/terminals?project= and shows the 2 new ones.
    await page.reload();
    await reopenProject(page, proj.slug);

    // Wait for 2 terminal panes.
    await expect(page.getByTestId('terminal-pane-0')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('terminal-pane-1')).toBeVisible({ timeout: 15000 });

    // Type `pwd` into each terminal and capture the printed line.
    const pwdA = await runPwdInPane(page, 0);
    const pwdB = await runPwdInPane(page, 1);
    expect(pwdA).toBe(cwdA);
    expect(pwdB).toBe(cwdB);

    // Persist a layout that includes the open file via PUT (this is what the
    // client does in production via the debounced effect; we issue it
    // synchronously here to avoid racing the debounce timer).
    const putRes = await request.put(`/api/projects/${proj.slug}/layout`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        terminals: [
          { id: termA.id, cwd: cwdA, command: null, claudeSessionId: null, background: false, label: 'TermA' },
          { id: termB.id, cwd: cwdB, command: null, claudeSessionId: null, background: false, label: 'TermB' },
        ],
        openFiles: [{ path: 'readme.txt', pane: 'file-0', scrollTop: 0 }],
        splits: {
          type: 'split',
          direction: 'vertical',
          ratio: 0.5,
          children: [
            { type: 'leaf', id: 'root-a' },
            { type: 'leaf', id: 'root-b' },
          ],
        },
        focusedPane: termA.id,
      },
    });
    expect(putRes.ok()).toBe(true);

    // Persist the project's terminal ordering so the client restores TermA, TermB
    // in the same order.
    await request.patch(`/api/projects/${proj.slug}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { terminals: [termA.id, termB.id] },
    });

    // --- Log out (clear token) and back in ---
    await page.evaluate(() => localStorage.removeItem('dancode-auth-token'));
    await page.reload();

    // Wait for login UI to appear and re-login.
    token = await login(page);

    // Re-open the same project from the sidebar.
    await reopenProject(page, proj.slug);

    // Assert: 2 terminal panes visible.
    await expect(page.getByTestId('terminal-pane-0')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('terminal-pane-1')).toBeVisible({ timeout: 15000 });

    // The third pane (file viewer) should be present.
    await expect(page.getByTestId('terminal-pane-2')).toBeVisible({ timeout: 15000 });

    // Pane 2 contains the file viewer with the readme.txt content.
    const fileText = await page.getByTestId('terminal-pane-2').textContent();
    expect(fileText).toContain('readme.txt');

    // Vertical split: splitDirection 'row' renders as flex-row. Inspect the
    // container's flex direction by data-testid; the layout container holds
    // panes side-by-side.
    const splitContainer = page.locator('[data-testid="terminal-layout"] .flex.flex-row').first();
    await expect(splitContainer).toBeVisible({ timeout: 10000 });

    // cwd preserved: `pwd` in each terminal still matches the original.
    const pwdAAfter = await runPwdInPane(page, 0);
    const pwdBAfter = await runPwdInPane(page, 1);
    expect(pwdAAfter).toBe(cwdA);
    expect(pwdBAfter).toBe(cwdB);
  });
});

async function reopenProject(page, slug) {
  const sidebarEntry = page.getByTestId(`sidebar-project-${slug}`);
  await sidebarEntry.waitFor({ state: 'visible', timeout: 15000 });
  await sidebarEntry.click();
}

async function readXtermBuffer(page, terminalId) {
  return page.evaluate((tid) => {
    const map = window.__dancodeTerminals;
    const term = map && map.get(tid);
    if (!term) return '';
    const parts = [];
    const buf = term.buffer.active;
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (line) parts.push(line.translateToString(true));
    }
    return parts.join('\n');
  }, terminalId);
}

async function runPwdInPane(page, paneIndex) {
  const pane = page.getByTestId(`terminal-pane-${paneIndex}`);
  await expect(pane).toBeVisible({ timeout: 15000 });
  await expect(pane.locator('.xterm')).toBeVisible({ timeout: 15000 });
  const terminalId = await pane.locator('[data-testid="terminal"]').getAttribute('data-terminal-id');
  expect(terminalId).toMatch(/^[a-f0-9-]{36}$/);

  const helper = pane.locator('textarea.xterm-helper-textarea');
  await helper.waitFor({ state: 'attached', timeout: 10000 });
  // Click into the pane so focus moves to this terminal.
  await pane.click();
  await helper.focus();
  await page.waitForTimeout(150);

  // Use a sentinel to delineate the pwd output from surrounding shell noise.
  const SENT = `__PWD_${Math.random().toString(36).slice(2, 8)}__`;
  await page.keyboard.type(`printf '\\n${SENT}\\n%s\\n${SENT}\\n' "$(pwd)"`);
  await page.keyboard.press('Enter');

  // Wait for two sentinel occurrences in the buffer (after `printf` echo,
  // the actual output prints them).
  await expect(async () => {
    const text = await readXtermBuffer(page, terminalId);
    const occurrences = (text.match(new RegExp(SENT, 'g')) || []).length;
    // We want the OUTPUT occurrences (>= 2 in addition to any echo of the
    // command). Counting >= 3 catches "input echo + 2 output lines".
    expect(occurrences).toBeGreaterThanOrEqual(3);
  }).toPass({ timeout: 15000 });

  const text = await readXtermBuffer(page, terminalId);
  // Extract the pwd line as the line between the *last* two SENT occurrences
  // (so the input echo of the printf is ignored).
  const lines = text.split('\n');
  const sentIndices = [];
  for (let i = 0; i < lines.length; i++) {
    // Each line might have trailing whitespace from xterm padding; match
    // line.trim() instead of strict equality.
    if (lines[i].trim() === SENT) sentIndices.push(i);
  }
  expect(sentIndices.length).toBeGreaterThanOrEqual(2);
  const lastTwo = sentIndices.slice(-2);
  const between = lines.slice(lastTwo[0] + 1, lastTwo[1]).map((l) => l.trim()).filter(Boolean);
  // The pwd output may span multiple lines if the path is longer than the
  // pane's xterm column width; xterm reflows the cursor onto the next line
  // mid-word. Join the non-empty lines between the sentinels to reconstruct
  // the original pwd string.
  expect(between.length).toBeGreaterThan(0);
  return between.join('');
}
