import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import bcrypt from 'bcryptjs';
import { generate, generateSecret, verify, generateURI } from 'otplib';
import QRCode from 'qrcode';

const SESSION_TOKEN_LENGTH = 32; // 32 bytes = 64 hex characters
const BCRYPT_ROUNDS = 12;

/**
 * Returns the path to the credentials file.
 */
export function getCredentialsPath() {
  return join(homedir(), '.dancode', 'credentials.json');
}

/**
 * Check if an account has been set up (credentials file exists and has data).
 */
export async function isAccountSetUp(credPath = getCredentialsPath()) {
  if (!existsSync(credPath)) return false;
  try {
    const data = JSON.parse(await readFile(credPath, 'utf-8'));
    return !!(data.username && data.passwordHash && data.totpSecret);
  } catch {
    return false;
  }
}

/**
 * Read stored credentials from disk.
 */
export async function readCredentials(credPath = getCredentialsPath()) {
  const data = JSON.parse(await readFile(credPath, 'utf-8'));
  return data;
}

/**
 * Create a new account: hash password, generate TOTP secret, save to disk.
 * Returns { totpSecret, otpauthUrl, qrCodeDataUrl }.
 */
export async function createAccount(username, password, credPath = getCredentialsPath()) {
  const dir = dirname(credPath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const totpSecret = generateSecret();
  const otpauthUrl = generateURI({
    secret: totpSecret,
    issuer: 'DanCode',
    accountName: username,
    type: 'totp',
  });

  const credentials = {
    username,
    passwordHash,
    totpSecret,
    createdAt: new Date().toISOString(),
  };

  await writeFile(credPath, JSON.stringify(credentials, null, 2) + '\n', { mode: 0o600 });

  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  console.log(`\n  DanCode account created for "${username}"`);
  console.log(`  TOTP secret (for manual entry): ${totpSecret}\n`);

  return { totpSecret, otpauthUrl, qrCodeDataUrl };
}

/**
 * Verify username + password + TOTP code against stored credentials.
 * Returns true if all three match.
 */
export async function verifyLogin(username, password, totpCode, credPath = getCredentialsPath()) {
  let creds;
  try {
    creds = await readCredentials(credPath);
  } catch {
    return false;
  }

  if (username !== creds.username) return false;

  const passwordValid = await bcrypt.compare(password, creds.passwordHash);
  if (!passwordValid) return false;

  const result = await verify({ token: totpCode, secret: creds.totpSecret });
  return result.valid;
}

/**
 * Generate a cryptographically random session token as a hex string.
 */
export function generateSessionToken() {
  return randomBytes(SESSION_TOKEN_LENGTH).toString('hex');
}

/**
 * Timing-safe comparison of two token strings.
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

/**
 * In-memory session store. Maps session tokens to { username, createdAt }.
 * Sessions live as long as the server process runs.
 */
const sessions = new Map();

export function createSession(username) {
  const token = generateSessionToken();
  sessions.set(token, { username, createdAt: Date.now() });
  return token;
}

export function validateSession(token) {
  if (typeof token !== 'string') return false;
  return sessions.has(token);
}

export function destroySession(token) {
  sessions.delete(token);
}

export function getSessionCount() {
  return sessions.size;
}

/** Clear all sessions (useful for tests). */
export function clearSessions() {
  sessions.clear();
}
