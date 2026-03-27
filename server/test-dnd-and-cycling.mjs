import { chromium } from 'playwright';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { generate } from 'otplib';

const BASE = 'http://localhost:5174';

async function login(page) {
  const credPath = join(homedir(), '.dancode', 'credentials.json');
  const creds = JSON.parse(await readFile(credPath, 'utf-8'));
  const totpCode = await generate({ secret: creds.totpSecret });
  const response = await page.request.post(`${BASE}/api/auth/login`, {
    data: { username: creds.username, password: 'testpassword123', totpCode },
  });
  if (!response.ok()) throw new Error(`Login failed: ${response.status()}`);
  const { token } = await response.json();
  await page.goto(BASE);
  await page.evaluate((tok) => localStorage.setItem('dancode-auth-token', tok), token);
  await page.reload();
  await page.waitForSelector('[data-testid="new-project-button"]', { state: 'visible', timeout: 10000 });
  return token;
}

async function createProject(page, name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const projectPath = `/tmp/dancode-eval-${slug}-${Date.now()}`;
  await page.getByTestId('new-project-button').click();
  await page.waitForSelector('[data-testid="new-project-form"]', { state: 'visible' });
  await page.getByTestId('project-name-input').fill(name);
  const pathInput = page.getByTestId('project-path-input');
  await pathInput.clear();
  await pathInput.fill(projectPath);
  await page.getByTestId('new-project-submit').click();
  await page.waitForSelector('[data-testid="terminal-layout"]', { state: 'visible', timeout: 15000 });
  return { slug, projectPath };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = {};

  // --- Test 1: Drag-and-drop upload (Criterion 7) ---
  console.log('\n=== Testing Drag-and-Drop Upload (Criterion 7) ===');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    let token, proj;
    try {
      token = await login(page);
      proj = await createProject(page, `DnD ${Date.now()}`);
      const pane0 = page.getByTestId('terminal-pane-0');
      await pane0.waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="terminal"]');
        return el?.getAttribute('data-connection-state') === 'connected';
      }, { timeout: 10000 });

      // Create a small test PNG (1x1 pixel)
      const testImagePath = '/tmp/test-upload-image.png';
      // Minimal 1x1 red pixel PNG
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
      await writeFile(testImagePath, pngBuffer);

      // Listen for upload API call
      let uploadResponse = null;
      page.on('response', (res) => {
        if (res.url().includes('/api/projects/') && res.url().includes('/upload')) {
          uploadResponse = res;
        }
      });

      // Simulate drag-and-drop by dispatching events
      const terminal = pane0.locator('[data-testid="terminal"]');
      const termBox = await terminal.boundingBox();

      // Create a DataTransfer with the file using Playwright's dispatchEvent
      await terminal.evaluate(async (el) => {
        // Create a small test file
        const blob = new Blob([new Uint8Array([137,80,78,71,13,10,26,10])], { type: 'image/png' });
        const file = new File([blob], 'test.png', { type: 'image/png' });
        
        // Create DataTransfer with the file
        const dt = new DataTransfer();
        dt.items.add(file);

        // Dispatch dragover event
        const dragOverEvent = new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        });
        el.dispatchEvent(dragOverEvent);

        // Dispatch drop event
        const dropEvent = new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        });
        el.dispatchEvent(dropEvent);
      });

      // Wait a bit for upload to complete
      await page.waitForTimeout(3000);

      if (uploadResponse) {
        results.criterion7_uploadCalled = true;
        results.criterion7_uploadStatus = uploadResponse.status();
        results.criterion7_uploadSuccess = uploadResponse.status() === 200;
        console.log(`Upload API called: PASS (status: ${uploadResponse.status()})`);
      } else {
        results.criterion7_uploadCalled = false;
        results.criterion7_uploadSuccess = false;
        console.log('Upload API called: FAIL - no upload request detected');
      }

      // Verify the upload endpoint exists by testing it directly
      const directUpload = await page.request.post(`${BASE}/api/projects/${proj.slug}/upload`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        data: {
          data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
          filename: 'test-api.png',
        },
      });
      results.criterion7_apiExists = directUpload.ok();
      if (directUpload.ok()) {
        const body = await directUpload.json();
        results.criterion7_returnsPath = !!body.path;
        console.log(`Upload API works directly: PASS - path: ${body.path}`);
      } else {
        console.log(`Upload API direct test: FAIL - status ${directUpload.status()}`);
      }

    } catch (e) {
      console.error(`Error: ${e.message}`);
    } finally {
      if (proj && token) {
        try {
          await page.request.delete(`${BASE}/api/projects/${proj.slug}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          await rm(proj.projectPath, { recursive: true, force: true }).catch(() => {});
        } catch {}
      }
      await context.close();
    }
  }

  // --- Test 2: Alt+Left/Right cycling (Criterion 9) ---
  console.log('\n=== Testing Alt+Left/Right Project Cycling (Criterion 9) ===');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    let token;
    const projects = [];
    try {
      token = await login(page);

      // Create two projects
      const proj1 = await createProject(page, `CycleA ${Date.now()}`);
      projects.push(proj1);
      
      const proj2 = await createProject(page, `CycleB ${Date.now()}`);
      projects.push(proj2);

      // Wait for terminal layout
      await page.waitForSelector('[data-testid="terminal-layout"]', { state: 'visible', timeout: 15000 });
      
      // Get current project slug from layout
      const layout = page.getByTestId('terminal-layout');
      const currentSlug = await layout.getAttribute('data-slug');
      console.log(`Current project: ${currentSlug}`);
      results.criterion9_initialProject = currentSlug === proj2.slug;

      // Press Alt+Left to cycle to previous project
      await page.keyboard.press('Alt+ArrowLeft');
      await page.waitForTimeout(2000);

      // Check that we switched projects
      const newLayout = page.getByTestId('terminal-layout');
      const newSlug = await newLayout.getAttribute('data-slug');
      console.log(`After Alt+Left: ${newSlug}`);
      results.criterion9_altLeft = newSlug !== currentSlug;
      console.log(`Alt+Left switched project: ${results.criterion9_altLeft ? 'PASS' : 'FAIL'}`);

      // Press Alt+Right to cycle forward
      await page.keyboard.press('Alt+ArrowRight');
      await page.waitForTimeout(2000);

      const afterRight = page.getByTestId('terminal-layout');
      const rightSlug = await afterRight.getAttribute('data-slug');
      console.log(`After Alt+Right: ${rightSlug}`);
      results.criterion9_altRight = rightSlug !== newSlug;
      console.log(`Alt+Right switched project: ${results.criterion9_altRight ? 'PASS' : 'FAIL'}`);

    } catch (e) {
      console.error(`Error: ${e.message}`);
      console.error(e.stack);
    } finally {
      for (const proj of projects) {
        try {
          await page.request.delete(`${BASE}/api/projects/${proj.slug}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          await rm(proj.projectPath, { recursive: true, force: true }).catch(() => {});
        } catch {}
      }
      await context.close();
    }
  }

  // --- Test 3: Command palette Ctrl+K (Criterion 8) ---
  console.log('\n=== Testing Command Palette Ctrl+K (Criterion 8) ===');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    let token;
    const projects = [];
    try {
      token = await login(page);

      // Create a project
      const proj = await createProject(page, `Palette ${Date.now()}`);
      projects.push(proj);

      await page.waitForSelector('[data-testid="terminal-layout"]', { state: 'visible', timeout: 15000 });

      // Press Ctrl+K to open palette
      await page.keyboard.press('Control+k');
      
      const palette = page.getByTestId('command-palette');
      try {
        await palette.waitFor({ state: 'visible', timeout: 5000 });
        results.criterion8_opens = true;
        console.log('Ctrl+K opens palette: PASS');
      } catch {
        results.criterion8_opens = false;
        console.log('Ctrl+K opens palette: FAIL');
      }

      // Check search input exists
      const input = page.getByTestId('command-palette-input');
      if (results.criterion8_opens) {
        const inputVisible = await input.isVisible();
        results.criterion8_hasInput = inputVisible;
        console.log(`Palette has search input: ${inputVisible ? 'PASS' : 'FAIL'}`);
      }

      // Check list has projects
      const list = page.getByTestId('command-palette-list');
      if (results.criterion8_opens) {
        const listText = await list.textContent();
        results.criterion8_showsProjects = listText.length > 0;
        console.log(`Palette shows projects: ${results.criterion8_showsProjects ? 'PASS' : 'FAIL'}`);
      }

      // Press Escape to close
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      const paletteAfterEsc = page.getByTestId('command-palette');
      const isHidden = await paletteAfterEsc.isHidden();
      results.criterion8_closes = isHidden;
      console.log(`Escape closes palette: ${isHidden ? 'PASS' : 'FAIL'}`);

    } catch (e) {
      console.error(`Error: ${e.message}`);
    } finally {
      for (const proj of projects) {
        try {
          await page.request.delete(`${BASE}/api/projects/${proj.slug}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          await rm(proj.projectPath, { recursive: true, force: true }).catch(() => {});
        } catch {}
      }
      await context.close();
    }
  }

  await browser.close();
  console.log('\n=== ALL RESULTS ===');
  console.log(JSON.stringify(results, null, 2));
})();
