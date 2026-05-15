import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createShellhost } from './server.js';

/**
 * Default UNIX-socket path. Production: ~/.dancode/shellhost.sock.
 * Override with DANCODE_SHELLHOST_SOCKET.
 */
export function getDefaultSocketPath() {
  return process.env.DANCODE_SHELLHOST_SOCKET
    || join(homedir(), '.dancode', 'shellhost.sock');
}

export async function main() {
  const socketPath = getDefaultSocketPath();
  const host = createShellhost();
  await host.listen(socketPath);
  console.log(`[shellhost] listening on ${socketPath} (pid ${process.pid})`);

  const shutdown = async (signal) => {
    console.log(`[shellhost] caught ${signal}, shutting down`);
    try { await host.close(); } catch { /* ignore */ }
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
export { encodeFrame, FrameDecoder, makeRequest, makeResponse, makeEvent } from './wire.js';
export { createShellhostClient } from './client.js';
