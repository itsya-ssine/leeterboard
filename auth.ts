import jwt from "jsonwebtoken";
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { getUserAuthById } from "./db.js";
import type { User } from "./src/types.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Fail loudly rather than silently signing tokens with a guessable
  // fallback secret — that would let anyone forge a session.
  throw new Error("JWT_SECRET environment variable is required. Set it in your .env file.");
}
const JWT_SECRET_HELP =
  'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"';
if (JWT_SECRET.length < 32) {
  throw new Error(`JWT_SECRET is too short (need at least 32 characters). ${JWT_SECRET_HELP}`);
}
// Length alone doesn't make a secret strong: reject obvious placeholders and
// low-variety values (e.g. "aaaa…", "changeme…") copied from docs or examples.
if (
  new Set(JWT_SECRET).size < 10 ||
  /change[-_ ]?me|your[-_ ]?secret|example|placeholder|secret[-_ ]?key|password/i.test(JWT_SECRET)
) {
  throw new Error(`JWT_SECRET looks like a placeholder or is not random enough. ${JWT_SECRET_HELP}`);
}

/* ---------- Password hashing (scrypt, built into Node — no extra dependency) ---------- */

// Stored as  scrypt$N$r$p$salt$hash  (salt + hash base64). The parameters are
// stored with each hash, so they can be raised later without invalidating
// existing passwords.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keyLen: 64 } as const;
const HASH_PREFIX = "scrypt$";

export const MIN_PASSWORD_LENGTH = 8;
// Upper bound so nobody can make us hash megabytes of input.
export const MAX_PASSWORD_LENGTH = 128;

function scrypt(password: string, salt: Buffer, keyLen: number, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keyLen, { N, r, p, maxmem: 128 * N * r * 2 }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

// NFKC so the "same" password typed on different keyboards/OSes hashes equally.
const normalize = (password: string) => password.normalize("NFKC");

// True only for hashes this module produced. Accounts created before
// passwords existed have "" (or an old format) here and count as unclaimed.
export function isPasswordHash(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(HASH_PREFIX);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(normalize(password), salt, SCRYPT.keyLen, SCRYPT.N, SCRYPT.r, SCRYPT.p);
  return `${HASH_PREFIX}${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!isPasswordHash(stored)) return false;
  const parts = stored.split("$");
  if (parts.length !== 6) return false;
  const [, nStr, rStr, pStr, saltB64, keyB64] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (![N, r, p].every(Number.isInteger) || N < 2 || r < 1 || p < 1) return false;

  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(keyB64, "base64");
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const actual = await scrypt(normalize(password), salt, expected.length, N, r, p);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Does the same amount of work as a real check. Used when the username is
// unknown (or has no password yet) so response time doesn't reveal which.
let dummyHash: Promise<string> | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword(crypto.randomBytes(16).toString("hex"));
  await verifyPassword(password, await dummyHash);
}

/* ---------- Sessions ---------- */

const COOKIE_NAME = "session";
const SESSION_TTL = "7d";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  id: string;
  leetcodeUsername: string;
  // Fingerprint of the account's password hash at login time (see
  // sessionStamp). Absent only on tokens issued before passwords existed.
  ps?: string;
}

// Admins are listed by LeetCode username in the ADMIN_LEETCODE_USERNAMES
// environment variable (comma-separated). There is deliberately NO built-in
// default: if the variable is unset, nobody is an admin (fail closed), so a
// hardcoded username can never grant privileges by accident. Relying on a
// username is only safe because nobody can register one without proving they
// own that LeetCode profile.
const ADMIN_LEETCODE_USERNAMES = (process.env.ADMIN_LEETCODE_USERNAMES ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

if (ADMIN_LEETCODE_USERNAMES.length === 0) {
  console.warn(
    "[Auth] ADMIN_LEETCODE_USERNAMES is not set — no account has admin rights. " +
      "Set it to a comma-separated list of LeetCode usernames to enable the admin dashboard."
  );
}

export function isAdminUser(user: { leetcodeUsername: string }): boolean {
  return ADMIN_LEETCODE_USERNAMES.includes(user.leetcodeUsername.toLowerCase());
}

// A short keyed fingerprint of the current password hash, embedded in every
// session token. Changing the password changes the fingerprint, which
// instantly invalidates every session that was issued under the old one.
function sessionStamp(passwordHash: string): string {
  return crypto.createHmac("sha256", JWT_SECRET!).update(passwordHash).digest("hex").slice(0, 16);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

const cookieBase = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/"
};

export function setSessionCookie(res: Response, user: { id: string; leetcodeUsername: string }, passwordHash: string): void {
  const payload: SessionPayload = {
    id: user.id,
    leetcodeUsername: user.leetcodeUsername,
    ps: sessionStamp(passwordHash)
  };
  const token = jwt.sign(payload, JWT_SECRET!, { algorithm: "HS256", expiresIn: SESSION_TTL });
  res.cookie(COOKIE_NAME, token, { ...cookieBase, maxAge: SESSION_MAX_AGE_MS });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, cookieBase);
}

export function readSession(req: Request): SessionPayload | null {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token || typeof token !== "string") return null;
  try {
    // Pin the algorithm so a forged "alg: none" token can never verify.
    const decoded: any = jwt.verify(token, JWT_SECRET!, { algorithms: ["HS256"] });
    if (!decoded || typeof decoded !== "object") return null;
    // Tokens from the old 42 login flow with kind "pending" are not valid here.
    if (decoded.kind === "pending") return null;
    if (typeof decoded.id !== "string" || typeof decoded.leetcodeUsername !== "string") return null;
    return {
      id: decoded.id,
      leetcodeUsername: decoded.leetcodeUsername,
      ps: typeof decoded.ps === "string" ? decoded.ps : undefined
    };
  } catch {
    return null; // expired or tampered — treat as logged out
  }
}

// Reads the cookie AND checks it against the database: the account must still
// exist and the password must not have changed since the token was issued.
// Tokens from before passwords existed (no `ps`) stay valid only until the
// account is claimed with a password.
export async function resolveSession(req: Request): Promise<{ user: User; isAdmin: boolean } | null> {
  const session = readSession(req);
  if (!session) return null;

  const record = await getUserAuthById(session.id);
  if (!record) return null;

  const hasPassword = isPasswordHash(record.auth.passwordHash);
  const valid =
    session.ps !== undefined
      ? hasPassword && safeEqual(session.ps, sessionStamp(record.auth.passwordHash))
      : !hasPassword;
  if (!valid) return null;

  return { user: record.user, isAdmin: isAdminUser(record.user) };
}

// Express middleware: rejects the request unless a valid session is present,
// and attaches { id, leetcodeUsername } to req.user for handlers to use.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const resolved = await resolveSession(req);
    if (!resolved) return res.status(401).json({ error: "You must be logged in to do that." });
    (req as any).user = { id: resolved.user.id, leetcodeUsername: resolved.user.leetcodeUsername };
    next();
  } catch (err) {
    next(err);
  }
}

// Like requireAuth, but additionally rejects (403) unless the signed-in
// member is an admin (see isAdminUser above).
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const resolved = await resolveSession(req);
    if (!resolved) return res.status(401).json({ error: "You must be logged in to do that." });
    if (!resolved.isAdmin) return res.status(403).json({ error: "Admin access required." });
    (req as any).user = { id: resolved.user.id, leetcodeUsername: resolved.user.leetcodeUsername };
    next();
  } catch (err) {
    next(err);
  }
}