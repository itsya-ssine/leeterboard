/**
 * POST /api/auth/login: members sign in with the name in users.login_username,
 * not with a LeetCode name.
 *
 * Runs the real server against a throwaway database. Only failed logins count
 * against the login limiter (20 per 15 minutes per IP), so the failing requests
 * in this file are kept well under that.
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

const login = (body: Record<string, unknown>) => api("POST", "/api/auth/login", { body: { password: PW, ...body } });

/** A member who never linked LeetCode. */
const noLeetCode = (displayName: string) =>
  makeUser(displayName, {
    leetcodeLinked: false,
    leetcodeUsername: "",
    lastUpdated: null,
    trackingStart: "",
    allTimeSolved: 0,
    easySolved: 0,
    mediumSolved: 0,
    hardSolved: 0,
    weeklyProgress: 0,
    monthlyProgress: 0,
    baselineSolved: 0
  });

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-login-"));
  const dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  const db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");

  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");
  const hash = await hashPassword(PW);

  // Members from before this change: their login name is their LeetCode name,
  // lowercased. One of them has a "-", which LeetCode allows and new names don't.
  for (const name of ["Alice_LC", "Carol-X"]) {
    const user = makeUser(name);
    await db.insertUser(user, hash);
    ids.set(name.toLowerCase(), user.id);
  }

  // Signs in as "zed" but has the LeetCode account "zed_lc".
  const zed = makeUser("zed_lc");
  await db.insertUser(zed, hash, { loginUsername: "zed" });
  ids.set("zed", zed.id);

  // Signed up with a username only.
  const dave = noLeetCode("Dave");
  await db.insertUser(dave, hash, { loginUsername: "dave" });
  ids.set("dave", dave.id);

  server = await startServer({ TURSO_DATABASE_URL: dbUrl, JWT_SECRET: secret });
  api = client(server);
});

after(async () => {
  await server?.stop();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("signing in by login name", () => {
  it("accepts the name in any letter case, with surrounding spaces", async () => {
    const res = await login({ username: "  ALICE_lc  " });
    assert.equal(res.status, 200);
    assert.equal(res.json.id, ids.get("alice_lc"));
    assert.ok(res.cookie, "a session cookie was set");
    assert.equal(res.json.isAdmin, false);
    assert.doesNotMatch(res.text, /scrypt|passwordHash|password_hash/i);

    const session = await api("GET", "/api/auth/session", { cookie: res.cookie });
    assert.equal(session.json.user.id, ids.get("alice_lc"));
  });

  it("lets a member whose old LeetCode name has a dash in, because their login name has one too", async () => {
    const res = await login({ username: "Carol-X" });
    assert.equal(res.status, 200);
    assert.equal(res.json.id, ids.get("carol-x"));
  });

  it("lets a member who never linked LeetCode in", async () => {
    const res = await login({ username: "dave" });
    assert.equal(res.status, 200);
    assert.equal(res.json.id, ids.get("dave"));
    assert.equal(res.json.leetcodeLinked, false);
    assert.equal(res.json.leetcodeUsername, "");
  });

  it("lets a member who signed up through the new sign-up back in after signing out", async () => {
    const signUp = await api("POST", "/api/auth/register", { body: { username: "Newbie_1", password: PW } });
    assert.equal(signUp.status, 201);
    await api("POST", "/api/logout", { cookie: signUp.cookie });

    const res = await login({ username: "newbie_1" });
    assert.equal(res.status, 200);
    assert.equal(res.json.id, signUp.json.id);
  });
});

describe("the field name", () => {
  it("still accepts the old leetcodeUsername field, so the current login form keeps working", async () => {
    const res = await login({ leetcodeUsername: "Alice_LC" });
    assert.equal(res.status, 200);
    assert.equal(res.json.id, ids.get("alice_lc"));
  });

  it("prefers username when both are sent", async () => {
    const res = await login({ username: "alice_lc", leetcodeUsername: "carol-x" });
    assert.equal(res.status, 200);
    assert.equal(res.json.id, ids.get("alice_lc"));
  });
});

describe("the login name is the identity, not the LeetCode name", () => {
  it("signs in with the login name", async () => {
    const res = await login({ username: "zed" });
    assert.equal(res.status, 200);
    assert.equal(res.json.id, ids.get("zed"));
    assert.equal(res.json.leetcodeUsername, "zed_lc");
  });

  it("does not sign in with the LeetCode name, which is just an unknown user", async () => {
    const res = await login({ username: "zed_lc" });
    assert.equal(res.status, 401);
    assert.equal(res.json.error, "Invalid username or password.");
    assert.equal(res.cookie, null);
  });

  it("logs failures under the login name, never the LeetCode name", async () => {
    const wrong = await login({ username: "zed", password: "not-the-password-1" });
    assert.equal(wrong.status, 401);
    const line = server
      .logs()
      .split("\n")
      .find((l) => l.includes('"event":"login_failed"') && l.includes(ids.get("zed")!));
    assert.ok(line, "the failure was logged for that member");
    assert.equal(JSON.parse(line!).username, "zed");
    assert.equal(line!.includes("zed_lc"), false);
    assert.equal(line!.includes("not-the-password-1"), false);
  });
});

describe("input that is refused", () => {
  it("asks for both fields", async () => {
    for (const body of [{}, { username: "dave" }, { password: PW }, { username: "   ", password: PW }, { username: 42, password: PW }]) {
      const res = await api("POST", "/api/auth/login", { body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.json.error, "Enter your username and password.");
    }
  });

  it("answers an unknown name and a wrong password in exactly the same way", async () => {
    const unknown = await login({ username: "nobody_here_xyz" });
    const wrong = await login({ username: "dave", password: "not-the-password-1" });
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.deepEqual(unknown.json, wrong.json);
  });

  it("still locks an account after repeated failures, even for the right password", async () => {
    for (let i = 0; i < 5; i++) {
      assert.equal((await login({ username: "carol-x", password: `wrong-password-${i}` })).status, 401);
    }
    const res = await login({ username: "carol-x" });
    assert.equal(res.status, 429);
    assert.equal(res.cookie, null, "no session while locked");
    assert.match(res.json.error, /Try again in \d+ minute/);
  });
});
