import { describe, it, expect, afterEach } from 'vitest';
import pty from 'node-pty';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  sessionName,
  createSession,
  hasSession,
  killSession,
  capturePane,
  sendKeys,
  resizePane,
  listDancodeSessions,
} from '../src/tmux.js';

const execFileAsync = promisify(execFile);

describe('tmux utility module', () => {
  const sessionsToClean = [];

  afterEach(async () => {
    for (const name of sessionsToClean) {
      await killSession(name);
    }
    sessionsToClean.length = 0;
  });

  describe('sessionName', () => {
    it('builds name in dancode-{slug}-{id} format', () => {
      expect(sessionName('my-project', 'abc-123')).toBe('dancode-my-project-abc-123');
    });
  });

  describe('createSession / hasSession / killSession', () => {
    it('creates a tmux session and verifies it exists', async () => {
      const name = 'dancode-test-create-' + Date.now();
      sessionsToClean.push(name);

      await createSession(name, { cols: 80, rows: 24 });
      expect(await hasSession(name)).toBe(true);
    });

    it('hasSession returns false for non-existent session', async () => {
      expect(await hasSession('dancode-nonexistent-' + Date.now())).toBe(false);
    });

    it('killSession destroys the session', async () => {
      const name = 'dancode-test-kill-' + Date.now();
      await createSession(name, { cols: 80, rows: 24 });
      expect(await hasSession(name)).toBe(true);

      await killSession(name);
      expect(await hasSession(name)).toBe(false);
    });

    it('killSession is silent for non-existent session', async () => {
      await killSession('dancode-nonexistent-' + Date.now());
      // no error thrown
    });

    it('creates session with correct dimensions when client is attached', async () => {
      const name = 'dancode-test-dims-' + Date.now();
      sessionsToClean.push(name);

      await createSession(name, { cols: 120, rows: 40 });

      // Attach a node-pty client to set the terminal size
      const p = pty.spawn('tmux', ['attach-session', '-t', name], {
        name: 'xterm-256color', cols: 120, rows: 40, env: process.env,
      });

      await new Promise((r) => setTimeout(r, 500));

      const { stdout } = await execFileAsync('tmux', [
        'display-message', '-t', name, '-p', '#{pane_width}x#{pane_height}',
      ]);
      expect(stdout.trim()).toBe('120x40');

      p.kill();
    });

    it('creates session with status bar disabled', async () => {
      const name = 'dancode-test-nostatus-' + Date.now();
      sessionsToClean.push(name);

      await createSession(name, { cols: 80, rows: 24 });

      const { stdout } = await execFileAsync('tmux', [
        'show-option', '-t', name, 'status',
      ]);
      expect(stdout.trim()).toBe('status off');
    });
  });

  describe('capturePane', () => {
    it('captures shell prompt output from a session', async () => {
      const name = 'dancode-test-capture-' + Date.now();
      sessionsToClean.push(name);

      await createSession(name, { cols: 80, rows: 24 });
      await sendKeys(name, 'echo CAPTURE_TEST_MARKER');

      // Wait for command to execute
      await new Promise((r) => setTimeout(r, 500));

      const output = await capturePane(name);
      expect(output).toContain('CAPTURE_TEST_MARKER');
    });

    it('returns empty string for non-existent session', async () => {
      const output = await capturePane('dancode-nonexistent-' + Date.now());
      expect(output).toBe('');
    });
  });

  describe('sendKeys', () => {
    it('sends keys to a tmux session', async () => {
      const name = 'dancode-test-sendkeys-' + Date.now();
      sessionsToClean.push(name);

      await createSession(name, { cols: 80, rows: 24 });
      await sendKeys(name, 'echo SENDKEYS_MARKER');

      await new Promise((r) => setTimeout(r, 500));

      const output = await capturePane(name);
      expect(output).toContain('SENDKEYS_MARKER');
    });
  });

  describe('resizePane', () => {
    it('resizes a tmux pane with client attached', async () => {
      const name = 'dancode-test-resize-' + Date.now();
      sessionsToClean.push(name);

      await createSession(name, { cols: 80, rows: 24 });

      // Attach a client so the pane size is controllable
      const p = pty.spawn('tmux', ['attach-session', '-t', name], {
        name: 'xterm-256color', cols: 120, rows: 40, env: process.env,
      });

      await new Promise((r) => setTimeout(r, 300));
      await resizePane(name, 120, 40);
      await new Promise((r) => setTimeout(r, 300));

      const { stdout } = await execFileAsync('tmux', [
        'display-message', '-t', name, '-p', '#{pane_width}x#{pane_height}',
      ]);
      expect(stdout.trim()).toBe('120x40');

      p.kill();
    });

    it('is silent for non-existent session', async () => {
      await resizePane('dancode-nonexistent-' + Date.now(), 80, 24);
      // no error thrown
    });
  });

  describe('listDancodeSessions', () => {
    it('lists sessions with dancode- prefix', async () => {
      const name = 'dancode-test-list-' + Date.now();
      sessionsToClean.push(name);

      await createSession(name, { cols: 80, rows: 24 });

      const sessions = await listDancodeSessions();
      expect(sessions).toContain(name);
    });

    it('does not list non-dancode sessions', async () => {
      const sessions = await listDancodeSessions();
      // Should not contain sessions without the dancode- prefix
      for (const s of sessions) {
        expect(s.startsWith('dancode-')).toBe(true);
      }
    });
  });
});
