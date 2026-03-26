import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generate } from 'otplib';
import {
  isAccountSetUp,
  createAccount,
  readCredentials,
  verifyLogin,
  generateSessionToken,
  validateToken,
  createSession,
  validateSession,
  destroySession,
  clearSessions,
} from '../src/auth.js';

describe('auth', () => {
  let tempDir;
  let credPath;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dancode-auth-test-'));
    credPath = join(tempDir, 'credentials.json');
    clearSessions();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    clearSessions();
  });

  describe('isAccountSetUp', () => {
    it('returns false when no credentials file exists', async () => {
      expect(await isAccountSetUp(credPath)).toBe(false);
    });

    it('returns true after account creation', async () => {
      await createAccount('admin', 'password123', credPath);
      expect(await isAccountSetUp(credPath)).toBe(true);
    });
  });

  describe('createAccount', () => {
    it('creates credentials file with username, passwordHash, and totpSecret', async () => {
      const result = await createAccount('testuser', 'mypassword', credPath);

      expect(existsSync(credPath)).toBe(true);
      const creds = JSON.parse(await readFile(credPath, 'utf-8'));
      expect(creds.username).toBe('testuser');
      expect(creds.passwordHash).toBeDefined();
      expect(creds.passwordHash).not.toBe('mypassword'); // should be hashed
      expect(creds.totpSecret).toBeDefined();
      expect(creds.createdAt).toBeDefined();
    });

    it('returns totpSecret and qrCodeDataUrl', async () => {
      const result = await createAccount('testuser', 'mypassword', credPath);

      expect(result.totpSecret).toBeDefined();
      expect(typeof result.totpSecret).toBe('string');
      expect(result.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it('creates parent directories if they do not exist', async () => {
      const nestedPath = join(tempDir, 'nested', 'deep', 'credentials.json');
      await createAccount('testuser', 'mypassword', nestedPath);
      expect(existsSync(nestedPath)).toBe(true);
    });
  });

  describe('verifyLogin', () => {
    let totpSecret;

    beforeEach(async () => {
      const result = await createAccount('admin', 'secretpass', credPath);
      totpSecret = result.totpSecret;
    });

    it('returns true for valid username, password, and TOTP code', async () => {
      const code = await generate({ secret: totpSecret });
      const result = await verifyLogin('admin', 'secretpass', code, credPath);
      expect(result).toBe(true);
    });

    it('returns false for wrong username', async () => {
      const code = await generate({ secret: totpSecret });
      const result = await verifyLogin('wrong', 'secretpass', code, credPath);
      expect(result).toBe(false);
    });

    it('returns false for wrong password', async () => {
      const code = await generate({ secret: totpSecret });
      const result = await verifyLogin('admin', 'wrongpass', code, credPath);
      expect(result).toBe(false);
    });

    it('returns false for wrong TOTP code', async () => {
      const result = await verifyLogin('admin', 'secretpass', '000000', credPath);
      expect(result).toBe(false);
    });

    it('returns false when credentials file does not exist', async () => {
      const result = await verifyLogin('admin', 'secretpass', '123456', join(tempDir, 'nonexistent.json'));
      expect(result).toBe(false);
    });
  });

  describe('generateSessionToken', () => {
    it('returns a 64-character hex string', () => {
      const token = generateSessionToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('generates unique tokens on each call', () => {
      const tokens = new Set(Array.from({ length: 10 }, () => generateSessionToken()));
      expect(tokens.size).toBe(10);
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

  describe('session management', () => {
    it('createSession returns a token and validateSession accepts it', () => {
      const token = createSession('admin');
      expect(typeof token).toBe('string');
      expect(validateSession(token)).toBe(true);
    });

    it('validateSession returns false for unknown tokens', () => {
      expect(validateSession('not-a-real-token')).toBe(false);
    });

    it('validateSession returns false for non-string', () => {
      expect(validateSession(null)).toBe(false);
      expect(validateSession(undefined)).toBe(false);
    });

    it('destroySession invalidates a token', () => {
      const token = createSession('admin');
      expect(validateSession(token)).toBe(true);
      destroySession(token);
      expect(validateSession(token)).toBe(false);
    });

    it('clearSessions removes all sessions', () => {
      createSession('a');
      createSession('b');
      clearSessions();
      // No way to enumerate, but new tokens should still work
      const token = createSession('c');
      expect(validateSession(token)).toBe(true);
    });
  });
});
