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

/**
 * Hash a password using SHA-256 with a random salt.
 * Returns "salt:hash" format.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.createHash("sha256").update(salt + password).digest("hex");
  return `${salt}:${hash}`;
}

/**
 * Verify a password against a stored hash.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const computed = crypto.createHash("sha256").update(salt + password).digest("hex");
  return computed === hash;
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


