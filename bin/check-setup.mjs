#!/usr/bin/env node
// @ts-check
/**
 * `npm run check:setup` — environment preflight for DanCode.
 *
 * Verifies that the host has everything needed to build/run DanCode:
 *   - Node 20+ runtime
 *   - C/C++ toolchain for node-pty: python3, make, g++
 *   - The `~/.dancode/` directory parent is writable so shellhost can drop
 *     its UNIX socket there.
 *
 * Exits 0 only if every check is green.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, access, rm } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const mark = ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  const trailer = detail ? ` (${detail})` : '';
  process.stdout.write(`${mark} ${name}${trailer}\n`);
}

function tryExec(file, args) {
  try {
    const out = execFileSync(file, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    return { ok: true, stdout: out.trim() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function checkNode() {
  const [maj, min] = process.versions.node.split('.').map((n) => parseInt(n, 10));
  const ok = (maj >= 22) || (maj === 20 && min >= 19);
  record(`Node.js ≥ 20.19 (current: v${process.versions.node})`, ok,
    ok ? '' : 'install Node 20.19+ or 22.12+');
}

function checkBuildDep(name, file, versionArgs) {
  const probe = tryExec(file, versionArgs);
  if (probe.ok) {
    const firstLine = probe.stdout.split('\n')[0].slice(0, 80);
    record(`${name} available`, true, firstLine);
  } else {
    record(`${name} available`, false, `not found in PATH (run: apt install build-essential python3)`);
  }
}

async function checkSocketDirWritable() {
  const sockPath = process.env.DANCODE_SHELLHOST_SOCKET || join(homedir(), '.dancode', 'shellhost.sock');
  const dir = dirname(sockPath);
  try {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    // Probe write permission with a throwaway file.
    const probe = join(dir, `.check-setup-${process.pid}`);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(probe, 'ok');
    await rm(probe);
    record(`socket dir writable (${dir})`, true);
  } catch (err) {
    record(`socket dir writable (${dir})`, false, err.message);
  }
}

async function main() {
  console.log('Checking DanCode environment...\n');

  checkNode();
  checkBuildDep('python3', 'python3', ['--version']);
  checkBuildDep('make', 'make', ['--version']);
  checkBuildDep('g++ (C++ compiler)', 'g++', ['--version']);
  await checkSocketDirWritable();

  const fails = results.filter((r) => !r.ok);
  console.log('');
  if (fails.length === 0) {
    console.log(`${GREEN}All checks passed.${RESET}`);
    process.exit(0);
  } else {
    console.log(`${RED}${fails.length} check(s) failed.${RESET}`);
    for (const f of fails) {
      console.log(`  - ${f.name}${f.detail ? ` :: ${f.detail}` : ''}`);
    }
    console.log(`\n${YELLOW}See plans/dancode-shellhost-redesign.md#initial-setup for details.${RESET}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('check:setup crashed:', err);
  process.exit(2);
});
