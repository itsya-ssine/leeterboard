/**
 * F2 regression: a LeetCode USERNAME is not a stable identity.
 *
 * If a member renames or deletes their LeetCode account, a stranger can later
 * register the same name on LeetCode and pass the "put this code in your
 * summary" check for it. That must NOT hand them the existing leaderboard
 * account when it is an admin account, or when its LeetCode name stopped
 * resolving (the very situation in which a name gets recycled).
 *
 * The tests run the real server against a fake LeetCode (fake-leetcode.mjs), so
 * "ownership proven" really succeeds. The point is to show it is not enough.
 * Everything is seeded before the server starts (see security.test.ts).
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { client, startServer, type TestServer } from "./helpers.js";
import { makeFakeLeetCode, makeUser } from "./f2-seed.js";

const PW = "correct-horse-battery-9";
const ATTACKER_PW = "attacker-chosen-password-99";
const BLOCKED_MESSAGE = "Claiming or resetting this account isn't available online. Please contact a Leeterboard admin.";
const DAY = 86_400_000;

let tmpDir = "";
let server: TestServer;
let api: ReturnType<typeof client>;
let db: typeof import("../db.js");
const fakeLeetCode = makeFakeLeetCode();

const ids = new Map<string, string>();
const newId = () => crypto.randomBytes(32).toString("hex");
const attackerRegistrations = new Map<string, { id: string; code: string }>();
// Responses kept so the "same answer for every reason" test needs no extra requests
// (register is limited to 10 per hour per IP).
const blockedResponses: Record<string, { status: number; json: any }> = {};

// Members and how their sync history looks.
const MEMBERS = {
  f2_admin: "legacy admin (listed in ADMIN_LEETCODE_USERNAMES)",
  f2_plain: "ordinary member, syncs fine",
  f2_gone: "LeetCode said the name doesn't exist, later syncs 'succeed' again",
  f2_gone_approved: "like f2_gone, but an admin approved the reset",
  f2_failing_long: "syncs failing for 8 days",
  f2_failing_recent: "syncs failing for 1 hour",
  f2_victim: "ordinary member who will reset their password"
};

async function hashOf(username: string): Promise<string> {
  return (await db.getUserAuthByUsername(username))!.auth.passwordHash;
}

async function pendingCount(username: string): Promise<number> {
  const res = await db.client.execute({
    sql: "SELECT COUNT(*) AS n FROM pending_registrations WHERE lower(leetcode_username) = lower(?)",
    args: [username]
  });
  return Number(res.rows[0].n);
}

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-f2a-"));
  const dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  process.env.ADMIN_LEETCODE_USERNAMES = "f2_admin";
  db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");

  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");
  const hash = await hashPassword(PW);
  for (const name of Object.keys(MEMBERS)) {
    const user = makeUser(name);
    await db.insertUser(user, hash);
    ids.set(name, user.id);
  }

  // f2_plain and f2_victim: healthy.
  await db.recordSyncResult(ids.get("f2_plain")!, { ok: true });
  await db.recordSyncResult(ids.get("f2_victim")!, { ok: true });

  // f2_gone: LeetCode said "no such user" and then (the recycled name) syncs fine again.
  await db.recordSyncResult(ids.get("f2_gone")!, { ok: false, state: "not_found", error: "gone" });
  await db.recordSyncResult(ids.get("f2_gone")!, { ok: true });

  // f2_gone_approved: same, then an admin looked into it and approved.
  await db.recordSyncResult(ids.get("f2_gone_approved")!, { ok: false, state: "not_found", error: "gone" });
  await db.recordSyncResult(ids.get("f2_gone_approved")!, { ok: true });
  await db.approveReset(ids.get("f2_gone_approved")!);

  // Failing (but not "not found") for 8 days vs. 1 hour.
  await db.recordSyncResult(ids.get("f2_failing_long")!, { ok: false, state: "unavailable", error: "boom" });
  await db.client.execute({
    sql: "UPDATE sync_status SET failing_since = ? WHERE user_id = ?",
    args: [new Date(Date.now() - 8 * DAY).toISOString(), ids.get("f2_failing_long")!]
  });
  await db.recordSyncResult(ids.get("f2_failing_recent")!, { ok: false, state: "unavailable", error: "boom" });
  await db.client.execute({
    sql: "UPDATE sync_status SET failing_since = ? WHERE user_id = ?",
    args: [new Date(Date.now() - 3_600_000).toISOString(), ids.get("f2_failing_recent")!]
  });

  // Sign-ups that were ALREADY started (so the verify step is exercised on its
  // own), each with a code the attacker has "put in their LeetCode summary".
  const attackerHash = await hashPassword(ATTACKER_PW);
  for (const name of ["f2_admin", "f2_gone", "f2_failing_long"]) {
    const reg = { id: newId(), code: `leeterboard-${crypto.randomBytes(6).toString("hex")}` };
    attackerRegistrations.set(name, reg);
    await db.createPendingRegistration({
      id: reg.id,
      leetcodeUsername: name,
      displayName: "attacker",
      passwordHash: attackerHash,
      code: reg.code,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    });
    fakeLeetCode.setAbout(name, `hi! ${reg.code}`);
  }

  // These accounts exist on "LeetCode" (with an empty summary) so a sign-up can start.
  for (const name of ["f2_gone_approved", "f2_victim"]) fakeLeetCode.setAbout(name, "");

  server = await startServer({
    TURSO_DATABASE_URL: dbUrl,
    JWT_SECRET: secret,
    ADMIN_LEETCODE_USERNAMES: "f2_admin",
    ADMIN_USER_IDS: "",
    ...fakeLeetCode.env
  });
  api = client(server);
});

after(async () => {
  await server?.stop();
  fakeLeetCode.cleanup();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

const startReset = (username: string) =>
  api("POST", "/api/auth/register", { body: { leetcodeUsername: username, password: ATTACKER_PW } });

describe("recycled username can't take over an admin account", () => {
  it("refuses to start a reset for an admin (403), creating no challenge", async () => {
    const hashBefore = await hashOf("f2_admin");
    const res = await startReset("f2_admin");
    blockedResponses.admin = { status: res.status, json: res.json };
    assert.equal(res.status, 403);
    assert.equal(res.json.error, BLOCKED_MESSAGE);
    assert.equal(res.cookie, null);
    assert.doesNotMatch(res.headers.get("set-cookie") ?? "", /registration=[^;\s]/, "no challenge cookie was issued");
    assert.equal(await hashOf("f2_admin"), hashBefore);
  });

  it("is not fooled by different letter casing", async () => {
    const res = await startReset("F2_ADMIN");
    assert.equal(res.status, 403);
  });

  it("refuses to finish an already-started reset even though ownership IS proven", async () => {
    const { id } = attackerRegistrations.get("f2_admin")!;
    const hashBefore = await hashOf("f2_admin");

    const res = await api("POST", "/api/auth/register/verify", { cookie: `registration=${id}`, body: {} });

    assert.equal(res.status, 403);
    assert.equal(res.cookie, null, "no session was issued");
    assert.equal(await hashOf("f2_admin"), hashBefore, "the admin's password is untouched");
    assert.equal(await pendingCount("f2_admin"), 0, "the blocked challenge is discarded");

    const login = await api("POST", "/api/auth/login", { body: { leetcodeUsername: "f2_admin", password: ATTACKER_PW } });
    assert.equal(login.status, 401, "the attacker's password does not work");
  });

  it("still lets the real admin sign in with their own password", async () => {
    const res = await api("POST", "/api/auth/login", { body: { leetcodeUsername: "f2_admin", password: PW } });
    assert.equal(res.status, 200);
    const session = await api("GET", "/api/auth/session", { cookie: res.cookie });
    assert.equal(session.json.user.isAdmin, true);
  });
});

describe("recycled username can't take over an account whose LeetCode name stopped resolving", () => {
  it("stays frozen after the name 'resolves' again (the sticky marker survives a successful sync)", async () => {
    assert.equal(await db.getResetFreeze(ids.get("f2_gone")!), "name_not_found");
    const res = await startReset("f2_gone");
    blockedResponses.frozen = { status: res.status, json: res.json };
    assert.equal(res.status, 403);
    assert.equal(res.json.error, BLOCKED_MESSAGE);
  });

  it("refuses to finish an already-started reset even though ownership IS proven", async () => {
    const { id } = attackerRegistrations.get("f2_gone")!;
    const hashBefore = await hashOf("f2_gone");

    const res = await api("POST", "/api/auth/register/verify", { cookie: `registration=${id}`, body: {} });

    assert.equal(res.status, 403);
    assert.equal(res.cookie, null);
    assert.equal(await hashOf("f2_gone"), hashBefore);
    assert.equal(await pendingCount("f2_gone"), 0);
    const login = await api("POST", "/api/auth/login", { body: { leetcodeUsername: "f2_gone", password: ATTACKER_PW } });
    assert.equal(login.status, 401);
  });

  it("freezes an account whose syncs have failed for days, but not one that just started failing", async () => {
    assert.equal(await db.getResetFreeze(ids.get("f2_failing_long")!), "sync_failing");
    assert.equal((await startReset("f2_failing_long")).status, 403);

    const { id } = attackerRegistrations.get("f2_failing_long")!;
    const res = await api("POST", "/api/auth/register/verify", { cookie: `registration=${id}`, body: {} });
    assert.equal(res.status, 403);

    assert.equal(await db.getResetFreeze(ids.get("f2_failing_recent")!), null);
    assert.notEqual((await startReset("f2_failing_recent")).status, 403);
  });

  it("an admin's approval lifts the freeze", async () => {
    assert.equal(await db.getResetFreeze(ids.get("f2_gone_approved")!), null);
    const res = await startReset("f2_gone_approved");
    assert.notEqual(res.status, 403);
    assert.equal(res.status, 200);
    assert.equal(res.json.purpose, "reset");
  });

  it("gives the same answer for an admin and a frozen account, so it can't be used to tell them apart", async () => {
    const { admin, frozen } = blockedResponses;
    assert.ok(admin && frozen, "both refusals were recorded above");
    assert.equal(admin.status, frozen.status);
    assert.deepEqual(admin.json, frozen.json);
  });
});

describe("normal members can still reset their own password", () => {
  it("is not blocked for a healthy account", async () => {
    // f2_plain isn't on the fake LeetCode, so we get as far as "doesn't exist"; the point is: not 403.
    const res = await startReset("f2_plain");
    assert.notEqual(res.status, 403);
  });

  it("resets the password, warns loudly, and leaves a notice for the owner", async () => {
    const start = await startReset("f2_victim");
    assert.equal(start.status, 200);
    assert.equal(start.json.purpose, "reset");
    const registrationCookie = start.headers.get("set-cookie")!.match(/registration=[^;]+/)![0];

    fakeLeetCode.setAbout("f2_victim", `my summary ${start.json.code}`);
    const verify = await api("POST", "/api/auth/register/verify", { cookie: registrationCookie, body: {} });
    assert.equal(verify.status, 200);
    assert.ok(verify.cookie, "a session is issued");

    // The old password no longer works, the new one does.
    const oldLogin = await api("POST", "/api/auth/login", { body: { leetcodeUsername: "f2_victim", password: PW } });
    assert.equal(oldLogin.status, 401);
    const newLogin = await api("POST", "/api/auth/login", { body: { leetcodeUsername: "f2_victim", password: ATTACKER_PW } });
    assert.equal(newLogin.status, 200);

    // High-priority log line, without the password or the code.
    const line = server
      .logs()
      .split("\n")
      .find((l) => l.includes('"event":"password_reset_via_ownership"'));
    assert.ok(line, "password_reset_via_ownership was logged");
    assert.equal(JSON.parse(line!).level, "warn");
    assert.equal(JSON.parse(line!).username, "f2_victim");
    assert.equal(line!.includes(ATTACKER_PW), false);
    assert.equal(line!.includes(start.json.code), false);

    // The owner is told, in the app.
    const feed = await api("GET", "/api/notifications", { cookie: newLogin.cookie });
    assert.equal(feed.status, 200);
    assert.match(feed.text, /Your password was reset/);
  });

  it("keeps that system notice out of the admins' 'sent messages' list", async () => {
    const admin = await api("POST", "/api/auth/login", { body: { leetcodeUsername: "f2_admin", password: PW } });
    const sent = await api("GET", "/api/admin/notifications", { cookie: admin.cookie });
    assert.equal(sent.status, 200);
    assert.doesNotMatch(sent.text, /Your password was reset/);
  });
});

describe("blocked attempts are logged for alerting", () => {
  it("logs ownership_blocked with the reason and never the password or code", () => {
    const events = server
      .logs()
      .split("\n")
      .filter((l) => l.includes('"event":"ownership_blocked"'))
      .map((l) => JSON.parse(l));
    const reasons = new Set(events.map((e) => e.reason));
    assert.ok(reasons.has("admin"));
    assert.ok(reasons.has("name_not_found"));
    assert.ok(reasons.has("sync_failing"));
    assert.ok(events.some((e) => e.stage === "register") && events.some((e) => e.stage === "verify"));
    for (const e of events) assert.equal(e.level, "warn");
    assert.equal(server.logs().includes(ATTACKER_PW), false);
  });
});
