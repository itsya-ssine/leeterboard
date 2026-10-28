/**
 * Security regression tests — run with `npm test`.
 *
 * Each test attacks the real server over HTTP (see helpers.ts) and then checks
 * the DATABASE as well as the response: an endpoint that returns an error but
 * still commits a partial write would pass a status-code-only test.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { client, startServer, type TestServer } from "./helpers.js";

const PW = "correct-horse-battery-9";
const SEEDED_MEMBERS = ["sec_claim_target", "sec_claim_target2", "sec_csrf_user", "sec_delete_user", "sec_enum_user", "sec_feedback_user", "sec_idor_alice", "sec_idor_bob", "sec_leak_user", "sec_link_user", "sec_lock_user", "sec_log_removed", "sec_log_user", "sec_member_a", "sec_notif_a", "sec_notif_b", "sec_pwchange_user", "sec_score_user", "sec_session_user", "sec_tamper_user", "sec_victim_a", "test_admin"];
const REPLAY_REGISTRATION_ID = crypto.randomBytes(32).toString("hex");
let tmpDir = "";
let server: TestServer;
let api: ReturnType<typeof client>;
// Loaded after the environment is set, because db.ts reads it at import time.
let db: typeof import("../db.js");

function makeUser(username: string, over: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    displayName: username,
    leetcodeUsername: username,
    avatarUrl: "",
    school: "",
    bio: "",
    githubUrl: "",
    linkedinUrl: "",
    websiteUrl: "",
    allTimeSolved: 100,
    easySolved: 50,
    mediumSolved: 40,
    hardSolved: 10,
    weeklyProgress: 5,
    monthlyProgress: 20,
    rank: 0,
    contestRating: null,
    contestsAttended: 0,
    currentStreak: null,
    longestStreak: null,
    lastUpdated: new Date().toISOString(),
    trackingStart: "2026-01-05",
    baselineSolved: 90,
    history: [],
    ...over
  } as any;
}

// Every member the tests need is created BEFORE the server starts. Two
// processes writing one SQLite file at the same time can hit "database is
// locked", which would make the suite flaky for reasons that have nothing to
// do with security; so the test process only seeds up front and then reads.
const members = new Map<string, { id: string; leetcodeUsername: string }>();

async function createMember(username: string) {
  const user = members.get(username);
  if (!user) throw new Error(`test member "${username}" was not seeded (add it to SEEDED_MEMBERS)`);
  return user;
}

async function login(username: string, password = PW) {
  const res = await api("POST", "/api/auth/login", { body: { leetcodeUsername: username, password } });
  return res;
}

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-seed-"));
  const dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  // Same environment as the server, so db.ts / auth.ts point at its database.
  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  process.env.ADMIN_LEETCODE_USERNAMES = "test_admin";
  db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");

  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL"); // readers never block the server's writes
  const hash = await hashPassword(PW);
  for (const name of SEEDED_MEMBERS) {
    const user = makeUser(name);
    await db.insertUser(user, hash);
    members.set(name, { id: user.id, leetcodeUsername: name });
  }
  await db.createPendingRegistration({
    id: REPLAY_REGISTRATION_ID,
    leetcodeUsername: "sec_replay_user",
    displayName: "x",
    passwordHash: "scrypt$irrelevant",
    code: "leeterboard-000000000000",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString()
  });
  await db.createPendingLink({
    userId: members.get("sec_link_user")!.id,
    platform: "codeforces",
    handle: "tourist",
    code: "leeterboard-111111111111",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString()
  });

  server = await startServer({ TURSO_DATABASE_URL: dbUrl, JWT_SECRET: secret });
  api = client(server);
});

after(async () => {
  await server?.stop();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("authentication", () => {
  it("rejects protected endpoints without a session (401)", async () => {
    for (const [method, route] of [
      ["GET", "/api/notifications"],
      ["PATCH", "/api/account/profile"],
      ["POST", "/api/account/password"],
      ["POST", "/api/account/delete"],
      ["POST", "/api/account/platforms/codeforces/start"]
    ] as const) {
      const res = await api(method, route, method === "GET" ? {} : { body: {} });
      assert.equal(res.status, 401, `${method} ${route}`);
    }
  });

  it("rejects tampered, foreign-signed and alg=none session tokens (401)", async () => {
    const alice = await createMember("sec_tamper_user");
    const payload = { id: alice.id, leetcodeUsername: alice.leetcodeUsername };

    const wrongSecret = jwt.sign(payload, "x".repeat(48) + "different", { algorithm: "HS256" });
    const algNone =
      Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url") +
      "." +
      Buffer.from(JSON.stringify(payload)).toString("base64url") +
      ".";
    const valid = jwt.sign({ ...payload }, server.secret, { algorithm: "HS256" });
    const tampered = valid.slice(0, -2) + (valid.endsWith("AA") ? "BB" : "AA");

    for (const [label, token] of [
      ["garbage", "not-a-jwt"],
      ["wrong secret", wrongSecret],
      ["alg none", algNone],
      ["tampered signature", tampered]
    ]) {
      const res = await api("GET", "/api/notifications", { cookie: `session=${token}` });
      assert.equal(res.status, 401, label);
    }
  });

  it("locks the account after repeated failures, even for the right password", async () => {
    await createMember("sec_lock_user");
    for (let i = 0; i < 5; i++) {
      assert.equal((await login("sec_lock_user", "wrong-password-" + i)).status, 401);
    }
    const res = await login("sec_lock_user");
    assert.equal(res.status, 429);
    assert.equal(res.cookie, null, "no session may be issued while locked");
  });

  it("returns the same error for unknown users and wrong passwords", async () => {
    await createMember("sec_enum_user");
    const unknown = await login("sec_no_such_user_xyz", "whatever-password-1");
    const wrong = await login("sec_enum_user", "whatever-password-1");
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.deepEqual(unknown.json, wrong.json);
  });

  it("invalidates old sessions when the password changes", async () => {
    await createMember("sec_session_user");
    const first = await login("sec_session_user");
    assert.equal(first.status, 200);
    const oldCookie = first.cookie!;

    const change = await api("POST", "/api/account/password", {
      cookie: oldCookie,
      body: { currentPassword: PW, newPassword: "a-brand-new-passphrase-7" }
    });
    assert.equal(change.status, 200);

    const stale = await api("GET", "/api/auth/session", { cookie: oldCookie });
    assert.equal(stale.json.status, "guest", "the pre-change cookie must no longer authenticate");
    const fresh = await api("GET", "/api/auth/session", { cookie: change.cookie });
    assert.equal(fresh.json.status, "authenticated");
  });
});

describe("authorization", () => {
  it("returns 403 for every admin endpoint when called by a regular member, and changes nothing", async () => {
    const member = await createMember("sec_member_a");
    const victim = await createMember("sec_victim_a");
    const cookie = (await login("sec_member_a")).cookie!;

    const attempts: [string, string, unknown?][] = [
      ["GET", "/api/admin/sync-status"],
      ["GET", "/api/admin/notifications"],
      ["POST", "/api/admin/notifications", { to: "all", title: "pwned" }],
      ["GET", "/api/admin/feedback"],
      ["PATCH", "/api/admin/feedback/anything", { read: true }],
      ["DELETE", "/api/admin/feedback/anything"],
      ["POST", "/api/refresh-all", {}],
      ["POST", `/api/users/${victim.id}/refresh`, {}],
      ["DELETE", `/api/users/${victim.id}`]
    ];
    for (const [method, route, body] of attempts) {
      const res = await api(method, route, { cookie, body });
      assert.equal(res.status, 403, `${method} ${route}`);
    }
    assert.ok(await db.getUserById(victim.id), "victim must still exist");
    assert.ok(await db.getUserById(member.id));
  });

  it("returns 401 for admin endpoints without a session", async () => {
    const res = await api("DELETE", "/api/users/anything");
    assert.equal(res.status, 401);
  });

  it("lets a member edit only their own profile, whatever ids the request carries", async () => {
    const alice = await createMember("sec_idor_alice");
    const bob = await createMember("sec_idor_bob");
    const cookie = (await login("sec_idor_alice")).cookie!;

    const res = await api("PATCH", "/api/account/profile", {
      cookie,
      body: { id: bob.id, userId: bob.id, user_id: bob.id, displayName: "Alice Renamed", bio: "hi" }
    });
    assert.equal(res.status, 200);

    assert.equal((await db.getUserById(alice.id))!.displayName, "Alice Renamed");
    const bobAfter = (await db.getUserById(bob.id))!;
    assert.equal(bobAfter.displayName, "sec_idor_bob");
    assert.equal(bobAfter.bio, "");
  });

  it("ignores fabricated scores, ranks and admin flags in write requests", async () => {
    const mallory = await createMember("sec_score_user");
    const cookie = (await login("sec_score_user")).cookie!;
    const before = (await db.getUserById(mallory.id))!;

    const res = await api("PATCH", "/api/account/profile", {
      cookie,
      body: {
        bio: "legit change",
        allTimeSolved: 999999,
        weeklyProgress: 999999,
        monthlyProgress: 999999,
        hardSolved: 999999,
        rank: 1,
        contestRating: 3500,
        isAdmin: true,
        isPinned: true
      }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.isAdmin, false);

    const after = (await db.getUserById(mallory.id))!;
    for (const field of ["allTimeSolved", "weeklyProgress", "monthlyProgress", "hardSolved", "contestRating"] as const) {
      assert.equal(after[field], before[field], field);
    }
    assert.equal(after.bio, "legit change");

    // There is no endpoint at all for submitting scores.
    for (const route of ["/api/users", "/api/scores", "/api/leaderboard"]) {
      const r = await api("POST", route, { cookie, body: { leetcodeUsername: "sec_score_user", allTimeSolved: 1e6 } });
      assert.ok(r.status === 404 || r.status === 401 || r.status === 403, `${route} -> ${r.status}`);
    }
    assert.equal((await db.getUserById(mallory.id))!.allTimeSolved, before.allTimeSolved);
  });

  it("only shows a member their own notifications", async () => {
    const a = await createMember("sec_notif_a");
    const b = await createMember("sec_notif_b");
    const adminCookie = await adminSession();
    await api("POST", "/api/admin/notifications", { cookie: adminCookie, body: { to: b.id, title: "for b only" } });

    const cookieA = (await login("sec_notif_a")).cookie!;
    const listA = await api("GET", "/api/notifications", { cookie: cookieA });
    assert.ok(!listA.text.includes("for b only"));
    const cookieB = (await login("sec_notif_b")).cookie!;
    const listB = await api("GET", "/api/notifications", { cookie: cookieB });
    assert.ok(listB.text.includes("for b only"));
    assert.ok(a && b);
  });
});

async function adminSession(): Promise<string> {
  const res = await login("test_admin");
  assert.equal(res.status, 200);
  assert.equal(res.json.isAdmin, true);
  return res.cookie!;
}

describe("account claiming and challenge replay", () => {
  it("refuses to complete a sign-up without a challenge cookie", async () => {
    const target = await createMember("sec_claim_target");
    const hashBefore = (await db.getUserAuthByUsername(target.leetcodeUsername))!.auth.passwordHash;

    const res = await api("POST", "/api/auth/register/verify", { body: {} });
    assert.equal(res.status, 400);
    assert.equal(res.cookie, null);
    assert.equal((await db.getUserAuthByUsername(target.leetcodeUsername))!.auth.passwordHash, hashBefore);
  });

  it("refuses a forged or unknown challenge id and leaves the account untouched", async () => {
    const target = await createMember("sec_claim_target2");
    const hashBefore = (await db.getUserAuthByUsername(target.leetcodeUsername))!.auth.passwordHash;

    for (const id of [crypto.randomBytes(32).toString("hex"), "A".repeat(64), "short", "../../etc/passwd"]) {
      const res = await api("POST", "/api/auth/register/verify", { cookie: `registration=${id}`, body: {} });
      assert.equal(res.status, 400, id);
      assert.equal(res.cookie, null);
    }
    assert.equal((await db.getUserAuthByUsername(target.leetcodeUsername))!.auth.passwordHash, hashBefore);
  });

  it("lets exactly one of many concurrent requests consume a sign-up challenge", async () => {
    const id = REPLAY_REGISTRATION_ID;
    const results = await Promise.all(Array.from({ length: 12 }, () => db.consumePendingRegistration(id)));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await db.consumePendingRegistration(id), false, "a later replay must fail");
  });

  it("lets exactly one of many concurrent requests consume a platform-link challenge", async () => {
    const member = await createMember("sec_link_user");
    const results = await Promise.all(Array.from({ length: 12 }, () => db.consumePendingLink(member.id, "codeforces")));
    assert.equal(results.filter(Boolean).length, 1);
  });
});

describe("account deletion and password change need the current password", () => {
  it("rejects deletion with no password or a wrong one, and keeps the account", async () => {
    const member = await createMember("sec_delete_user");
    const cookie = (await login("sec_delete_user")).cookie!;

    assert.equal((await api("POST", "/api/account/delete", { cookie, body: {} })).status, 400);
    assert.equal((await api("POST", "/api/account/delete", { cookie, body: { password: "nope-nope-nope" } })).status, 401);
    assert.ok(await db.getUserById(member.id), "account must survive failed deletion attempts");

    const ok = await api("POST", "/api/account/delete", { cookie, body: { password: PW } });
    assert.equal(ok.status, 200);
    assert.equal(await db.getUserById(member.id), null);
  });

  it("rejects a password change with the wrong current password and keeps the old hash", async () => {
    const member = await createMember("sec_pwchange_user");
    const cookie = (await login("sec_pwchange_user")).cookie!;
    const before = (await db.getUserAuthByUsername(member.leetcodeUsername))!.auth.passwordHash;

    const res = await api("POST", "/api/account/password", {
      cookie,
      body: { currentPassword: "wrong-current-password", newPassword: "another-new-passphrase-3" }
    });
    assert.equal(res.status, 401);
    assert.equal((await db.getUserAuthByUsername(member.leetcodeUsername))!.auth.passwordHash, before);
  });

  it("will not let an admin delete an admin account through the admin route", async () => {
    const adminCookie = await adminSession();
    const admin = (await db.getUserAuthByUsername("test_admin"))!.user;
    const res = await api("DELETE", `/api/users/${admin.id}`, { cookie: adminCookie });
    assert.equal(res.status, 403);
    assert.ok(await db.getUserById(admin.id));
  });
});

describe("request validation", () => {
  it("rejects oversized bodies (413) and malformed JSON (400)", async () => {
    const big = await api("POST", "/api/auth/login", {
      rawBody: JSON.stringify({ leetcodeUsername: "x", password: "y".repeat(20_000) })
    });
    assert.equal(big.status, 413);

    const bad = await api("POST", "/api/auth/login", { rawBody: "{not json" });
    assert.ok(bad.status === 400, `malformed JSON -> ${bad.status}`);
  });

  it("rejects wrong field types without crashing", async () => {
    for (const body of [
      { leetcodeUsername: { $ne: "" }, password: PW },
      { leetcodeUsername: ["a"], password: ["b"] },
      { leetcodeUsername: 123, password: 456 },
      null
    ]) {
      const res = await api("POST", "/api/auth/login", { body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  it("rejects cross-origin and non-JSON state-changing requests", async () => {
    const member = await createMember("sec_csrf_user");
    const cookie = (await login("sec_csrf_user")).cookie!;

    const evil = await api("PATCH", "/api/account/profile", {
      cookie,
      headers: { origin: "https://evil.example" },
      body: { bio: "csrf" }
    });
    assert.equal(evil.status, 403);

    const crossSite = await api("PATCH", "/api/account/profile", {
      cookie,
      headers: { "sec-fetch-site": "cross-site" },
      body: { bio: "csrf" }
    });
    assert.equal(crossSite.status, 403);

    const form = await api("POST", "/api/account/delete", {
      cookie,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      rawBody: `password=${PW}`
    });
    assert.equal(form.status, 415);

    const nullOrigin = await api("POST", "/api/logout", { headers: { origin: "null" }, body: {} });
    assert.equal(nullOrigin.status, 403);

    assert.equal((await db.getUserById(member.id))!.bio, "", "nothing may have been written");
    assert.ok(await db.getUserById(member.id), "account must still exist");
  });
});

describe("feedback", () => {
  // The feedback form is public, so every request here shares one rate-limit
  // counter (10 per hour per IP). Tests that POST are kept together and few,
  // and the one that exhausts the limit runs last.
  const rows = async () =>
    (await db.client.execute("SELECT id, user_id, category, message, page, read_at FROM feedback ORDER BY created_at")).rows;

  it("stores feedback from visitors and members, and only attributes it to a verified session", async () => {
    const member = await createMember("sec_feedback_user");
    const other = await createMember("sec_member_a");
    const cookie = (await login("sec_feedback_user")).cookie!;

    const anon = await api("POST", "/api/feedback", {
      body: { category: "idea", message: "Please add a weekly email digest", page: "#/stats" }
    });
    assert.equal(anon.status, 201);

    // A forged userId in the body must not let someone send feedback as another member.
    const signedIn = await api("POST", "/api/feedback", {
      cookie,
      body: { category: "bug", message: "The share card is cut off on mobile", userId: other.id, user_id: other.id }
    });
    assert.equal(signedIn.status, 201);

    // Control characters are stripped (log / display injection); line breaks are kept.
    const messy = await api("POST", "/api/feedback", { body: { message: "Line one\nLine two\u0000\u0007 end" } });
    assert.equal(messy.status, 201);

    const all = await rows();
    assert.ok(all.some((r) => r.message === "Line one\nLine two   end"), "control characters must be replaced, newline kept");
    const anonRow = all.find((r) => r.message === "Please add a weekly email digest");
    const memberRow = all.find((r) => r.message === "The share card is cut off on mobile");
    assert.ok(anonRow && memberRow);
    assert.equal(anonRow.user_id, null);
    assert.equal(anonRow.category, "idea");
    assert.equal(anonRow.page, "#/stats");
    assert.equal(memberRow.user_id, member.id);
    assert.equal(memberRow.category, "bug");
    assert.equal(memberRow.read_at, null);
  });

  it("rejects bad input with 400 and stores nothing", async () => {
    const before = (await rows()).length;
    for (const body of [
      { message: 12345 },
      { message: "hi" },
      { message: "   \n  " },
      { message: "x".repeat(1001) },
      { message: "A real message", category: "spam" },
      { message: "A real message", category: ["bug"] }
    ]) {
      const res = await api("POST", "/api/feedback", { body });
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
    }
    assert.equal((await rows()).length, before);
  });

  it("refuses the admin inbox to members and to visitors", async () => {
    const cookie = (await login("sec_feedback_user")).cookie!;
    for (const [method, route, body] of [
      ["GET", "/api/admin/feedback", undefined],
      ["PATCH", "/api/admin/feedback/x", { read: true }],
      ["DELETE", "/api/admin/feedback/x", undefined]
    ] as const) {
      assert.equal((await api(method, route, { cookie, body })).status, 403, `${method} ${route}`);
      assert.equal((await api(method, route, { body })).status, 401, `${method} ${route} (no session)`);
    }
  });

  it("lets an admin read, mark and delete feedback", async () => {
    const admin = (await login("test_admin")).cookie!;
    const list = await api("GET", "/api/admin/feedback", { cookie: admin });
    assert.equal(list.status, 200);
    assert.ok(list.json.items.length >= 2);
    assert.equal(list.json.unread, list.json.items.filter((i: any) => !i.read).length);

    const item = list.json.items.find((i: any) => i.message === "The share card is cut off on mobile");
    assert.ok(item);
    assert.equal(item.authorUsername, "sec_feedback_user");
    assert.equal(item.read, false);
    // Responses carry names for the admins, but never ids or secrets of the author.
    assert.ok(!("userId" in item) && !("user_id" in item));

    assert.equal((await api("PATCH", `/api/admin/feedback/${item.id}`, { cookie: admin, body: { read: true } })).status, 200);
    assert.notEqual((await rows()).find((r) => r.id === item.id)!.read_at, null);
    assert.equal((await api("PATCH", `/api/admin/feedback/${item.id}`, { cookie: admin, body: { read: false } })).status, 200);
    assert.equal((await rows()).find((r) => r.id === item.id)!.read_at, null);

    assert.equal((await api("PATCH", `/api/admin/feedback/${item.id}`, { cookie: admin, body: { read: "yes" } })).status, 400);
    assert.equal((await api("PATCH", "/api/admin/feedback/does-not-exist", { cookie: admin, body: { read: true } })).status, 404);

    assert.equal((await api("DELETE", `/api/admin/feedback/${item.id}`, { cookie: admin })).status, 200);
    assert.ok(!(await rows()).some((r) => r.id === item.id), "deleted feedback must be gone");
    assert.equal((await api("DELETE", `/api/admin/feedback/${item.id}`, { cookie: admin })).status, 404);
  });

  it("keeps the message but drops the author when a member deletes their account", async () => {
    const user = await createMember("sec_feedback_user");
    await db.createFeedback({ userId: user.id, category: "other", message: "Written before leaving", page: "" });
    assert.ok(await db.deleteUserById(user.id));
    const row = (await rows()).find((r) => r.message === "Written before leaving");
    assert.ok(row, "the feedback itself must survive");
    assert.equal(row.user_id, null, "but it must no longer point at the deleted member");
  });

  it("blocks cross-site feedback requests, even admin actions that carry a valid admin cookie", async () => {
    // Write the fixture first: the server may still be finishing a write from a
    // previous request, and two processes writing to one SQLite file at once
    // gives SQLITE_BUSY.
    const id = await db.createFeedback({ userId: null, category: "other", message: "CSRF target", page: "" });
    const admin = (await login("test_admin")).cookie!;
    const before = (await rows()).length;
    const evil = { origin: "https://evil.example" };

    // A malicious page posting from another site (these are stopped by csrf.ts
    // before the feedback rate limiter, so they don't use up its quota).
    assert.equal((await api("POST", "/api/feedback", { headers: evil, body: { message: "from another site" } })).status, 403);
    assert.equal((await api("POST", "/api/feedback", { headers: { "sec-fetch-site": "cross-site" }, body: { message: "from another site" } })).status, 403);
    assert.equal((await rows()).length, before, "no feedback may be stored");

    // ...and riding the admin's cookie to change or delete the inbox.
    assert.equal((await api("PATCH", `/api/admin/feedback/${id}`, { cookie: admin, headers: evil, body: { read: true } })).status, 403);
    assert.equal((await rows()).find((r) => r.id === id)!.read_at, null, "must still be unread");
    assert.equal((await api("DELETE", `/api/admin/feedback/${id}`, { cookie: admin, headers: evil })).status, 403);
    assert.ok((await rows()).some((r) => r.id === id), "must not be deleted");
  });

  it("rate limits the public form (429) and logs it", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await api("POST", "/api/feedback", { body: { message: `Rate limit probe ${i}` } })).status);
    }
    assert.ok(statuses.includes(429), `expected a 429 in ${statuses.join(",")}`);
    assert.ok(statuses.every((s) => s === 201 || s === 429), statuses.join(","));
    assert.match(server.logs(), /"limiter":"feedback"/);
  });
});

describe("responses and headers", () => {
  it("sends the production security headers, and no-store on API responses", async () => {
    const res = await api("GET", "/api/users");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.match(res.headers.get("strict-transport-security") ?? "", /max-age=\d{7,}/);
    const csp = res.headers.get("content-security-policy") ?? "";
    const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) ?? "";
    assert.ok(scriptSrc.includes("'self'"));
    assert.ok(!scriptSrc.includes("unsafe-inline") && !scriptSrc.includes("unsafe-eval"), scriptSrc);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
  });

  it("never exposes password hashes, lockout state or secrets in public responses", async () => {
    await createMember("sec_leak_user");
    const res = await api("GET", "/api/users");
    assert.equal(res.status, 200);
    assert.ok(res.text.includes("sec_leak_user"));
    for (const needle of ["scrypt$", "passwordHash", "password_hash", "failedLogins", "lockedUntil", server.secret]) {
      assert.ok(!res.text.includes(needle), `public response leaks "${needle}"`);
    }
  });

  it("does not echo internal error details on a failed login", async () => {
    const res = await login("sec_leak_user", "x".repeat(500));
    assert.equal(res.status, 401);
    assert.ok(!/at\s+\S+\s+\(|node_modules|SQLITE|\.ts:\d+/.test(res.text));
  });
});

describe("security logging", () => {
  it("records failed logins and lockouts as structured events without leaking secrets", async () => {
    await createMember("sec_log_user");
    const secretGuess = "SuperSecretGuess!!4242";
    for (let i = 0; i < 5; i++) await login("sec_log_user", secretGuess);

    const logs = server.logs();
    assert.ok(logs.includes('"event":"login_failed"'));
    assert.ok(logs.includes('"event":"account_locked"'));
    assert.ok(!logs.includes(secretGuess), "a submitted password must never be logged");
    assert.ok(!logs.includes(PW), "a real password must never be logged");
    assert.ok(!/scrypt\$\d+/.test(logs), "password hashes must never be logged");
    for (const line of logs.split("\n").filter((l) => l.includes('"type":"security"'))) {
      assert.doesNotThrow(() => JSON.parse(line), "security events must be one JSON object per line");
    }
  });

  it("logs admin actions and blocked cross-site requests", async () => {
    const adminCookie = await adminSession();
    const target = await createMember("sec_log_removed");
    const removed = await api("DELETE", `/api/users/${target.id}`, { cookie: adminCookie });
    assert.equal(removed.status, 200);
    await api("POST", "/api/logout", { headers: { origin: "https://evil.example" }, body: {} });

    const logs = server.logs();
    assert.ok(logs.includes('"event":"admin_user_removed"'));
    assert.ok(logs.includes('"event":"csrf_blocked"'));
  });

  it("redacts sensitive field names and strips control characters", async () => {
    const { redact } = await import("../securityLog.js");
    const out = redact({ password: "p", verificationCode: "c", cookie: "c", token: "t", username: "a\nb", ip: "1.2.3.4" });
    assert.equal(out.password, "[redacted]");
    assert.equal(out.verificationCode, "[redacted]");
    assert.equal(out.cookie, "[redacted]");
    assert.equal(out.token, "[redacted]");
    assert.equal(out.username, "a b");
    assert.equal(out.ip, "1.2.3.4");
  });
});

describe("rate limiting", () => {
  it("returns 429 after 20 failed logins from one client, and logs it", async () => {
    // Own server + database so the other tests' failed logins don't count.
    const isolated = await startServer();
    try {
      const call = client(isolated);
      let last = 0;
      for (let i = 1; i <= 21; i++) {
        const res = await call("POST", "/api/auth/login", {
          body: { leetcodeUsername: `ghost_${i}`, password: "wrong-password-1" }
        });
        last = res.status;
        if (i <= 20) assert.equal(res.status, 401, `attempt ${i}`);
      }
      assert.equal(last, 429);
      assert.ok(isolated.logs().includes('"event":"rate_limited"'));
    } finally {
      await isolated.stop();
    }
  });

  it("shares the counter between instances that use the same database", async () => {
    const a = await startServer();
    try {
      // A second process on the SAME database file (started after the first
      // one has created the schema).
      const b = await startServer({ TURSO_DATABASE_URL: a.dbUrl });
      try {
        const callA = client(a);
        const callB = client(b);
        let blockedAt = 0;
        for (let i = 1; i <= 24; i++) {
          const res = await (i % 2 ? callA : callB)("POST", "/api/auth/login", {
            body: { leetcodeUsername: `ghost_${i}`, password: "wrong-password-1" }
          });
          if (res.status === 429 && !blockedAt) blockedAt = i;
        }
        assert.equal(blockedAt, 21, "the 21st attempt must be blocked no matter which instance receives it");
      } finally {
        await b.stop();
      }
    } finally {
      await a.stop();
    }
  });
});
