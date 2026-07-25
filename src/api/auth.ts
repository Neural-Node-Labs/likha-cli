import { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";

/**
 * Token-based authentication middleware for the xcoder API.
 *
 * The system authenticates against a user store managed by routes.ts.
 * When the user table is empty, the first user to register becomes an admin.
 * There is no static admin password — all auth goes through the user store.
 */

// ─── Token Store ────────────────────────────────────────────────────────────

interface TokenEntry {
  username: string;
  role: "admin" | "user";
  createdAt: string;
}

const tokenStore = new Map<string, TokenEntry>();

// ─── User Store (injected by routes.ts) ─────────────────────────────────────

export interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
  role: "admin" | "user";
  createdAt: string;
}

let userStore: StoredUser[] = [];

/**
 * Set the user store reference. Called by routes.ts on startup.
 */
export function setUserStore(store: StoredUser[]): void {
  userStore = store;
}

/**
 * Get the current user store reference.
 */
export function getUserStore(): StoredUser[] {
  return userStore;
}

// ─── Token Management ───────────────────────────────────────────────────────

/**
 * Generate a new token for a user and store it.
 * Returns the token string.
 */
export function generateToken(username: string, role: "admin" | "user" = "user"): string {
  const token = crypto.randomUUID();
  tokenStore.set(token, {
    username,
    role,
    createdAt: new Date().toISOString(),
  });
  return token;
}

/**
 * Validate a Bearer token. Returns the token entry if valid, null otherwise.
 */
export function validateToken(token: string): TokenEntry | null {
  return tokenStore.get(token) ?? null;
}

/**
 * Remove a token from the store (logout).
 */
export function revokeToken(token: string): boolean {
  return tokenStore.delete(token);
}

/**
 * Get all tokens for a given username (for admin user management).
 */
export function getTokensForUser(username: string): string[] {
  const tokens: string[] = [];
  for (const [token, entry] of tokenStore) {
    if (entry.username === username) {
      tokens.push(token);
    }
  }
  return tokens;
}

// ─── Password Hashing ───────────────────────────────────────────────────────
//
// Uses scrypt (via Node's built-in node:crypto — no extra dependency) rather than a single
// SHA-256 pass. SHA-256 is a fast general-purpose hash: cheap to compute means cheap to brute
// force at scale on GPUs/ASICs. scrypt is a deliberately slow, memory-hard KDF designed for
// password storage, which is what we actually want here.
//
// Format: "scrypt:N:r:p:salt:hash" so cost parameters travel with the hash and can be bumped
// later (e.g. increasing N) without invalidating already-stored hashes using the old parameters.
// Old "salt:hash" (bare SHA-256) values from before this change still verify correctly via the
// legacy path below, so existing users aren't locked out — but every successful login re-hashes
// with scrypt and the caller should persist the upgraded hash (see verifyPasswordWithUpgrade).

const SCRYPT_N = 16384; // CPU/memory cost factor (2^14) — Node's documented default
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function scryptHash(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }).toString("hex");
}

/**
 * Hash a password using scrypt with a random salt.
 * Returns "scrypt:N:r:p:salt:hash" format.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = scryptHash(password, salt);
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt}:${hash}`;
}

/**
 * Verify a password against a stored hash. Supports both the current scrypt format
 * ("scrypt:N:r:p:salt:hash") and the legacy bare SHA-256 format ("salt:hash") for
 * hashes created before this change.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");

  if (parts[0] === "scrypt" && parts.length === 6) {
    const [, nStr, rStr, pStr, salt, hash] = parts;
    const n = Number(nStr);
    const r = Number(rStr);
    const p = Number(pStr);
    if (!salt || !hash || !Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
    const computed = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { N: n, r, p }).toString("hex");
    return timingSafeEqualHex(computed, hash);
  }

  // Legacy path: bare "salt:hash" SHA-256 hashes from before scrypt was introduced.
  if (parts.length === 2) {
    const [salt, hash] = parts;
    if (!salt || !hash) return false;
    const computed = crypto.createHash("sha256").update(salt + password).digest("hex");
    return timingSafeEqualHex(computed, hash);
  }

  return false;
}

/**
 * True if a stored hash is in the legacy (pre-scrypt) format and should be upgraded
 * on next successful login.
 */
export function isLegacyHash(stored: string): boolean {
  return stored.split(":").length === 2;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ─── Login Verification ─────────────────────────────────────────────────────

/**
 * Verify login credentials against the user store.
 * Returns the user on success, null on failure.
 */
export function verifyLogin(username: string, password: string): StoredUser | null {
  const user = userStore.find((u) => u.username === username);
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return user;
}

// ─── Login Rate Limiting ────────────────────────────────────────────────────
//
// Simple in-memory sliding-window limiter for /login and /register. Password hashing alone
// (even scrypt) doesn't stop an attacker from just trying many passwords against the endpoint
// — this caps how many attempts a given key (IP + username) gets in a time window. In-memory
// is fine for xcoder's typical single-process deployment; a multi-instance deployment behind a
// load balancer would need a shared store (Redis, etc.) instead.

interface RateLimitEntry {
  attempts: number[]; // timestamps (ms) of recent attempts within the window
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_ATTEMPTS = 10;

/**
 * Records an attempt for `key` and returns whether the caller is currently rate-limited.
 * `key` should combine the identifying info that matters (e.g. `${ip}:${username}`).
 */
export function checkRateLimit(key: string): { limited: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key) ?? { attempts: [] };

  // Drop attempts outside the window
  entry.attempts = entry.attempts.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (entry.attempts.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    const oldest = entry.attempts[0];
    rateLimitStore.set(key, entry);
    return { limited: true, retryAfterMs: RATE_LIMIT_WINDOW_MS - (now - oldest) };
  }

  entry.attempts.push(now);
  rateLimitStore.set(key, entry);
  return { limited: false };
}

/** Periodically clean up expired entries so the map doesn't grow unbounded. */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    entry.attempts = entry.attempts.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (entry.attempts.length === 0) rateLimitStore.delete(key);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

// ─── Express Middleware ─────────────────────────────────────────────────────

/**
 * Express middleware that validates the Authorization header.
 *
 * Requires a valid Bearer token from the token store for all routes
 * except /login and /register.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for login and register endpoints
  if ((req.path === "/login" && req.method === "POST") ||
      (req.path === "/register" && req.method === "POST") ||
      (req.path === "/users/count" && req.method === "GET")) {
    next();
    return;
  }

  const header = req.headers.authorization;
  if (!header) {
    res.status(401).json({ success: false, error: "Missing Authorization header" });
    return;
  }

  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    res.status(401).json({ success: false, error: "Authorization header must be: Bearer <token>" });
    return;
  }

  const token = parts[1];
  const entry = validateToken(token);
  if (!entry) {
    res.status(403).json({ success: false, error: "Invalid or expired API token" });
    return;
  }

  // Attach user info to request for downstream use
  (req as any).user = entry;

  next();
}


