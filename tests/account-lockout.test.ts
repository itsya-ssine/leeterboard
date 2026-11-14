import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { client, startServer, type TestServer } from "./helpers.js";
import { makeUser } from "./f2-seed.js";

const PW = "correct-horse-battery-9";
const WRONG_PW = "wrong-password-attempt-99";

let tmpDir = "";
let dbUrl = "";
let server: TestServer;
let api: ReturnType<typeof client>;
let db: typeof import("../db.js");
let userId = "";

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-lockout-"));
  dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  process.env.NODE_ENV = "test";

  const auth = await import("../auth.js");
  db = await import("../db.js");
  await db.initDb();

  const hash = await auth.hashPassword(PW);
  const u = makeUser("lockout_victim");
  await db.insertUser(u, hash);
  userId = u.id;

  server = await startServer({
    TURSO_DATABASE_URL: dbUrl,
    JWT_SECRET: secret,
    NODE_ENV: "test"
  });
  api = client(server);
});

after(async () => {
  await server?.stop();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Account Lockout & Targeted-DoS Protection (SEC-08)", () => {
  let knownDeviceCookie = "";

  it("sets a known-good device cookie on successful login", async () => {
    const res = await api("POST", "/api/auth/login", {
      body: { username: "lockout_victim", password: PW }
    });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get("set-cookie") || "";
    const match = setCookie.match(/known_device=([^;]+)/);
    assert.ok(match, "known_device cookie should be issued on successful login");
    knownDeviceCookie = `known_device=${match[1]}`;
  });

  it("locks out an untrusted device after 5 consecutive failed attempts and leaves an alert", async () => {
    // 5 failures from an untrusted client (no known_device cookie)
    for (let i = 0; i < 5; i++) {
      const res = await api("POST", "/api/auth/login", {
        body: { username: "lockout_victim", password: WRONG_PW }
      });
      assert.equal(res.status, 401);
    }

    // 6th attempt is blocked with 429
    const blockedRes = await api("POST", "/api/auth/login", {
      body: { username: "lockout_victim", password: PW }
    });
    assert.equal(blockedRes.status, 429);
    assert.match(blockedRes.json.error, /Too many failed attempts/);

    // Verify security notification created
    const feed = await db.listNotifications(userId);
    const alert = feed.notifications.find((n) => n.title.includes("failed sign-in"));
    assert.ok(alert, "Account owner should receive a security alert notice");
  });

  it("allows a known-good device to sign in even when account is locked by untrusted attempts", async () => {
    // Untrusted device still gets 429
    const blocked = await api("POST", "/api/auth/login", {
      body: { username: "lockout_victim", password: PW }
    });
    assert.equal(blocked.status, 429);

    // Known device with knownDeviceCookie can sign in!
    const okRes = await api("POST", "/api/auth/login", {
      body: { username: "lockout_victim", password: PW },
      cookie: knownDeviceCookie
    });
    assert.equal(okRes.status, 200);
    assert.equal(okRes.json.id, userId);

    // Lockout should now be cleared
    const authState = await db.getUserAuthById(userId);
    assert.equal(authState?.auth.failedLogins, 0);
  });
});
