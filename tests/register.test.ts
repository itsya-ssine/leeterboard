/**
 * What a new member looks like once they have signed up with Google or GitHub
 * and chosen a username (POST /api/auth/oauth/complete): no LeetCode, no
 * password, the provider-verified e-mail stored and never returned. The routes
 * of the old emailed-code sign-up must be gone.
 *
 * Runs the real server against a throwaway database and the fake provider.
 * Every sign-up comes from its own IP (signUpViaOAuth), because the OAuth routes
 * are limited per IP.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { client, signUpViaOAuth, startServer, type TestServer } from "./helpers.js";
import { makeFakeOAuth, makeUser, mergeEnv, OAUTH_TEST_ENV } from "./f2-seed.js";

const PW = "correct-horse-battery-9";

let tmpDir = "";
let server: TestServer;
let api: ReturnType<typeof client>;
let db: typeof import("../db.js");
const fake = makeFakeOAuth();

const count = async (sql: string, args: (string | number)[] = []) =>
  Number((await db.client.execute({ sql, args })).rows[0].n);

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-register-"));
  const dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");

  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");

  // An existing member who signed up with LeetCode and a password.
  await db.insertUser(makeUser("Bob_99"), await hashPassword(PW));

  server = await startServer(mergeEnv(fake.env, { TURSO_DATABASE_URL: dbUrl, JWT_SECRET: secret, ...OAUTH_TEST_ENV }));
  api = client(server);
});

after(async () => {
  await server?.stop();
  fake.cleanup();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("a successful sign-up", () => {
  let res: Awaited<ReturnType<typeof signUpViaOAuth>>;

  before(async () => {
    res = await signUpViaOAuth(api, fake, { username: "  Alice_99 ", displayName: "Alice A.", email: "Alice.99@Example.COM" });
  });

  it("creates the member, signs them in, and answers 201", () => {
    assert.equal(res.status, 201, res.text);
    assert.ok(res.cookie, "a session cookie was set");
    assert.equal(res.json.displayName, "Alice A.");
    assert.equal(res.json.isAdmin, false);
  });

  it("returns a member with no LeetCode data, and no password material", () => {
    assert.equal(res.json.leetcodeLinked, false);
    assert.equal(res.json.leetcodeUsername, "");
    assert.equal(res.json.lastUpdated, null);
    assert.equal(res.json.allTimeSolved, 0);
    assert.deepEqual(res.json.history, []);
    assert.doesNotMatch(res.text, /scrypt|passwordHash|password_hash/i);
  });

  it("stores the address lowercase and verified, and never returns it", async () => {
    const row = (await db.client.execute({ sql: "SELECT email, email_verified_at FROM users WHERE id = ?", args: [res.json.id] })).rows[0];
    assert.equal(row.email, "alice.99@example.com");
    assert.ok(Date.parse(String(row.email_verified_at)) > Date.now() - 60_000);
    assert.equal(res.text.toLowerCase().includes("alice.99@example.com"), false);
    assert.equal("email" in res.json, false);
  });

  it("stores the lowercase, trimmed username, NULL for LeetCode and no password", async () => {
    const row = (
      await db.client.execute({
        sql: "SELECT login_username, leetcode_username, last_updated, password_hash FROM users WHERE id = ?",
        args: [res.json.id]
      })
    ).rows[0];
    assert.equal(row.login_username, "alice_99");
    assert.equal(row.leetcode_username, null);
    assert.equal(row.last_updated, null);
    assert.equal(row.password_hash, "");
  });

  it("starts with no history and no notifications (those begin when LeetCode is linked)", async () => {
    for (const table of ["history", "notifications", "user_awards"]) {
      assert.equal(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, [res.json.id]), 0, table);
    }
  });

  it("gives a working session", async () => {
    const session = await api("GET", "/api/auth/session", { cookie: res.cookie });
    assert.equal(session.json.user.id, res.json.id);
    assert.equal((await api("GET", "/api/notifications", { cookie: res.cookie })).status, 200);
  });

  it("logs the sign-up without the address", () => {
    const line = server.logs().split("\n").find((l) => l.includes('"event":"account_created"'));
    assert.ok(line, "account_created was logged");
    assert.equal(JSON.parse(line!).username, "alice_99");
    assert.equal(JSON.parse(line!).maskedEmail, "a***@example.com");
    assert.equal(line!.toLowerCase().includes("alice.99@example.com"), false);
  });
});

describe("a name that is already taken", () => {
  it("is refused with 409 in any letter case, and creates nothing", async () => {
    const before = await count("SELECT COUNT(*) AS n FROM users");
    for (const name of ["bob_99", "BOB_99", "Alice_99"]) {
      const res = await signUpViaOAuth(api, fake, { username: name });
      assert.equal(res.status, 409, name);
      assert.equal(res.cookie, null, name);
    }
    assert.equal(await count("SELECT COUNT(*) AS n FROM users"), before);
  });
});

describe("a username that is refused", () => {
  it("rejects a name that is too short, saying why", async () => {
    const res = await signUpViaOAuth(api, fake, { username: "ab" });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /3 to 30/);
    assert.equal(res.cookie, null);
  });

  it("rejects a reserved name and creates nothing", async () => {
    const res = await signUpViaOAuth(api, fake, { username: "admin" });
    assert.equal(res.status, 400);
    assert.equal(await count("SELECT COUNT(*) AS n FROM users WHERE login_username = 'admin'"), 0);
  });
});

describe("two sign-ups for the same name at once", () => {
  it("lets exactly one win and answers the other 409, with no server error", async () => {
    const [a, b] = await Promise.all([
      signUpViaOAuth(api, fake, { username: "racer", email: "racer1@example.com" }),
      signUpViaOAuth(api, fake, { username: "racer", email: "racer2@example.com" })
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    assert.equal(await count("SELECT COUNT(*) AS n FROM users WHERE login_username = 'racer'"), 1);
  });
});

describe("the old sign-ups are gone", () => {
  it("has no password, LeetCode-proof or emailed-code sign-up or reset endpoint any more", async () => {
    for (const url of [
      "/api/auth/register",
      "/api/auth/register/leetcode",
      "/api/auth/register/start",
      "/api/auth/register/verify",
      "/api/auth/reset/email/start",
      "/api/auth/reset/email/verify"
    ]) {
      const res = await api("POST", url, { body: { username: "x_user", password: PW, email: "x@example.com", code: "123456" } });
      assert.equal(res.status, 404, url);
      assert.equal(res.cookie, null, url);
    }
  });

  it("has no account e-mail endpoints any more (the address comes from the provider)", async () => {
    const login = await api("POST", "/api/auth/login", { body: { username: "bob_99", password: PW } });
    for (const url of ["/api/account/email/start", "/api/account/email/verify"]) {
      const res = await api("POST", url, { body: { email: "x@example.com", currentPassword: PW, code: "123456" }, cookie: login.cookie });
      assert.equal(res.status, 404, url);
    }
  });

  it("stores no pending sign-up codes at all", async () => {
    const t = await db.client.execute("SELECT 1 FROM sqlite_master WHERE name = 'pending_email_codes'");
    assert.equal(t.rows.length, 0);
  });
});
