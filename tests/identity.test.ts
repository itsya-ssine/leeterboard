/**
 * Identity is the login name, not the LeetCode handle (auth refactor step 15).
 *
 * Runs the real server against a throwaway database and checks that:
 *  - every member the API returns carries `loginUsername`, including members
 *    who never linked LeetCode and members who signed up before login names
 *    existed (their login name is their LeetCode handle in lowercase);
 *  - a session cookie issued before login names existed still works;
 *  - a member without LeetCode is identified by their login name in the
 *    password rules and in the security log, not by an empty LeetCode handle.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { client, startServer, type TestServer } from "./helpers.js";
import { makeUser } from "./f2-seed.js";

const PW = "correct-horse-battery-9";
const NEW_PW = "another-long-passphrase-4";

let tmpDir = "";
let secret = "";
let legacyHash = "";
let server: TestServer;
let api: ReturnType<typeof client>;
let carolCookie = "";

before(async () => {
  secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-identity-"));
  const dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  const db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");
  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");

  // An existing member who signed up with LeetCode.
  legacyHash = await hashPassword(PW);
  await db.insertUser(makeUser("Bob_99"), legacyHash);

  server = await startServer({ TURSO_DATABASE_URL: dbUrl, JWT_SECRET: secret });
  api = client(server);

  // A new member with no LeetCode account.
  const reg = await api("POST", "/api/auth/register", {
    body: { username: "Carol_Example_1", password: PW, displayName: "Carol" }
  });
  assert.equal(reg.status, 201, reg.text);
  carolCookie = reg.cookie!;
});

after(async () => {
  await server?.stop();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loginUsername in API responses", () => {
  it("sign-up returns the lowercase login name and no LeetCode handle", async () => {
    const session = await api("GET", "/api/auth/session", { cookie: carolCookie });
    assert.equal(session.json.status, "authenticated");
    assert.equal(session.json.user.loginUsername, "carol_example_1");
    assert.equal(session.json.user.leetcodeLinked, false);
    assert.equal(session.json.user.leetcodeUsername, "");
  });

  it("the member list gives every member a login name, linked or not", async () => {
    const res = await api("GET", "/api/users", { cookie: carolCookie });
    assert.equal(res.status, 200);
    const byLogin = new Map<string, any>(res.json.users.map((u: any) => [u.loginUsername, u]));
    assert.equal(byLogin.size, res.json.users.length, "login names are unique");
    for (const u of res.json.users) assert.match(u.loginUsername, /^[a-z0-9_.-]+$/);

    const bob = byLogin.get("bob_99");
    assert.ok(bob, "a legacy member's login name is their LeetCode handle in lowercase");
    assert.equal(bob.leetcodeUsername, "Bob_99");
    assert.equal(bob.leetcodeLinked, true);

    const carol = byLogin.get("carol_example_1");
    assert.ok(carol);
    assert.equal(carol.leetcodeLinked, false);
  });

  it("logging in as a legacy member returns their login name", async () => {
    const res = await api("POST", "/api/auth/login", { body: { username: "Bob_99", password: PW } });
    assert.equal(res.status, 200);
    assert.equal(res.json.loginUsername, "bob_99");
    assert.equal(res.json.leetcodeUsername, "Bob_99");
  });
});

describe("sessions issued before login names existed", () => {
  it("still sign the member in", async () => {
    const ps = crypto.createHmac("sha256", secret).update(legacyHash).digest("hex").slice(0, 16);
    const [{ id }] = (await api("GET", "/api/users", { cookie: carolCookie })).json.users.filter(
      (u: any) => u.loginUsername === "bob_99"
    );
    // The old token shape: LeetCode username only, no loginUsername.
    const token = jwt.sign({ id, leetcodeUsername: "Bob_99", ps }, secret, { algorithm: "HS256", expiresIn: "7d" });

    const res = await api("GET", "/api/auth/session", { cookie: `session=${token}` });
    assert.equal(res.json.status, "authenticated");
    assert.equal(res.json.user.loginUsername, "bob_99");
  });
});

describe("a member without LeetCode is identified by their login name", () => {
  it("can't change their password to their own login name", async () => {
    const res = await api("POST", "/api/account/password", {
      cookie: carolCookie,
      body: { currentPassword: PW, newPassword: "carol_example_1" }
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /same as your username/i);
  });

  it("is logged by login name when they change their password", async () => {
    const res = await api("POST", "/api/account/password", {
      cookie: carolCookie,
      body: { currentPassword: PW, newPassword: NEW_PW }
    });
    assert.equal(res.status, 200, res.text);

    const line = server
      .logs()
      .split("\n")
      .find((l) => l.includes('"event":"password_changed"'));
    assert.ok(line, "a password_changed event was logged");
    const event = JSON.parse(line);
    assert.equal(event.username, "carol_example_1");
  });
});
