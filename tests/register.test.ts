/**
 * POST /api/auth/register: sign up with a username and a password, no LeetCode.
 *
 * Runs the real server against a throwaway database. Sign-up is limited to 10
 * requests an hour per IP and failed attempts count too, so this file spends
 * its requests deliberately: 10 sign-ups, then one more to see the limiter bite.
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
let db: typeof import("../db.js");
let legacyHash = "";

const register = (body: unknown) => api("POST", "/api/auth/register", { body });

const hashOf = async (loginUsername: string) => (await db.getUserAuthByLoginUsername(loginUsername))?.auth.passwordHash;

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

  // An existing member who signed up with LeetCode. Their login name is their
  // LeetCode name in lowercase, the same as the migration gave every old member.
  legacyHash = await hashPassword(PW);
  await db.insertUser(makeUser("Bob_99"), legacyHash);

  server = await startServer({ TURSO_DATABASE_URL: dbUrl, JWT_SECRET: secret });
  api = client(server);
});

after(async () => {
  await server?.stop();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("a successful sign-up", () => {
  let res: Awaited<ReturnType<typeof register>>;

  before(async () => {
    res = await register({ username: "  Alice_99 ", password: PW, displayName: "Alice A." });
  });

  it("creates the member, signs them in, and answers 201", () => {
    assert.equal(res.status, 201);
    assert.ok(res.cookie, "a session cookie was set");
    assert.equal(res.json.displayName, "Alice A.");
    assert.equal(res.json.isAdmin, false);
  });

  it("returns a member with no LeetCode data, and never the password or its hash", () => {
    assert.equal(res.json.leetcodeLinked, false);
    assert.equal(res.json.leetcodeUsername, "");
    assert.equal(res.json.lastUpdated, null);
    assert.equal(res.json.allTimeSolved, 0);
    assert.deepEqual(res.json.history, []);
    assert.doesNotMatch(res.text, /scrypt|passwordHash|password_hash/i);
    assert.equal(res.text.includes(PW), false);
  });

  it("stores the lowercase, trimmed username and NULL for LeetCode", async () => {
    const row = (
      await db.client.execute({
        sql: "SELECT login_username, leetcode_username, last_updated, password_hash FROM users WHERE id = ?",
        args: [res.json.id]
      })
    ).rows[0];
    assert.equal(row.login_username, "alice_99");
    assert.equal(row.leetcode_username, null);
    assert.equal(row.last_updated, null);
    assert.match(String(row.password_hash), /^scrypt/i, "the password is stored hashed");
  });

  it("starts with no history and no notifications (those begin when LeetCode is linked)", async () => {
    const count = async (table: string) =>
      Number((await db.client.execute({ sql: `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, args: [res.json.id] })).rows[0].n);
    assert.equal(await count("history"), 0);
    assert.equal(await count("notifications"), 0);
    assert.equal(await count("user_awards"), 0);
  });

  it("gives a working session", async () => {
    const session = await api("GET", "/api/auth/session", { cookie: res.cookie });
    assert.equal(session.json.user.id, res.json.id);
    assert.equal((await api("GET", "/api/notifications", { cookie: res.cookie })).status, 200);
  });

  it("logs the sign-up without the password", () => {
    const line = server.logs().split("\n").find((l) => l.includes('"event":"account_created"'));
    assert.ok(line, "account_created was logged");
    assert.equal(JSON.parse(line!).username, "alice_99");
    assert.equal(line!.includes(PW), false);
  });
});

describe("a name that is already taken", () => {
  it("is refused with 409 in any letter case, and changes nothing", async () => {
    const before = await hashOf("alice_99");
    const res = await register({ username: "ALICE_99", password: "another-chosen-password-77" });
    assert.equal(res.status, 409);
    assert.equal(res.json.error, "That username is taken.");
    assert.equal(res.cookie, null);
    assert.equal(await hashOf("alice_99"), before);
  });

  it("can't be used to take over an existing LeetCode member", async () => {
    const res = await register({ username: "Bob_99", password: "attacker-chosen-password-99" });
    assert.equal(res.status, 409);
    assert.equal(res.cookie, null);
    assert.equal(await hashOf("bob_99"), legacyHash, "their password is untouched");
  });
});

describe("input that is refused", () => {
  it("rejects a name that is too short, saying why", async () => {
    const res = await register({ username: "ab", password: PW });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, "Username must be 3 to 30 characters.");
    assert.equal(res.cookie, null);
  });

  it("rejects a reserved name", async () => {
    const res = await register({ username: "Admin", password: PW });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, "That username isn't available.");
  });

  it("rejects a short password", async () => {
    const res = await register({ username: "dave_ok", password: "short" });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /at least \d+ characters/);
    assert.equal(await hashOf("dave_ok"), undefined, "no account was created");
  });

  it("rejects a password that is the username", async () => {
    const res = await register({ username: "erin_ok_name", password: "erin_ok_name" });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, "Password can't be the same as your username.");
  });

  it("rejects a body with no fields", async () => {
    const res = await register({});
    assert.equal(res.status, 400);
    assert.equal(res.json.error, "Username is required.");
  });
});

describe("two sign-ups for the same name at once", () => {
  it("lets exactly one win and answers the other 409, with no server error", async () => {
    const [a, b] = await Promise.all([
      register({ username: "racer", password: PW }),
      register({ username: "racer", password: "a-different-password-12" })
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);

    const rows = await db.client.execute("SELECT id, display_name FROM users WHERE login_username = 'racer'");
    assert.equal(rows.rows.length, 1);
    // No display name was sent, so it defaults to the username.
    assert.equal(rows.rows[0].display_name, "racer");
  });
});

describe("sign-up is rate limited", () => {
  it("answers 429 once the hourly allowance is used up", async () => {
    // Ten requests have been spent above; the next one is over the limit.
    const res = await register({ username: "one_too_many", password: PW });
    assert.equal(res.status, 429);
    assert.equal(await hashOf("one_too_many"), undefined);
  });
});
