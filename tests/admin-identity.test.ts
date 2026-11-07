/**
 * F2 regression: admin rights follow the member's internal id, not a LeetCode
 * username that someone else could later register.
 *
 * With ADMIN_USER_IDS set, ADMIN_LEETCODE_USERNAMES is ignored: a member whose
 * username is still listed there is NOT an admin, and the admin account itself
 * can't be reached through the self-service reset.
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
const ids = new Map<string, string>();

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-f2b-"));
  const dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");

  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");
  const hash = await hashPassword(PW);
  // f2_id_admin: admin by id. f2_name_listed: still named in the old username
  // list. f2_member: nobody special.
  for (const name of ["f2_id_admin", "f2_name_listed", "f2_member"]) {
    const user = makeUser(name);
    await db.insertUser(user, hash);
    ids.set(name, user.id);
    await db.recordSyncResult(user.id, { ok: true });
  }

  server = await startServer({
    TURSO_DATABASE_URL: dbUrl,
    JWT_SECRET: secret,
    ADMIN_USER_IDS: ids.get("f2_id_admin")!,
    ADMIN_LEETCODE_USERNAMES: "f2_name_listed"
  });
  api = client(server);
});

after(async () => {
  await server?.stop();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

const login = (username: string) =>
  api("POST", "/api/auth/login", { body: { leetcodeUsername: username, password: PW } });

describe("admin rights follow the member id", () => {
  it("makes the member whose id is listed an admin", async () => {
    const res = await login("f2_id_admin");
    assert.equal(res.status, 200);
    const session = await api("GET", "/api/auth/session", { cookie: res.cookie });
    assert.equal(session.json.user.isAdmin, true);
    assert.equal((await api("GET", "/api/admin/sync-status", { cookie: res.cookie })).status, 200);
  });

  it("ignores ADMIN_LEETCODE_USERNAMES once ADMIN_USER_IDS is set", async () => {
    const res = await login("f2_name_listed");
    assert.equal(res.status, 200);
    const session = await api("GET", "/api/auth/session", { cookie: res.cookie });
    assert.equal(session.json.user.isAdmin, false);
    assert.equal((await api("GET", "/api/admin/sync-status", { cookie: res.cookie })).status, 403);
  });

  it("gives nobody admin rights without a session (401)", async () => {
    assert.equal((await api("GET", "/api/admin/sync-status")).status, 401);
  });
});

describe("the id-admin can't be taken over by signing up with their name", () => {
  it("refuses the admin account's name (409) and leaves its password alone", async () => {
    const hashBefore = (await db.getUserAuthByLoginUsername("f2_id_admin"))!.auth.passwordHash;
    const res = await api("POST", "/api/auth/register", {
      body: { username: "F2_ID_Admin", password: "attacker-chosen-password-99" }
    });
    assert.equal(res.status, 409);
    assert.equal(res.cookie, null);
    assert.equal((await db.getUserAuthByLoginUsername("f2_id_admin"))!.auth.passwordHash, hashBefore);
    assert.equal((await login("f2_id_admin")).status, 200, "the real admin can still sign in");
  });

  it("treats an ordinary member's name the same way, so nothing says which accounts are special", async () => {
    const res = await api("POST", "/api/auth/register", {
      body: { username: "f2_member", password: "another-chosen-password-77" }
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.error, "That username is taken.");
  });
});
