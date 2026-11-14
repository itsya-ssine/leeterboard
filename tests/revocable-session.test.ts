import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { client, startServer, type TestServer } from "./helpers.js";
import { makeUser } from "./f2-seed.js";

const PW = "correct-horse-battery-9";
const NEW_PW = "another-horse-battery-10";

let tmpDir = "";
let dbUrl = "";
let server: TestServer;
let api: ReturnType<typeof client>;
let userId = "";

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-revocablesess-"));
  dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";

  const db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");
  await db.initDb();
  const hash = await hashPassword(PW);

  const user = makeUser("rev_user1");
  await db.insertUser(user, hash);
  userId = user.id;

  server = await startServer({
    TURSO_DATABASE_URL: dbUrl,
    JWT_SECRET: secret
  });
  api = client(server);
});

after(async () => {
  await server?.stop();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Revocable Sessions (SEC-05)", () => {
  it("authenticates and validates session version", async () => {
    const login = await api("POST", "/api/auth/login", {
      body: { username: "rev_user1", password: PW }
    });
    assert.equal(login.status, 200);
    assert.ok(login.cookie);

    const sessionRes = await api("GET", "/api/auth/session", { cookie: login.cookie });
    assert.equal(sessionRes.status, 200);
    assert.equal(sessionRes.json.status, "authenticated");
    assert.equal(sessionRes.json.user.id, userId);
  });

  it("POST /api/auth/logout-all invalidates active sessions across all devices", async () => {
    const login1 = await api("POST", "/api/auth/login", {
      body: { username: "rev_user1", password: PW }
    });
    assert.equal(login1.status, 200);
    const sessionCookie1 = login1.cookie;

    // Login from a "second device"
    const login2 = await api("POST", "/api/auth/login", {
      body: { username: "rev_user1", password: PW }
    });
    assert.equal(login2.status, 200);
    const sessionCookie2 = login2.cookie;

    // Call logout-all using sessionCookie2
    const logoutAll = await api("POST", "/api/auth/logout-all", { cookie: sessionCookie2 });
    assert.equal(logoutAll.status, 200);
    assert.equal(logoutAll.json.success, true);

    // Both previous session cookies are now invalid!
    const testSession1 = await api("GET", "/api/auth/session", { cookie: sessionCookie1 });
    assert.equal(testSession1.status, 200);
    assert.equal(testSession1.json.status, "guest");

    const testSession2 = await api("GET", "/api/auth/session", { cookie: sessionCookie2 });
    assert.equal(testSession2.status, 200);
    assert.equal(testSession2.json.status, "guest");

    // Calling a requireAuth route with the revoked cookie yields 401 session_required
    const testProtected = await api("GET", "/api/users", { cookie: sessionCookie1 });
    assert.equal(testProtected.status, 401);
    assert.equal(testProtected.json.code, "session_required");
  });

  it("logging in after logout-all issues a new working session with bumped session_version", async () => {
    const freshLogin = await api("POST", "/api/auth/login", {
      body: { username: "rev_user1", password: PW }
    });
    assert.equal(freshLogin.status, 200);

    const check = await api("GET", "/api/auth/session", { cookie: freshLogin.cookie });
    assert.equal(check.status, 200);
    assert.equal(check.json.status, "authenticated");
  });

  it("changing password bumps session version and invalidates existing sessions", async () => {
    const currentLogin = await api("POST", "/api/auth/login", {
      body: { username: "rev_user1", password: PW }
    });
    assert.equal(currentLogin.status, 200);
    const oldCookie = currentLogin.cookie;

    const changePw = await api("POST", "/api/account/password", {
      cookie: oldCookie,
      body: { currentPassword: PW, newPassword: NEW_PW }
    });
    assert.equal(changePw.status, 200);
    const newCookie = changePw.cookie;

    // The old cookie is rejected
    const checkOld = await api("GET", "/api/auth/session", { cookie: oldCookie });
    assert.equal(checkOld.json.status, "guest");

    // The new cookie from the password change response works
    const checkNew = await api("GET", "/api/auth/session", { cookie: newCookie });
    assert.equal(checkNew.json.status, "authenticated");
  });
});
