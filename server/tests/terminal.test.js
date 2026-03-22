import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ioClient } from 'socket.io-client';
import { startServer, httpServer } from '../src/index.js';

const TEST_PORT = 3098;
const URL = `http://localhost:${TEST_PORT}/terminal`;

describe('Socket.io /terminal namespace', () => {
  let server;

  beforeAll(async () => {
    server = await startServer(TEST_PORT);
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('accepts a connection and emits output data', async () => {
    const socket = ioClient(URL, { forceNew: true });

    const data = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.disconnect();
        reject(new Error('Timed out waiting for terminal output'));
      }, 5000);

      socket.on('output', (chunk) => {
        clearTimeout(timeout);
        resolve(chunk);
      });

      socket.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    expect(typeof data).toBe('string');
    expect(data.length).toBeGreaterThan(0);
    socket.disconnect();
  });

  it('receives input and produces output', async () => {
    const socket = ioClient(URL, { forceNew: true });

    // Wait for initial connection output
    await new Promise((resolve) => {
      socket.once('output', resolve);
    });

    // Send a command and wait for its output
    const output = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.disconnect();
        reject(new Error('Timed out waiting for echo output'));
      }, 5000);

      let buffer = '';
      socket.on('output', (chunk) => {
        buffer += chunk;
        if (buffer.includes('DANCODE_TEST_MARKER')) {
          clearTimeout(timeout);
          resolve(buffer);
        }
      });

      socket.emit('input', 'echo DANCODE_TEST_MARKER\n');
    });

    expect(output).toContain('DANCODE_TEST_MARKER');
    socket.disconnect();
  });

  it('handles disconnect cleanly', async () => {
    const socket = ioClient(URL, { forceNew: true });

    // Wait for connection
    await new Promise((resolve) => {
      socket.on('connect', resolve);
    });

    // Disconnect and verify no errors
    await new Promise((resolve) => {
      socket.on('disconnect', () => {
        resolve();
      });
      socket.disconnect();
    });

    expect(socket.connected).toBe(false);
  });
});
