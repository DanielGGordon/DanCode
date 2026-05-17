import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

/**
 * Phase 10 acceptance criterion: `npm run dev` continues to start shellhost
 * on the dev socket (/tmp/dancode-shellhost-dev.sock) so it does NOT conflict
 * with the systemd-managed prod socket (~/.dancode/shellhost.sock).
 *
 * These tests verify the script wiring rather than booting the stack.
 */
describe('npm run dev uses the dev socket', () => {
  function readScripts(workspace) {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, workspace, 'package.json'), 'utf8'));
    return pkg.scripts || {};
  }

  it('server.dev sets DANCODE_SHELLHOST_SOCKET to the dev socket by default', () => {
    const scripts = readScripts('server');
    const dev = scripts.dev || '';
    expect(dev).toContain('DANCODE_SHELLHOST_SOCKET');
    expect(dev).toContain('/tmp/dancode-shellhost-dev.sock');
  });

  it('shellhost.dev binds to the dev socket by default', () => {
    const scripts = readScripts('shellhost');
    const dev = scripts.dev || '';
    expect(dev).toContain('DANCODE_SHELLHOST_SOCKET');
    expect(dev).toContain('/tmp/dancode-shellhost-dev.sock');
  });

  it('shellhost.dev allows DANCODE_SHELLHOST_SOCKET override', () => {
    const scripts = readScripts('shellhost');
    expect(scripts.dev).toMatch(/\$\{DANCODE_SHELLHOST_SOCKET:-/);
  });

  it('production unit binds to a different (prod) socket, not the dev socket', () => {
    const unit = readFileSync(join(REPO_ROOT, 'systemd', 'dancode-shellhost.service'), 'utf8');
    expect(unit).toContain('DANCODE_SHELLHOST_SOCKET=%h/.dancode/shellhost.sock');
    expect(unit).not.toContain('/tmp/dancode-shellhost-dev.sock');
  });
});
