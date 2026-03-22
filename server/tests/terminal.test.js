import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import { createServer } from 'node:http';

let mockPty;

vi.mock('node-pty', () => ({
  default: {
    spawn: vi.fn(() => {
      mockPty = {
        onData: vi.fn(),
        onExit: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
      };
      return mockPty;
    }),
  },
}));

import { setupTerminalNamespace } from '../src/terminal.js';
import pty from 'node-pty';

const TEST_TOKEN = 'a'.repeat(64);

describe('Socket.io /terminal namespace', () => {
  let httpServer, io, port, clientSocket;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPty = null;

    httpServer = createServer();
    io = new Server(httpServer);

    await new Promise((resolve) => {
      httpServer.listen(0, () => {
        port = httpServer.address().port;
        resolve();
      });
    });

    setupTerminalNamespace(io, 'test-session', TEST_TOKEN);
  });

  afterEach(async () => {
    if (clientSocket?.connected) {
      clientSocket.disconnect();
    }
    clientSocket = undefined;
    io.close();
    await new Promise((resolve) => httpServer.close(resolve));
  });

  function connect(query = {}, auth = { token: TEST_TOKEN }) {
    clientSocket = ioClient(`http://localhost:${port}/terminal`, {
      forceNew: true,
      query,
      auth,
    });
    return clientSocket;
  }

  async function connectAndWaitForPty(query = {}) {
    const socket = connect(query);
    await new Promise((resolve) => socket.on('connect', resolve));
    await vi.waitFor(() => expect(mockPty).not.toBeNull());
    return socket;
  }

  it('rejects socket connections with no auth token', async () => {
    const socket = connect({}, {});
    const error = await new Promise((resolve) => socket.on('connect_error', resolve));
    expect(error.message).toBe('Authentication failed');
    expect(mockPty).toBeNull();
  });

  it('rejects socket connections with an invalid auth token', async () => {
    const socket = connect({}, { token: 'wrong-token' });
    const error = await new Promise((resolve) => socket.on('connect_error', resolve));
    expect(error.message).toBe('Authentication failed');
    expect(mockPty).toBeNull();
  });

  it('spawns a pty process when a client connects', async () => {
    await connectAndWaitForPty();

    expect(pty.spawn).toHaveBeenCalledWith(
      'tmux',
      ['attach', '-t', 'test-session'],
      expect.objectContaining({ name: 'xterm-256color', cols: 80, rows: 24 }),
    );
  });

  it('passes custom cols/rows from handshake query', async () => {
    await connectAndWaitForPty({ cols: '120', rows: '40' });

    expect(pty.spawn).toHaveBeenCalledWith(
      'tmux',
      ['attach', '-t', 'test-session'],
      expect.objectContaining({ cols: 120, rows: 40 }),
    );
  });

  it('forwards pty data to the client as output events', async () => {
    await connectAndWaitForPty();

    const dataCallback = mockPty.onData.mock.calls[0][0];
    const outputPromise = new Promise((resolve) => clientSocket.on('output', resolve));

    dataCallback('hello from pty');

    expect(await outputPromise).toBe('hello from pty');
  });

  it('writes client input to the pty', async () => {
    await connectAndWaitForPty();

    clientSocket.emit('input', 'ls -la\n');

    await vi.waitFor(() => expect(mockPty.write).toHaveBeenCalledWith('ls -la\n'));
  });

  it('resizes the pty on resize events', async () => {
    await connectAndWaitForPty();

    clientSocket.emit('resize', { cols: 100, rows: 50 });

    await vi.waitFor(() => expect(mockPty.resize).toHaveBeenCalledWith(100, 50));
  });

  it('ignores invalid resize payloads', async () => {
    await connectAndWaitForPty();

    clientSocket.emit('resize', null);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mockPty.resize).not.toHaveBeenCalled();
  });

  it('kills the pty when client disconnects', async () => {
    await connectAndWaitForPty();

    await new Promise((resolve) => {
      clientSocket.on('disconnect', resolve);
      clientSocket.disconnect();
    });

    await vi.waitFor(() => expect(mockPty.kill).toHaveBeenCalled());
  });

  it('disconnects the client when pty exits', async () => {
    await connectAndWaitForPty();

    const exitCallback = mockPty.onExit.mock.calls[0][0];
    const disconnectPromise = new Promise((resolve) => clientSocket.on('disconnect', resolve));

    exitCallback({ exitCode: 0 });

    await disconnectPromise;
    expect(clientSocket.connected).toBe(false);
  });
});
