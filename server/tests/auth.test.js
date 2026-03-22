import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateToken, ensureAuthToken, readAuthToken, validateToken } from '../src/auth.js';

describe('auth token', () => {
  let tempDir;
  let tokenPath;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dancode-auth-test-'));
    tokenPath = join(tempDir, 'auth-token');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('generateToken', () => {
    it('returns a 64-character hex string', () => {
      const token = generateToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('generates unique tokens on each call', () => {
      const tokens = new Set(Array.from({ length: 10 }, () => generateToken()));
      expect(tokens.size).toBe(10);
    });
  });

  describe('ensureAuthToken', () => {
    it('creates a new token file when none exists', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { token, created } = await ensureAuthToken(tokenPath);

      expect(created).toBe(true);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(existsSync(tokenPath)).toBe(true);

      const fileContents = await readFile(tokenPath, 'utf-8');
      expect(fileContents.trim()).toBe(token);

      consoleSpy.mockRestore();
    });

    it('logs the token to console on first generation', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { token } = await ensureAuthToken(tokenPath);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(token)
      );

      consoleSpy.mockRestore();
    });

    it('returns existing token without regenerating', async () => {
      const existingToken = 'a'.repeat(64);
      await writeFile(tokenPath, existingToken + '\n');

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { token, created } = await ensureAuthToken(tokenPath);

      expect(created).toBe(false);
      expect(token).toBe(existingToken);
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('creates parent directories if they do not exist', async () => {
      const nestedPath = join(tempDir, 'nested', 'deep', 'auth-token');
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { token, created } = await ensureAuthToken(nestedPath);

      expect(created).toBe(true);
      expect(existsSync(nestedPath)).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  describe('validateToken', () => {
    it('returns true for matching tokens', () => {
      expect(validateToken('abc123', 'abc123')).toBe(true);
    });

    it('returns false for non-matching tokens', () => {
      expect(validateToken('abc123', 'xyz789')).toBe(false);
    });

    it('returns false for different-length tokens', () => {
      expect(validateToken('short', 'muchlongertoken')).toBe(false);
    });

    it('returns false for non-string provided', () => {
      expect(validateToken(null, 'abc123')).toBe(false);
      expect(validateToken(undefined, 'abc123')).toBe(false);
      expect(validateToken(123, 'abc123')).toBe(false);
    });

    it('returns false for non-string expected', () => {
      expect(validateToken('abc123', null)).toBe(false);
      expect(validateToken('abc123', undefined)).toBe(false);
    });
  });

  describe('readAuthToken', () => {
    it('reads and trims the token from disk', async () => {
      const expectedToken = 'b'.repeat(64);
      await writeFile(tokenPath, expectedToken + '\n');

      const token = await readAuthToken(tokenPath);
      expect(token).toBe(expectedToken);
    });

    it('throws when file does not exist', async () => {
      await expect(readAuthToken(join(tempDir, 'nonexistent'))).rejects.toThrow();
    });
  });
});
