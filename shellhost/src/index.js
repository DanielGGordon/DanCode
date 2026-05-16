import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createShellhost } from './server.js';
import { PTYManager } from './pty-manager.js';
import { ScrollbackStore } from './scrollback.js';
import { MetaStore } from './meta-store.js';

/**
 * Default UNIX-socket path. Production: ~/.dancode/shellhost.sock.
 * Override with DANCODE_SHELLHOST_SOCKET.
 */
export function getDefaultSocketPath() {
  return process.env.DANCODE_SHELLHOST_SOCKET
    || join(homedir(), '.dancode', 'shellhost.sock');
}

/**
 * Default scrollback base directory: ~/.dancode/terminals/.
 * Override with DANCODE_TERMINALS_DIR.
 */
export function getDefaultTerminalsDir() {
  return process.env.DANCODE_TERMINALS_DIR
    || join(homedir(), '.dancode', 'terminals');
}

export async function main() {
  const socketPath = getDefaultSocketPath();
  const baseDir = getDefaultTerminalsDir();
  const scrollback = new ScrollbackStore({ baseDir });
  const metaStore = new MetaStore({ baseDir });
  const manager = new PTYManager({ scrollback, metaStore });
  // Scan for orphaned terminals from a previous shellhost run; each is held
  // as needs-respawn until the server (or a test) asks for it.
  const orphans = manager.loadOrphans();
  if (orphans.loaded > 0) {
    console.log(`[shellhost] loaded ${orphans.loaded} orphan terminal${orphans.loaded === 1 ? '' : 's'} (awaiting respawn)`);
  }
  const host = createShellhost({ manager });
  await host.listen(socketPath);
  console.log(`[shellhost] listening on ${socketPath} (pid ${process.pid})`);

  const shutdown = async (signal) => {
    console.log(`[shellhost] caught ${signal}, shutting down`);
    try { manager.stopLastActiveFlusher(); } catch { /* ignore */ }
    try { manager._flushLastActive(); } catch { /* ignore */ }
    try { await host.close(); } catch { /* ignore */ }
    try { scrollback.closeAll(); } catch { /* ignore */ }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return host;
}

// Run when invoked directly (not imported).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[shellhost] fatal:', err);
    process.exit(1);
  });
}

export { createShellhost };
export { PTYManager } from './pty-manager.js';
export { ScrollbackStore } from './scrollback.js';
export { MetaStore } from './meta-store.js';
export { encodeFrame, FrameDecoder, makeRequest, makeResponse, makeEvent } from './wire.js';
export { createShellhostClient } from './client.js';
