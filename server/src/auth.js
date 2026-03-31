import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import bcrypt from 'bcryptjs';
import { generate, generateSecret, verify, generateURI } from 'otplib';
import QRCode from 'qrcode';

const SESSION_TOKEN_LENGTH = 32; // 32 bytes = 64 hex characters
const BCRYPT_ROUNDS = 12;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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
 * Session store. Maps session tokens to { username, createdAt }.
 * Persisted to ~/.dancode/sessions.json so sessions survive server restarts.
 */
const sessions = new Map();
const sessionsPath = join(homedir(), '.dancode', 'sessions.json');

function loadSessions() {
  try {
    if (existsSync(sessionsPath)) {
      const data = JSON.parse(readFileSync(sessionsPath, 'utf-8'));
      for (const [token, session] of Object.entries(data)) {
        sessions.set(token, session);
      }
    }
  } catch {
    // Start fresh if file is corrupted
  }

  // Clean expired sessions on startup
  const cleaned = cleanExpiredSessions();
  if (cleaned > 0) {
    console.log(`[auth] Cleaned ${cleaned} expired session(s) on startup`);
  }
}

/** Debounce timer for batching disk writes. */
let saveTimer = null;

/**
 * Persist sessions to disk using async writeFile with 100ms debounce.
 * Multiple rapid calls batch into a single disk write.
 */
function saveSessions() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const data = Object.fromEntries(sessions);
    try {
      await writeFile(sessionsPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    } catch {
      // Ignore write errors
    }
  }, 100);
}

/** Flush any pending debounced save immediately. Useful for tests. */
export async function flushSessionSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const data = Object.fromEntries(sessions);
  try {
    await writeFile(sessionsPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  } catch {
    // Ignore write errors
  }
}

// Load persisted sessions on module init
loadSessions();

export function createSession(username) {
  const token = generateSessionToken();
  sessions.set(token, { username, createdAt: Date.now() });
  saveSessions();
  return token;
}

export function validateSession(token) {
  if (typeof token !== 'string') return false;
  const session = sessions.get(token);
  if (!session) return false;

  // Check 30-day TTL
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    saveSessions();
    return false;
  }

  return true;
}

export function destroySession(token) {
  sessions.delete(token);
  saveSessions();
}

export function getSessionCount() {
  return sessions.size;
}

/**
 * Remove all expired sessions from the in-memory Map.
 * Persists the cleanup via debounced save. Returns number cleaned.
 */
export function cleanExpiredSessions() {
  const now = Date.now();
  let cleaned = 0;
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(token);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    saveSessions();
  }
  return cleaned;
}

/** Periodic cleanup interval handle. */
let cleanupInterval = null;

/** Start hourly cleanup of expired sessions. */
export function startSessionCleanupInterval() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(cleanExpiredSessions, 60 * 60 * 1000);
  cleanupInterval.unref(); // Don't prevent process exit
}

/** Stop the hourly cleanup interval. */
export function stopSessionCleanupInterval() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/** Clear all sessions (useful for tests). */
export function clearSessions() {
  sessions.clear();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}
