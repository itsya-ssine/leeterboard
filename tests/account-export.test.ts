/**
 * "Download my data" (GET /api/account/export): a member can download
 * everything stored about them as JSON, and nothing more. The id always comes
 * from the session, secrets never leave the database, and an anonymous caller
 * gets nothing.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { client, startServer, type TestServer } from "./helpers.js";
import { makeUser } from "./f2-seed.js";

const PW = "correct-horse-battery-9";
let tmpDir = "";
let server: TestServer;
let api: ReturnType<typeof client>;
const ids = new Map<string, string>();
const sessions = new Map<string, string>();
const as = (name: string) => sessions.get(name)!;
let db: typeof import("../db.js");

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-export-"));
  const dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");
  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");
  const hash = await hashPassword(PW);

  for (const name of ["ex_owner", "ex_other"]) {
    const user = makeUser(name, {
      history: [
        { date: "2026-11-10", solvedCount: 95, easy: 48, medium: 37, hard: 10, weeklyProgress: 1 },
        { date: "2026-11-11", solvedCount: 100, easy: 50, medium: 40, hard: 10, weeklyProgress: 5 }
      ]
    });
    await db.insertUser(user, hash, { loginUsername: name });
    ids.set(name, user.id);
    // insertUser does not write profile details; the profile route does. Set them directly.
    await db.client.execute({
      sql: "UPDATE users SET bio = ?, school = ? WHERE id = ?",
      args: [`bio of ${name}`, name === "ex_owner" ? "ENSA Khouribga" : "Elsewhere", user.id]
    });
  }

  const owner = ids.get("ex_owner")!;
  const other = ids.get("ex_other")!;
  const now = new Date().toISOString();
  const run = (sql: string, args: unknown[]) => db.client.execute({ sql, args: args as any });

  await run("UPDATE users SET email = ?, email_verified_at = ? WHERE id = ?", ["owner@example.com", now, owner]);
  await run("UPDATE users SET email = ? WHERE id = ?", ["other@example.com", other]);
  await run(
    `INSERT INTO platform_accounts (user_id, platform, handle, solved, weekly_solved, monthly_solved, rating, extra, linked_at, hidden)
     VALUES (?, 'codeforces', 'owner_cf', 321, 4, 20, 1500, '{"buckets":[1,2,3]}', ?, 1)`,
    [owner, now]
  );
  await run("INSERT INTO platform_history (user_id, platform, date, solved, rating) VALUES (?, 'codeforces', '2026-11-11', 321, 1500)", [owner]);
  await run("INSERT INTO oauth_identities (provider, provider_user_id, user_id, created_at) VALUES ('github', 'gh-777', ?, ?)", [owner, now]);
  await run("INSERT INTO user_awards (user_id, award_key, awarded_at) VALUES (?, '_baseline', ?), (?, 'badge:solved-100', ?)", [owner, now, owner, now]);
  await run(
    "INSERT INTO notifications (id, user_id, type, title, body, created_at, dismissed_at, sender_id, broadcast_id) VALUES ('n-own', ?, 'admin', 'Hello', 'Welcome', ?, ?, 'admin-secret-id', 'bcast-1')",
    [owner, now, now]
  );
  await run("INSERT INTO notifications (id, user_id, type, title, body, created_at) VALUES ('n-other', ?, 'admin', 'Not yours', '', ?)", [other, now]);
  await run("INSERT INTO feedback (id, user_id, category, message, page, created_at) VALUES ('f-own', ?, 'idea', 'my idea', '#/stats', ?)", [owner, now]);
  await run("INSERT INTO feedback (id, user_id, category, message, page, created_at) VALUES ('f-other', ?, 'bug', 'their bug', '', ?)", [other, now]);
  await run("INSERT INTO feedback (id, user_id, category, message, page, created_at) VALUES ('f-anon', NULL, 'bug', 'anonymous', '', ?)", [now]);
  await db.setMeta("lastSyncAll", now);

  server = await startServer({ TURSO_DATABASE_URL: dbUrl, JWT_SECRET: secret });
  api = client(server);
  for (const name of ["ex_owner", "ex_other"]) {
    const res = await api("POST", "/api/auth/login", { body: { username: name, password: PW } });
    assert.equal(res.status, 200, name);
    sessions.set(name, res.cookie!);
  }
});

after(async () => {
  await server?.stop();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /api/account/export", () => {
  it("refuses anonymous callers", async () => {
    const res = await api("GET", "/api/account/export");
    assert.equal(res.status, 401);
    assert.ok(!res.text.includes("owner@example.com"));
  });

  it("downloads a JSON attachment that is never cached", async () => {
    const res = await api("GET", "/api/account/export", { cookie: as("ex_owner") });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
    assert.match(res.headers.get("content-disposition") ?? "", /^attachment; filename="leeterboard-ex_owner-\d{4}-\d{2}-\d{2}\.json"$/);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(res.json.format, "leeterboard-export");
    assert.equal(res.json.version, 1);
    assert.ok(!Number.isNaN(Date.parse(res.json.exportedAt)));
  });

  it("contains the member's profile, e-mail and sign-in connections", async () => {
    const { json } = await api("GET", "/api/account/export", { cookie: as("ex_owner") });
    assert.equal(json.account.id, ids.get("ex_owner"));
    assert.equal(json.account.username, "ex_owner");
    assert.equal(json.account.email, "owner@example.com");
    assert.ok(json.account.emailVerifiedAt);
    assert.equal(json.account.school, "ENSA Khouribga");
    assert.equal(json.account.bio, "bio of ex_owner");
    assert.equal(json.signIn.hasPassword, true);
    assert.deepEqual(
      json.signIn.providers.map((p: any) => [p.provider, p.providerUserId]),
      [["github", "gh-777"]]
    );
  });

  it("contains LeetCode stats and daily history", async () => {
    const { json } = await api("GET", "/api/account/export", { cookie: as("ex_owner") });
    assert.equal(json.leetcode.username, "ex_owner");
    assert.equal(json.leetcode.current.solved, 100);
    assert.equal(json.leetcode.baselineSolved, 90);
    assert.deepEqual(json.leetcode.history.map((h: any) => [h.date, h.solved]), [
      ["2026-11-10", 95],
      ["2026-11-11", 100]
    ]);
  });

  it("contains linked platforms (with their parsed extra data and history), awards, notifications and feedback", async () => {
    const { json } = await api("GET", "/api/account/export", { cookie: as("ex_owner") });
    assert.equal(json.platforms.length, 1);
    const cf = json.platforms[0];
    assert.equal(cf.platform, "codeforces");
    assert.equal(cf.handle, "owner_cf");
    assert.equal(cf.hiddenFromOthers, true);
    assert.deepEqual(cf.extra, { buckets: [1, 2, 3] });
    assert.deepEqual(cf.history, [{ date: "2026-11-11", solved: 321, rating: 1500 }]);

    assert.deepEqual(json.awards.map((a: any) => a.key), ["badge:solved-100"], "the internal _baseline marker is not exported");

    assert.equal(json.notifications.length, 1);
    assert.equal(json.notifications[0].id, "n-own");
    assert.ok(json.notifications[0].dismissedAt, "dismissed notifications are still held, so still exported");

    assert.deepEqual(json.feedback.map((f: any) => f.id), ["f-own"]);
    assert.equal(json.feedback[0].message, "my idea");
  });

  it("never contains another member's data, an admin's id, or any secret", async () => {
    const res = await api("GET", "/api/account/export", { cookie: as("ex_owner") });
    for (const leaked of [
      "other@example.com",
      "ex_other",
      "n-other",
      "their bug",
      "anonymous",
      "admin-secret-id",
      "bcast-1",
      "scrypt$",
      "password_hash",
      "passwordHash",
      "failedLogins",
      "lockedUntil"
    ]) {
      assert.ok(!res.text.includes(leaked), `export must not contain ${leaked}`);
    }
    assert.ok(Array.isArray(res.json.notIncluded) && res.json.notIncluded.length > 0, "says what is left out");
  });

  it("only ever exports the signed-in member, whatever the request says", async () => {
    const other = await api("GET", `/api/account/export?id=${ids.get("ex_owner")}&userId=${ids.get("ex_owner")}`, {
      cookie: as("ex_other")
    });
    assert.equal(other.status, 200);
    assert.equal(other.json.account.id, ids.get("ex_other"));
    assert.equal(other.json.account.email, "other@example.com");
    assert.ok(!other.text.includes("owner@example.com"));
  });

  it("handles a member with no LeetCode, no platforms and no e-mail", async () => {
    const lone = makeUser("ex_lone", { leetcodeUsername: "" });
    const { hashPassword } = await import("../auth.js");
    await db.insertUser(lone, await hashPassword(PW), { loginUsername: "ex_lone" });
    await db.client.execute({ sql: "UPDATE users SET leetcode_username = NULL, avatar_url = NULL WHERE id = ?", args: [lone.id] });
    const login = await api("POST", "/api/auth/login", { body: { username: "ex_lone", password: PW } });
    assert.equal(login.status, 200);
    const { status, json } = await api("GET", "/api/account/export", { cookie: login.cookie });
    assert.equal(status, 200);
    assert.equal(json.leetcode, null);
    assert.equal(json.account.email, null);
    assert.deepEqual(json.platforms, []);
    assert.deepEqual(json.awards, []);
    assert.deepEqual(json.notifications, []);
    assert.deepEqual(json.feedback, []);
  });

  it("is logged as a security event without the data itself", async () => {
    await api("GET", "/api/account/export", { cookie: as("ex_owner") });
    const logs = server.logs();
    assert.match(logs, /"event":"account_exported"[^\n]*"username":"ex_owner"/);
    assert.ok(!logs.includes("owner@example.com"));
  });
});
