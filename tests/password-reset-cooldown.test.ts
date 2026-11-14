import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { client, startServer, type TestServer } from "./helpers.js";
import { makeFakeLeetCode, makeUser } from "./f2-seed.js";

const OLD_PW = "the-old-password-1";
const NEW_PW = "a-brand-new-password-42";
const ATTEMPT_PW = "attempt-new-password-99";

let tmpDir = "";
let server: TestServer;
let api: ReturnType<typeof client>;
let db: typeof import("../db.js");
const fake = makeFakeLeetCode();
let userId = "";

const resetCookieOf = (res: { headers: Headers }) => res.headers.get("set-cookie")?.match(/pwreset=[^;]+/)?.[0] ?? null;
const start = (body: Record<string, unknown>) => api("POST", "/api/auth/reset/start", { body });
const verify = (cookie: string | null) => api("POST", "/api/auth/reset/verify", { cookie });

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-reset-cd-"));
  const dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");
  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");
  const hash = await hashPassword(OLD_PW);

  const u = makeUser("rs_cooldown_user");
  await db.insertUser(u, hash);
  userId = u.id;
  fake.setAbout("rs_cooldown_user", "Bio before reset");

  server = await startServer({ TURSO_DATABASE_URL: dbUrl, JWT_SECRET: secret, ...fake.env });
  api = client(server);
});

after(async () => {
  await server?.stop();
  fake.cleanup();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Password Reset Cooldown Protection (SEC-06)", () => {
  it("completes first reset, sets password_reset_at and exposes it in /api/auth/session", async () => {
    const started = await start({ username: "rs_cooldown_user", platform: "leetcode", password: NEW_PW });
    assert.equal(started.status, 200);
    const code = started.json.code;

    fake.setAbout("rs_cooldown_user", `Profile content with ${code}`);
    const verified = await verify(resetCookieOf(started));
    assert.equal(verified.status, 200);
    assert.ok(verified.cookie);

    // Check /api/auth/session returns passwordResetAt
    const sessionRes = await api("GET", "/api/auth/session", { cookie: verified.cookie });
    assert.equal(sessionRes.status, 200);
    assert.ok(sessionRes.json.user.passwordResetAt);
    const resetTime = Date.parse(sessionRes.json.user.passwordResetAt);
    assert.ok(!Number.isNaN(resetTime));
    assert.ok(Date.now() - resetTime < 60_000);
  });

  it("blocks subsequent reset attempt within 24 hours with HTTP 429", async () => {
    const res = await start({ username: "rs_cooldown_user", platform: "leetcode", password: ATTEMPT_PW });
    assert.equal(res.status, 429);
    assert.match(res.json.error, /recently reset/i);
    assert.match(res.json.error, /wait \d+ hours?/i);

    const logs = server.logs();
    assert.match(logs, /"event":"ownership_blocked"[^\n]*"reason":"reset_cooldown"/);
  });

  it("permits reset once cooldown expires", async () => {
    // Manually backdate the password_reset_at timestamp to 25 hours ago
    const pastTime = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    await db.client.execute({
      sql: "UPDATE users SET password_reset_at = ? WHERE id = ?",
      args: [pastTime, userId]
    });

    const res = await start({ username: "rs_cooldown_user", platform: "leetcode", password: ATTEMPT_PW });
    assert.equal(res.status, 200);
    assert.ok(res.json.code);
  });
});
