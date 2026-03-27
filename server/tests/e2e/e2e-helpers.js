import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { generate } from 'otplib';

/**
 * Shared E2E test helpers.
 *
 * Login checks setup status first. If no account exists, it creates a test
 * account with known credentials. Otherwise it reads the password from
 * DANCODE_PASSWORD env var, ~/.dancode/e2e-password, or falls back to
 * 'testpassword123'.
 */

const TEST_USERNAME = 'testuser';
const TEST_PASSWORD = 'testpassword123';

export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Authenticate via the API and inject the session token into the browser.
 * If no account is set up, creates one with test credentials first.
 * Returns the session token string.
 */
export async function login(page) {
  // Check if account setup is complete
  const statusRes = await page.request.get('/api/auth/setup/status');
  const { setupComplete } = await statusRes.json();

  let username, password, totpSecret;

  if (!setupComplete) {
    // No account exists — create a test account
    const setupRes = await page.request.post('/api/auth/setup', {
      data: { username: TEST_USERNAME, password: TEST_PASSWORD },
    });
    if (!setupRes.ok()) {
      throw new Error(`Account setup failed: ${setupRes.status()} ${await setupRes.text()}`);
    }
    const setupData = await setupRes.json();
    username = TEST_USERNAME;
    password = TEST_PASSWORD;
    totpSecret = setupData.totpSecret;
  } else {
    // Account exists — read credentials from disk
    const credPath = join(homedir(), '.dancode', 'credentials.json');
    const creds = JSON.parse(await readFile(credPath, 'utf-8'));
    username = creds.username;
    totpSecret = creds.totpSecret;

    // Read password from env var or file (fall back to test default)
    password = process.env.DANCODE_PASSWORD;
    if (!password) {
      try {
        const pwPath = join(homedir(), '.dancode', 'e2e-password');
        password = (await readFile(pwPath, 'utf-8')).trim();
      } catch {
        password = TEST_PASSWORD;
      }
    }
  }

  // Generate TOTP code
  const totpCode = await generate({ secret: totpSecret });

  // Login via API
  const response = await page.request.post('/api/auth/login', {
    data: { username, password, totpCode },
  });

  if (!response.ok()) {
    throw new Error(`Login failed: ${response.status()} ${await response.text()}`);
  }

  const { token } = await response.json();

  // Inject token into localStorage and navigate
  await page.goto('/');
  await page.evaluate((tok) => localStorage.setItem('dancode-auth-token', tok), token);
  await page.reload();

  // Wait for authenticated view
  await page.waitForSelector('[data-testid="new-project-button"]', { state: 'visible', timeout: 10000 });

  return token;
}

/**
 * Create a project via the UI form. Returns { slug, projectPath }.
 * Waits for terminal-layout to appear.
 */
export async function createProject(page, name) {
  const slug = slugify(name);
  const projectPath = `/tmp/dancode-e2e-${slug}-${Date.now()}`;

  await page.getByTestId('new-project-button').click();
  const form = page.getByTestId('new-project-form');
  await form.waitFor({ state: 'visible' });

  await page.getByTestId('project-name-input').fill(name);
  const pathInput = page.getByTestId('project-path-input');
  await pathInput.clear();
  await pathInput.fill(projectPath);
  await page.getByTestId('new-project-submit').click();

  // Wait for terminal layout to appear
  await page.waitForSelector('[data-testid="terminal-layout"]', { state: 'visible', timeout: 15000 });

  return { slug, projectPath };
}

/**
 * Clean up a project after a test: delete via API and remove temp directory.
 */
export async function cleanupProject(request, slug, token, projectPath) {
  if (slug && token) {
    try {
      await request.delete(`/api/projects/${slug}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* best-effort */ }
  }

  if (projectPath) {
    try {
      await rm(projectPath, { recursive: true, force: true });
    } catch { /* best-effort */ }
  }
}
