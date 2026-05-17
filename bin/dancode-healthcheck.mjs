#!/usr/bin/env node
// @ts-check
/**
 * `bin/dancode-healthcheck` — post-deploy verification for DanCode.
 *
 * Confirms that:
 *   1. The shellhost UNIX socket is reachable.
 *   2. The `list` op responds.
 *   3. A throwaway PTY can be spawned and runs `echo healthcheck-<uuid>`,
 *      output is captured and the PTY exits cleanly.
 *   4. The dancode-server HTTP endpoint `/api/auth/setup/status` returns 200.
 *
 * Configuration (env or flag):
 *   DANCODE_SHELLHOST_SOCKET / --socket   default: ~/.dancode/shellhost.sock
 *   DANCODE_SERVER_URL       / --server   default: http://127.0.0.1:3000
 *
 * Exits 0 only if every check passes; otherwise 1.
 *
 * Used by the production deploy pipeline and by the Phase 10 systemd-in-Docker
 * integration test as the end-to-end smoke gate.
 */
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createShellhostClient } from 'dancode-shellhost/src/client.js';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function parseArgs(argv) {
  const args = { socket: null, server: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--socket') args.socket = argv[++i];
    else if (a === '--server') args.server = argv[++i];
    else if (a.startsWith('--socket=')) args.socket = a.slice('--socket='.length);
    else if (a.startsWith('--server=')) args.server = a.slice('--server='.length);
  }
  return args;
}

const argFlags = parseArgs(process.argv.slice(2));
const socketPath = argFlags.socket
  || process.env.DANCODE_SHELLHOST_SOCKET
  || join(homedir(), '.dancode', 'shellhost.sock');
const serverUrl = (argFlags.server
  || process.env.DANCODE_SERVER_URL
  || 'http://127.0.0.1:3000').replace(/\/+$/, '');

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const mark = ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  const trailer = detail ? ` (${detail})` : '';
  process.stdout.write(`${mark} ${name}${trailer}\n`);
}

async function checkShellhostSocketExists() {
  if (!existsSync(socketPath)) {
    record(`shellhost socket present at ${socketPath}`, false, 'socket file missing');
    return false;
  }
  record(`shellhost socket present at ${socketPath}`, true);
  return true;
}

/** @returns {Promise<{client: any} | null>} */
async function checkShellhostListResponds() {
  const client = createShellhostClient({ socketPath });
  try {
    await client.connect();
  } catch (err) {
    record('list op responds', false, `connect failed: ${err.message}`);
    try { client.close(); } catch { /* ignore */ }
    return null;
  }
  try {
    const listResult = await Promise.race([
      client.list(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('list op timed out')), 5_000)),
    ]);
    const count = Array.isArray(listResult?.terminals) ? listResult.terminals.length : 'n/a';
    record('list op responds', true, `${count} terminal(s)`);
    return { client };
  } catch (err) {
    record('list op responds', false, err.message);
    try { client.close(); } catch { /* ignore */ }
    return null;
  }
}

async function checkSpawnEchoHealthcheck(client) {
  const marker = `healthcheck-${randomUUID()}`;
  /** @type {string[]} */
  const collected = [];
  let exitInfo = null;
  /** @type {(() => void) | null} */
  let exitResolve = null;
  const exitPromise = new Promise((r) => { exitResolve = r; });

  const onOutput = (terminalId, payload) => {
    if (payload?.data) collected.push(payload.data);
  };
  const onExit = (terminalId, payload) => {
    exitInfo = payload;
    if (exitResolve) exitResolve();
  };

  client.on('output', onOutput);
  client.on('exit', onExit);

  let terminalId = null;
  try {
    const spawnRes = await client.spawn({
      projectSlug: '_healthcheck',
      cwd: process.cwd(),
      // bash -c so the shell exits as soon as echo finishes.
      command: `bash -lc 'echo ${marker}'`,
    });
    terminalId = spawnRes?.terminalId;
    if (!terminalId) throw new Error('shellhost did not return a terminalId');
    await client.attach(terminalId);

    // Wait up to 5s for the PTY to exit on its own.
    await Promise.race([
      exitPromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('PTY did not exit within 5s')), 5_000)),
    ]);

    const text = collected.join('');
    if (!text.includes(marker)) {
      record('echo healthcheck round-trip', false, 'marker not found in PTY output');
      return false;
    }
    const code = exitInfo?.exitCode;
    if (code !== 0 && code !== undefined && code !== null) {
      record('echo healthcheck round-trip', false, `exit code ${code}`);
      return false;
    }
    record('echo healthcheck round-trip', true, `marker received, exit=${code ?? 0}`);
    return true;
  } catch (err) {
    record('echo healthcheck round-trip', false, err.message);
    return false;
  } finally {
    client.off('output', onOutput);
    client.off('exit', onExit);
    // Best-effort cleanup. The PTY normally exits on its own; kill is a backstop.
    if (terminalId) {
      try { await client.kill(terminalId); } catch { /* ignore */ }
    }
  }
}

async function checkServerSetupStatus() {
  const url = `${serverUrl}/api/auth/setup/status`;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5_000);
    let res;
    try {
      res = await fetch(url, { signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      record(`server /api/auth/setup/status reachable at ${serverUrl}`, false, `HTTP ${res.status}`);
      return false;
    }
    record(`server /api/auth/setup/status reachable at ${serverUrl}`, true, `HTTP ${res.status}`);
    return true;
  } catch (err) {
    record(`server /api/auth/setup/status reachable at ${serverUrl}`, false, err.message);
    return false;
  }
}

async function main() {
  console.log('Running DanCode healthcheck...\n');

  const socketPresent = await checkShellhostSocketExists();
  let client = null;
  if (socketPresent) {
    const conn = await checkShellhostListResponds();
    if (conn) {
      client = conn.client;
      await checkSpawnEchoHealthcheck(client);
    }
  } else {
    // Still record subsequent checks as failed so output is complete.
    record('list op responds', false, 'skipped — socket missing');
    record('echo healthcheck round-trip', false, 'skipped — socket missing');
  }
  await checkServerSetupStatus();

  if (client) {
    try { client.close(); } catch { /* ignore */ }
  }

  const failed = results.filter((r) => !r.ok);
  console.log('');
  if (failed.length === 0) {
    console.log(`${GREEN}All checks passed.${RESET}`);
    process.exit(0);
  }
  console.log(`${RED}${failed.length} check(s) failed:${RESET}`);
  for (const f of failed) {
    console.log(`  - ${f.name}${f.detail ? ` :: ${f.detail}` : ''}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error('healthcheck crashed:', err);
  process.exit(2);
});
