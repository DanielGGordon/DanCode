import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SYSTEMD_DIR = join(REPO_ROOT, 'systemd');
const SHELLHOST_UNIT = join(SYSTEMD_DIR, 'dancode-shellhost.service');
const SERVER_UNIT = join(SYSTEMD_DIR, 'dancode-server.service');
const INSTALL_SCRIPT = join(SYSTEMD_DIR, 'install.sh');
const SHELLHOST_ENTRY = join(REPO_ROOT, 'shellhost', 'src', 'index.js');

/**
 * Parse a systemd .service file into { sections: { Section: { key: [values] } } }.
 * Keys can appear multiple times so values are arrays.
 */
function parseUnit(text) {
  const sections = {};
  let current = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/[#;].*$/, '').trim();
    if (!line) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      current = sec[1];
      sections[current] = sections[current] || {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0 || !current) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    sections[current][key] = sections[current][key] || [];
    sections[current][key].push(value);
  }
  return sections;
}

describe('systemd/dancode-shellhost.service', () => {
  it('exists in the repo', () => {
    expect(existsSync(SHELLHOST_UNIT)).toBe(true);
  });

  it('parses into [Unit], [Service], [Install] sections', () => {
    const parsed = parseUnit(readFileSync(SHELLHOST_UNIT, 'utf8'));
    expect(parsed.Unit).toBeTruthy();
    expect(parsed.Service).toBeTruthy();
    expect(parsed.Install).toBeTruthy();
  });

  it('has Type=simple', () => {
    const parsed = parseUnit(readFileSync(SHELLHOST_UNIT, 'utf8'));
    expect(parsed.Service.Type?.[0]).toBe('simple');
  });

  it('has Restart=on-failure', () => {
    const parsed = parseUnit(readFileSync(SHELLHOST_UNIT, 'utf8'));
    expect(parsed.Service.Restart?.[0]).toBe('on-failure');
  });

  it('ExecStart invokes node on the shellhost entry point', () => {
    const parsed = parseUnit(readFileSync(SHELLHOST_UNIT, 'utf8'));
    const exec = parsed.Service.ExecStart?.[0] || '';
    expect(exec).toMatch(/\/usr\/bin\/env\s+node\b/);
    expect(exec).toContain('shellhost');
    expect(exec).toContain('index.js');
  });

  it('ExecStart path, after install.sh placeholder substitution, resolves to an existing file', () => {
    const parsed = parseUnit(readFileSync(SHELLHOST_UNIT, 'utf8'));
    const exec = parsed.Service.ExecStart?.[0] || '';
    const m = exec.match(/\/usr\/bin\/env\s+node\s+(\S+)/);
    expect(m).toBeTruthy();
    const target = (m?.[1] || '').trim();
    // The unit ships with the placeholder `/opt/dancode/...` and install.sh
    // rewrites it to the actual repo path. Simulate that substitution here.
    const substituted = target.replace(/^\/opt\/dancode/, REPO_ROOT);
    expect(existsSync(substituted), `expected ${substituted} to exist`).toBe(true);
    expect(substituted.endsWith('shellhost/src/index.js')).toBe(true);
  });

  it('sets DANCODE_SHELLHOST_SOCKET=%h/.dancode/shellhost.sock via Environment=', () => {
    const parsed = parseUnit(readFileSync(SHELLHOST_UNIT, 'utf8'));
    const envEntries = parsed.Service.Environment || [];
    const joined = envEntries.join(' ');
    expect(joined).toContain('DANCODE_SHELLHOST_SOCKET=%h/.dancode/shellhost.sock');
  });

  it('installs into default.target so it survives logout (with linger)', () => {
    const parsed = parseUnit(readFileSync(SHELLHOST_UNIT, 'utf8'));
    expect(parsed.Install.WantedBy?.[0]).toBe('default.target');
  });
});

describe('systemd/install.sh', () => {
  it('exists and is executable', () => {
    expect(existsSync(INSTALL_SCRIPT)).toBe(true);
    const st = statSync(INSTALL_SCRIPT);
    // Owner execute bit set.
    expect((st.mode & 0o100)).not.toBe(0);
  });

  it('uses set -euo pipefail or set -e for safety', () => {
    const text = readFileSync(INSTALL_SCRIPT, 'utf8');
    expect(text).toMatch(/^set\s+-e/m);
  });

  it('copies the shellhost unit into ~/.config/systemd/user and reloads', () => {
    const text = readFileSync(INSTALL_SCRIPT, 'utf8');
    expect(text).toContain('~/.config/systemd/user');
    expect(text).toContain('dancode-shellhost.service');
    expect(text).toContain('systemctl --user daemon-reload');
    expect(text).toMatch(/systemctl --user (enable|start|enable --now) dancode-shellhost/);
  });

  it('rewrites ExecStart to the repo path so the unit is portable', () => {
    const text = readFileSync(INSTALL_SCRIPT, 'utf8');
    // The script should substitute the absolute repo path into the copied unit
    // (e.g. via sed) so users don't have to edit the file manually.
    expect(text).toMatch(/sed.*ExecStart|sed.*DANCODE_REPO|envsubst/);
  });
});

describe('install.sh dry run', () => {
  it('produces a unit file under the requested UNIT_DIR with ExecStart rewritten to the repo root', () => {
    const tempUnitDir = mkdtempSync(join(tmpdir(), 'dancode-systemd-install-'));
    try {
      // PATH override: install.sh calls systemctl. In CI / test env there may
      // be no user systemd bus available, so we stub systemctl with a script
      // that always exits 0.
      const fakeBinDir = mkdtempSync(join(tmpdir(), 'dancode-fakebin-'));
      const fakeSystemctl = join(fakeBinDir, 'systemctl');
      writeFileSync(fakeSystemctl, '#!/usr/bin/env bash\nexit 0\n');
      chmodSync(fakeSystemctl, 0o755);

      const res = spawnSync('bash', [INSTALL_SCRIPT], {
        env: {
          ...process.env,
          DANCODE_REPO: REPO_ROOT,
          UNIT_DIR: tempUnitDir,
          PATH: `${fakeBinDir}:${process.env.PATH}`,
        },
        encoding: 'utf8',
      });
      expect(res.status, `stderr: ${res.stderr}`).toBe(0);

      const installed = join(tempUnitDir, 'dancode-shellhost.service');
      expect(existsSync(installed)).toBe(true);
      const text = readFileSync(installed, 'utf8');
      expect(text).toContain(`ExecStart=/usr/bin/env node ${REPO_ROOT}/shellhost/src/index.js`);
      expect(text).not.toContain('/opt/dancode');

      rmSync(fakeBinDir, { recursive: true, force: true });
    } finally {
      rmSync(tempUnitDir, { recursive: true, force: true });
    }
  });
});

describe('systemd/dancode-server.service (optional)', () => {
  it('exists as a sibling unit for users who want the web server under systemd', () => {
    expect(existsSync(SERVER_UNIT)).toBe(true);
  });

  it('has Type=simple and Restart=on-failure', () => {
    const parsed = parseUnit(readFileSync(SERVER_UNIT, 'utf8'));
    expect(parsed.Service.Type?.[0]).toBe('simple');
    expect(parsed.Service.Restart?.[0]).toBe('on-failure');
  });

  it('declares After=dancode-shellhost.service so the server boots after the socket', () => {
    const parsed = parseUnit(readFileSync(SERVER_UNIT, 'utf8'));
    const after = (parsed.Unit.After || []).join(' ');
    expect(after).toContain('dancode-shellhost.service');
  });
});
