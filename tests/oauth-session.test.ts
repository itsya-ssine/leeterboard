/**
 * The session payload and the admin rule (oauth step 8): what /api/auth/session
 * says about sign-in methods and enabled providers, who can see an address, and
 * why admin accounts can neither sign in with nor connect a provider (D5).
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { client, startServer, type TestServer } from "./helpers.js";
import { makeFakeOAuth, makeUser, mergeEnv } from "./f2-seed.js";

const PW = "correct-horse-battery-9";
// A link state for the admin, written before the server starts so the test never
// writes to the database file while the server is also using it.
const ADMIN_LINK_STATE = "b".repeat(32);
const fake = makeFakeOAuth();

let tmpDir = "";
let server: TestServer;
let bare: TestServer; // no provider configured
let api: ReturnType<typeof client>;
let db: typeof import("../db.js");

let nextIp = 1;
let ip = "10.3.0.1";
beforeEach(() => {
  ip = `10.3.0.${nextIp++}`;
});

const oauthEnv = {
  PUBLIC_URL: "https://leeterboard.test",
  GITHUB_CLIENT_ID: "gh-id",
  GITHUB_CLIENT_SECRET: "gh-secret-VALUE",
  GOOGLE_CLIENT_ID: "g-id",
  GOOGLE_CLIENT_SECRET: "g-secret-VALUE",
  OAUTH_DEV_PROVIDER_URL: ""
};

async function hit(route: string, cookie?: string) {
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(server.url + route, { redirect: "manual", headers });
  const setCookies = res.headers.getSetCookie();
  const pick = (name: string) => setCookies.find((c) => c.startsWith(`${name}=`)) ?? null;
  return { status: res.status, location: res.headers.get("location") ?? "", pick };
}
const get = (route: string, cookie: string | null) => api("GET", route, { cookie, headers: { "x-forwarded-for": ip } });
const loginPw = async (username: string) => {
  const res = await api("POST", "/api/auth/login", { body: { username, password: PW } });
  assert.equal(res.status, 200, res.text);
  return res.cookie!;
};
async function loginOAuth(provider: "github" | "google", profile: { id: string | number; email: string }) {
  const start = await hit(`/api/auth/oauth/${provider}/start`);
  const state = new URL(start.location).searchParams.get("state")!;
  const code = fake.issueCode(provider, profile);
  return hit(`/api/auth/oauth/${provider}/callback?code=${code}&state=${state}`, start.pick("oauth_state")!.split(";")[0]);
}

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-oauth-session-"));
  const dbUrl = `file:${path.join(tmpDir, "test.db")}`;
  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");
  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");
  const hash = await hashPassword(PW);
  await db.insertUser(makeUser("plain_member"), hash);
  await db.insertUser(makeUser("both_ways"), hash);
  await db.addOAuthIdentity((await db.getUserAuthByLoginUsername("both_ways"))!.user.id, "github", "9001");
  await db.setUserEmail((await db.getUserAuthByLoginUsername("both_ways"))!.user.id, "both@example.com");
  await db.insertUserWithIdentity(makeUser("oauth_only", { leetcodeLinked: false, leetcodeUsername: "" }), {
    loginUsername: "oauth_only",
    email: "oauthonly@example.com",
    provider: "google",
    providerUserId: "g-9002"
  });
  // The server's admin is the member whose LeetCode name is test_admin.
  await db.insertUser(makeUser("test_admin"), hash);
  const adminId = (await db.getUserAuthByLoginUsername("test_admin"))!.user.id;
  await db.addOAuthIdentity(adminId, "github", "9003");
  await db.createOAuthState({
    id: ADMIN_LINK_STATE,
    provider: "google",
    intent: "link",
    userId: adminId,
    codeVerifier: "v".repeat(43),
    expiresAt: "2099-01-01T00:00:00.000Z"
  });

  server = await startServer(mergeEnv(fake.env, { TURSO_DATABASE_URL: dbUrl, JWT_SECRET: secret, ...oauthEnv }));
  bare = await startServer({
    GITHUB_CLIENT_ID: "",
    GITHUB_CLIENT_SECRET: "",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    PUBLIC_URL: "",
    OAUTH_DEV_PROVIDER_URL: ""
  });
  api = client(server);
});

after(async () => {
  await server?.stop();
  await bare?.stop();
  fake.cleanup();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /api/auth/session", () => {
  it("tells a visitor which providers are enabled, and nothing about anyone", async () => {
    const res = await get("/api/auth/session", null);
    assert.deepEqual(res.json, { status: "guest", oauthProviders: ["github", "google"] });
  });

  it("lists no provider when none is configured (sign-up is then unavailable)", async () => {
    const res = await client(bare)("GET", "/api/auth/session");
    assert.deepEqual(res.json, { status: "guest", oauthProviders: [] });
  });

  it("gives a member with a password and no provider their methods", async () => {
    const res = await get("/api/auth/session", await loginPw("plain_member"));
    assert.deepEqual(res.json.user.signInMethods, { password: true, providers: [] });
    assert.equal(res.json.user.email, null);
    assert.equal(res.json.user.emailVerified, false);
    assert.deepEqual(res.json.oauthProviders, ["github", "google"]);
  });

  it("gives a member with both a password and a provider their own address", async () => {
    const res = await get("/api/auth/session", await loginPw("both_ways"));
    assert.deepEqual(res.json.user.signInMethods, { password: true, providers: ["github"] });
    assert.equal(res.json.user.email, "both@example.com");
    assert.equal(res.json.user.emailVerified, true);
  });

  it("gives an OAuth-only member no password and their provider", async () => {
    const cb = await loginOAuth("google", { id: "g-9002", email: "oauthonly@example.com" });
    const res = await get("/api/auth/session", cb.pick("session")!.split(";")[0]);
    assert.deepEqual(res.json.user.signInMethods, { password: false, providers: ["google"] });
    assert.equal(res.json.user.email, "oauthonly@example.com");
    assert.equal(res.json.user.emailVerified, true);
  });

  it("never shows another member's address, on the session or the board", async () => {
    const viewer = await loginPw("plain_member");
    const session = await get("/api/auth/session", viewer);
    const users = await get("/api/users", viewer);
    assert.equal(users.status, 200);
    for (const res of [session, users]) {
      for (const address of ["both@example.com", "oauthonly@example.com"]) {
        assert.equal(res.text.includes(address), false, address);
      }
    }
    assert.doesNotMatch(users.text, /"email/i);
    assert.doesNotMatch(users.text, /signInMethods/);
    assert.doesNotMatch(users.text, /oauthProviders|"providers"|provider_user_id/);
  });
});

describe("admin accounts (D5)", () => {
  it("cannot sign in with a provider, even one connected earlier", async () => {
    const cb = await loginOAuth("github", { id: 9003, email: "admin@example.com" });
    assert.equal(cb.location, "/#/login?oauth_error=admin_refused");
    assert.equal(cb.pick("session"), null);
  });

  it("cannot start connecting a provider", async () => {
    const admin = await loginPw("test_admin");
    const before = await db.client.execute("SELECT count(*) AS n FROM oauth_states WHERE intent = 'link'");
    const res = await api("POST", "/api/account/oauth/google/start", {
      cookie: admin,
      body: { currentPassword: PW },
      headers: { "x-forwarded-for": ip }
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.code, undefined, "must not end the admin's session");
    assert.deepEqual((await db.client.execute("SELECT count(*) AS n FROM oauth_states WHERE intent = 'link'")).rows[0], before.rows[0]);
  });

  it("cannot finish a connection that was somehow started, and nothing is attached", async () => {
    const admin = await loginPw("test_admin");
    const adminId = (await db.getUserAuthByLoginUsername("test_admin"))!.user.id;
    const id = ADMIN_LINK_STATE;
    const code = fake.issueCode("google", { id: "g-9004", email: "admin@example.com" });
    const res = await hit(`/api/auth/oauth/google/callback?code=${code}&state=${id}`, `${admin}; oauth_state=${id}`);
    assert.equal(res.location, "/#/account?oauth_error=admin_refused");
    assert.deepEqual(await db.listOAuthProviders(adminId), ["github"]);
  });

  it("still signs in with a password", async () => {
    assert.equal((await get("/api/auth/session", await loginPw("test_admin"))).json.user.isAdmin, true);
  });

  it("logs the refusals without an address or a token", async () => {
    const logs = server.logs();
    assert.match(logs, /"reason":"admin_refused"/);
    for (const needle of ["admin@example.com", "both@example.com", "oauthonly@example.com", "fake-github-token", "gh-secret-VALUE"]) {
      assert.equal(logs.includes(needle), false, needle);
    }
  });
});
