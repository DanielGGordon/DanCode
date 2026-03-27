import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { generate } from 'otplib';

/**
 * Shared E2E test helpers.
 *
 * Login reads credentials from ~/.dancode/credentials.json and the
 * plaintext password from DANCODE_PASSWORD env var or ~/.dancode/e2e-password.
 */

export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Authenticate via the API and inject the session token into the browser.
 * Returns the session token string.
 */
export async function login(page) {
  const credPath = join(homedir(), '.dancode', 'credentials.json');
  const creds = JSON.parse(await readFile(credPath, 'utf-8'));

  // Read password from env var or file
  let password = process.env.DANCODE_PASSWORD;
  if (!password) {
    const pwPath = join(homedir(), '.dancode', 'e2e-password');
    password = (await readFile(pwPath, 'utf-8')).trim();
  }

  // Generate TOTP code
  const totpCode = await generate({ secret: creds.totpSecret });

  // Login via API
  const response = await page.request.post('/api/auth/login', {
    data: { username: creds.username, password, totpCode },
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
