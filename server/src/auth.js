import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TOKEN_LENGTH = 32; // 32 bytes = 64 hex characters

/**
 * Returns the path to the auth token file.
 */
export function getTokenPath() {
  return join(homedir(), '.dancode', 'auth-token');
}

/**
 * Generate a cryptographically random token as a hex string.
 */
export function generateToken() {
  return randomBytes(TOKEN_LENGTH).toString('hex');
}

/**
 * Ensure the auth token file exists. If it doesn't, generate a new token,
 * write it to disk, and log it to the console. Returns the token.
 */
export async function ensureAuthToken(tokenPath = getTokenPath()) {
  const dir = dirname(tokenPath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  if (existsSync(tokenPath)) {
    const token = (await readFile(tokenPath, 'utf-8')).trim();
    return { token, created: false };
  }

  const token = generateToken();
  await writeFile(tokenPath, token + '\n', { mode: 0o600 });
  console.log(`\n  DanCode auth token (save this): ${token}\n`);
  return { token, created: true };
}

/**
 * Read the current auth token from disk.
 */
export async function readAuthToken(tokenPath = getTokenPath()) {
  const contents = await readFile(tokenPath, 'utf-8');
  return contents.trim();
}

/**
 * Timing-safe comparison of two token strings.
 * Returns false if either value is not a string or lengths differ.
 */
export function validateToken(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
