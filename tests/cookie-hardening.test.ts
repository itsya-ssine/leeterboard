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
let dbUrl = "";
let secret = "";
let server: TestServer;
let api: ReturnType<typeof client>;
let db: typeof import("../db.js");
let auth: typeof import("../auth.js");
let userId = "";
const savedNodeEnv = process.env.NODE_ENV;

before(async () => {
  secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-cookie-"));
  dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  process.env.NODE_ENV = "production";

  auth = await import("../auth.js");
  db = await import("../db.js");
  await db.initDb();

  const hash = await auth.hashPassword(PW);
  const u = makeUser("cookie_user");
  await db.insertUser(u, hash);
  userId = u.id;

  server = await startServer({
    TURSO_DATABASE_URL: dbUrl,
    JWT_SECRET: secret,
    NODE_ENV: "production"
  });
  api = client(server);
});

after(async () => {
  if (savedNodeEnv !== undefined) process.env.NODE_ENV = savedNodeEnv;
  else delete process.env.NODE_ENV;
  await server?.stop();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Cookie Hardening (SEC-10)", () => {
  it("determines cookie prefixes based on production / secure environment", () => {
    assert.equal(auth.IS_SECURE_ENV, true);
    assert.equal(auth.SESSION_COOKIE_NAME, "__Host-session");
  });

  it("sets __Host-session cookie with Secure, HttpOnly, SameSite=Lax and Path=/ in production", async () => {
    const res = await api("POST", "/api/auth/login", {
      body: { username: "cookie_user", password: PW }
    });
    assert.equal(res.status, 200);

    const setCookies = res.headers.get("set-cookie") || "";
    // Check for __Host-session cookie
    assert.match(setCookies, /__Host-session=/);
    assert.match(setCookies, /Secure/i);
    assert.match(setCookies, /HttpOnly/i);
    assert.match(setCookies, /SameSite=Lax/i);
    assert.match(setCookies, /Path=\//i);
  });

  it("reads legacy unprefixed session cookie during transition", async () => {
    const userAuth = await db.getUserAuthById(userId);
    assert.ok(userAuth);

    const sessionStamp = (pwHash: string) =>
      crypto.createHmac("sha256", secret).update(pwHash).digest("hex").slice(0, 16);
    const legacyPayload = {
      id: userId,
      loginUsername: "cookie_user",
      ps: sessionStamp(userAuth.auth.passwordHash),
      sv: userAuth.auth.sessionVersion
    };
    const legacyToken = (await import("jsonwebtoken")).default.sign(
      legacyPayload,
      process.env.JWT_SECRET!,
      { algorithm: "HS256", expiresIn: "1h" }
    );

    const sessionRes = await api("GET", "/api/auth/session", {
      cookie: `session=${legacyToken}`
    });
    assert.equal(sessionRes.status, 200);
    assert.equal(sessionRes.json.status, "authenticated");
    assert.equal(sessionRes.json.user.id, userId);
  });
});
