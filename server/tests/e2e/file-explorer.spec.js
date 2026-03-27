import { test, expect } from '@playwright/test';
import { login, createProject, cleanupProject } from './e2e-helpers.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const PROJECT_NAME = `FileExplorer ${Date.now()}`;

test.describe('File Explorer', () => {
  let token;
  const created = [];

  test.afterEach(async ({ request }) => {
    for (const { slug, projectPath } of created) {
      await cleanupProject(request, slug, token, projectPath);
    }
  });

  test('expand directories, create file, rename, delete, drag to terminal', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    token = await login(page);

    // Create a project with some initial files
    const proj = await createProject(page, PROJECT_NAME);
    created.push(proj);

    // Create test files in the project directory via the API
    const authHeaders = { Authorization: `Bearer ${token}` };

    // Create a subdirectory and file using the file API
    await page.request.post('/api/files/mkdir', {
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      data: { path: 'src', project: proj.slug },
    });

    await page.request.put('/api/files/write', {
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      data: { path: 'src/index.js', content: 'console.log("hello")', project: proj.slug },
    });

    await page.request.put('/api/files/write', {
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      data: { path: 'README.md', content: '# Test', project: proj.slug },
    });

    // Wait for the terminal layout to be visible
    await expect(page.getByTestId('terminal-layout')).toBeVisible({ timeout: 15000 });

    // The file explorer should be visible (or toggle it open)
    const explorer = page.getByTestId('file-explorer');
    await expect(explorer).toBeVisible({ timeout: 10000 });

    // If collapsed, expand it
    const toggle = page.getByTestId('file-explorer-toggle');
    if (await toggle.isVisible()) {
      // Check if it's in collapsed state (check the width or look for 'Files' heading)
      const hasFilesHeading = await page.locator('text=Files').isVisible().catch(() => false);
      if (!hasFilesHeading) {
        await toggle.click();
        await expect(page.locator('text=Files')).toBeVisible({ timeout: 5000 });
      }
    }

    // Click refresh to load the files we just created
    await page.getByTestId('file-explorer-refresh').click();
    await page.waitForTimeout(500);

    // 1. Verify directory tree shows entries
    const fileTree = page.getByTestId('file-tree');
    await expect(fileTree).toBeVisible();

    // Wait for the src directory to appear
    await expect(page.getByTestId('file-entry-src')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('file-entry-README.md')).toBeVisible({ timeout: 5000 });

    // 2. Expand directory — click on src
    await page.getByTestId('file-entry-src').click();
    await expect(page.getByTestId('file-entry-src/index.js')).toBeVisible({ timeout: 5000 });

    // 3. Create a new file via context menu on the src directory
    await page.getByTestId('file-entry-src').click({ button: 'right' });
    const contextMenu = page.getByTestId('file-context-menu');
    await expect(contextMenu).toBeVisible({ timeout: 3000 });
    await page.getByTestId('ctx-new-file').click();

    // Fill in the new file name
    const newItemInput = page.getByTestId('new-item-input');
    await expect(newItemInput).toBeVisible({ timeout: 3000 });
    await newItemInput.fill('helpers.js');
    await newItemInput.press('Enter');

    // Wait for refresh and verify the new file exists
    await page.waitForTimeout(1000);
    // Refresh to make sure it shows up
    await page.getByTestId('file-explorer-refresh').click();
    await page.waitForTimeout(500);

    // Expand src again if needed
    const srcEntry = page.getByTestId('file-entry-src');
    await srcEntry.click();
    await page.waitForTimeout(500);

    // Verify the file was created via the API
    const checkRes = await page.request.get(`/api/files?path=src&project=${proj.slug}`, {
      headers: authHeaders,
    });
    const srcFiles = await checkRes.json();
    const helperFile = srcFiles.find(f => f.name === 'helpers.js');
    expect(helperFile).toBeTruthy();

    // 4. Rename the file via context menu
    // Click refresh to get updated tree
    await page.getByTestId('file-explorer-refresh').click();
    await page.waitForTimeout(500);
    await page.getByTestId('file-entry-src').click(); // expand
    await page.waitForTimeout(500);

    await page.getByTestId('file-entry-src/helpers.js').click({ button: 'right' });
    await expect(page.getByTestId('file-context-menu')).toBeVisible({ timeout: 3000 });
    await page.getByTestId('ctx-rename').click();

    // Fill in the new name
    const renameInput = page.getByTestId('rename-input');
    await expect(renameInput).toBeVisible({ timeout: 3000 });
    await renameInput.clear();
    await renameInput.fill('utils.js');
    await renameInput.press('Enter');

    // Verify rename via API
    await page.waitForTimeout(1000);
    const renameCheckRes = await page.request.get(`/api/files?path=src&project=${proj.slug}`, {
      headers: authHeaders,
    });
    const renamedFiles = await renameCheckRes.json();
    expect(renamedFiles.find(f => f.name === 'utils.js')).toBeTruthy();
    expect(renamedFiles.find(f => f.name === 'helpers.js')).toBeFalsy();

    // 5. Delete the file via context menu
    await page.getByTestId('file-explorer-refresh').click();
    await page.waitForTimeout(500);
    await page.getByTestId('file-entry-src').click(); // expand
    await page.waitForTimeout(500);

    // Set up dialog handler for delete confirmation
    page.on('dialog', async dialog => {
      await dialog.accept();
    });

    await page.getByTestId('file-entry-src/utils.js').click({ button: 'right' });
    await expect(page.getByTestId('file-context-menu')).toBeVisible({ timeout: 3000 });
    await page.getByTestId('ctx-delete').click();

    // Verify deletion via API
    await page.waitForTimeout(1000);
    const deleteCheckRes = await page.request.get(`/api/files?path=src&project=${proj.slug}`, {
      headers: authHeaders,
    });
    const deletedFiles = await deleteCheckRes.json();
    expect(deletedFiles.find(f => f.name === 'utils.js')).toBeFalsy();

    // 6. Test drag file to terminal — verify draggable attribute
    await page.getByTestId('file-explorer-refresh').click();
    await page.waitForTimeout(500);
    const readmeEntry = page.getByTestId('file-entry-README.md');
    await expect(readmeEntry).toBeVisible();
    const draggable = await readmeEntry.getAttribute('draggable');
    expect(draggable).toBe('true');

    // Verify directory is NOT draggable
    const srcDraggable = await page.getByTestId('file-entry-src').getAttribute('draggable');
    expect(srcDraggable).toBe('false');
  });
});
