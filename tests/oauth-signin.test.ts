/**
 * Sign in with Google / GitHub, known identities only (oauth step 5): /start and
 * /callback against the real server in production mode, with the fake provider
 * standing in for the network. Nothing here calls the real GitHub or Google.
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
const PUBLIC_URL = "https://leeterboard.test";

let tmpDir = "";
let server: TestServer;
let api: ReturnType<typeof client>;
const fake = makeFakeOAuth();
let db: typeof import("../db.js");

// The server trusts one proxy hop in production, so each test gets its own
// address through X-Forwarded-For and the per-IP limit (30) is not shared.
let nextIp = 1;
let ip = "10.0.0.1";
beforeEach(() => {
  ip = `10.0.0.${nextIp++}`;
});

// The server answers with redirects; read them instead of following them.
async function hit(route: string, cookie?: string) {
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(server.url + route, { redirect: "manual", headers });
  const setCookies = res.headers.getSetCookie();
  const pick = (name: string) => setCookies.find((c) => c.startsWith(`${name}=`)) ?? null;
  return { status: res.status, location: res.headers.get("location") ?? "", setCookies, pick };
}

// Runs /start and returns the state id, the cookie to send back and the PKCE challenge.
async function begin(provider: "github" | "google" = "github") {
  const res = await hit(`/api/auth/oauth/${provider}/start`);
  assert.equal(res.status, 302);
  const url = new URL(res.location);
  const cookie = res.pick("oauth_state")!.split(";")[0];
  return { res, url, state: url.searchParams.get("state")!, cookie, challenge: url.searchParams.get("code_challenge")! };
}

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-oauth-signin-"));
  const dbUrl = `file:${path.join(tmpDir, "test.db")}`;
  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");
  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");

  // A member with a password who has GitHub connected.
  await db.insertUser(makeUser("with_pw"), await hashPassword(PW));
  const withPw = await db.getUserAuthByLoginUsername("with_pw");
  await db.addOAuthIdentity(withPw!.user.id, "github", "1001");
  // An OAuth-created member: no password at all.
  await db.insertUserWithIdentity(makeUser("no_pw", { leetcodeLinked: false, leetcodeUsername: "" }), {
    loginUsername: "no_pw",
    email: "nopw@example.com",
    provider: "google",
    providerUserId: "g-2002"
  });
  // Shares an e-mail with a provider account below, but has no identity.
  await db.insertUser(makeUser("email_owner"), await hashPassword(PW));
  await db.setUserEmail((await db.getUserAuthByLoginUsername("email_owner"))!.user.id, "shared@example.com");

  server = await startServer(
    mergeEnv(fake.env, {
      TURSO_DATABASE_URL: dbUrl,
      JWT_SECRET: secret,
      PUBLIC_URL,
      GITHUB_CLIENT_ID: "gh-id",
      GITHUB_CLIENT_SECRET: "gh-secret-VALUE",
      GOOGLE_CLIENT_ID: "g-id",
      GOOGLE_CLIENT_SECRET: "g-secret-VALUE",
      OAUTH_DEV_PROVIDER_URL: ""
    })
  );
  api = client(server);
});

after(async () => {
  await server?.stop();
  fake.cleanup();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("/start", () => {
  it("redirects to GitHub with state, PKCE and the fixed redirect_uri", async () => {
    const { res, url, state } = await begin("github");
    assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
    assert.equal(url.searchParams.get("client_id"), "gh-id");
    assert.equal(url.searchParams.get("redirect_uri"), `${PUBLIC_URL}/api/auth/oauth/github/callback`);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.match(state, /^[0-9a-f]{32}$/);
    const cookie = res.pick("oauth_state")!;
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /Path=\/api\/auth\/oauth/);
    assert.equal(res.location.includes("gh-secret-VALUE"), false);
  });

  it("redirects to Google too", async () => {
    const { url } = await begin("google");
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("prompt"), "select_account");
  });

  it("stores the verifier in the database, never in the redirect", async () => {
    const { res, state } = await begin("github");
    const row = (await db.client.execute({ sql: "SELECT * FROM oauth_states WHERE id = ?", args: [state] })).rows[0] as any;
    assert.equal(row.intent, "signin");
    assert.equal(row.user_id, null);
    assert.equal(res.location.includes(row.code_verifier), false);
  });

  it("answers unavailable for an unknown provider and echoes nothing", async () => {
    const res = await hit("/api/auth/oauth/facebook<script>/start");
    assert.equal(res.status, 302);
    assert.equal(res.location, "/#/login?oauth_error=unavailable");
  });
});

describe("/callback", () => {
  it("signs in a member with a password through a known identity", async () => {
    const { state, cookie, challenge } = await begin("github");
    const code = fake.issueCode("github", { id: 1001, email: "whatever@example.com", name: "W" }, { challenge });
    const res = await hit(`/api/auth/oauth/github/callback?code=${code}&state=${state}`, cookie);
    assert.equal(res.status, 302);
    assert.equal(res.location, "/#/");
    assert.match(res.pick("oauth_state")!, /oauth_state=;/, "the state cookie is cleared");
    const session = res.pick("session")!.split(";")[0];
    const me = await api("GET", "/api/auth/session", { cookie: session });
    assert.equal(me.json.status, "authenticated");
    assert.equal(me.json.user.loginUsername, "with_pw");
  });

  it("signs in a member who has no password, and the session survives", async () => {
    const { state, cookie } = await begin("google");
    const code = fake.issueCode("google", { id: "g-2002", email: "nopw@example.com" });
    const res = await hit(`/api/auth/oauth/google/callback?code=${code}&state=${state}`, cookie);
    assert.equal(res.location, "/#/");
    const session = res.pick("session")!.split(";")[0];
    assert.equal((await api("GET", "/api/users", { cookie: session })).status, 200);
    assert.equal((await api("GET", "/api/auth/session", { cookie: session })).json.user.loginUsername, "no_pw");
  });

  it("cannot log in with an empty password", async () => {
    const res = await api("POST", "/api/auth/login", { body: { username: "no_pw", password: "x" } });
    assert.equal(res.status, 401);
  });

  it("does not sign in as a member just because the e-mail matches", async () => {
    const { state, cookie } = await begin("github");
    const code = fake.issueCode("github", { id: 9999, email: "shared@example.com" });
    const res = await hit(`/api/auth/oauth/github/callback?code=${code}&state=${state}`, cookie);
    assert.equal(res.location, "/#/login?oauth_error=email_in_use");
    assert.equal(res.pick("session"), null);
    assert.equal(res.pick("oauth_signup"), null, "no pending sign-up is started either");
  });

  it("refuses a missing or wrong state cookie, without calling the provider", async () => {
    const { state } = await begin("github");
    const code = fake.issueCode("github", { id: 1001, email: "a@example.com" });
    const before = fake.calls().length;
    for (const cookie of [undefined, "oauth_state=" + "0".repeat(32)]) {
      const res = await hit(`/api/auth/oauth/github/callback?code=${code}&state=${state}`, cookie);
      assert.equal(res.location, "/#/login?oauth_error=failed");
      assert.equal(res.pick("session"), null);
    }
    assert.equal(fake.calls().length, before);
  });

  it("refuses a replayed state", async () => {
    const { state, cookie } = await begin("github");
    const c1 = fake.issueCode("github", { id: 1001, email: "a@example.com" });
    assert.equal((await hit(`/api/auth/oauth/github/callback?code=${c1}&state=${state}`, cookie)).location, "/#/");
    const c2 = fake.issueCode("github", { id: 1001, email: "a@example.com" });
    const again = await hit(`/api/auth/oauth/github/callback?code=${c2}&state=${state}`, cookie);
    assert.equal(again.location, "/#/login?oauth_error=expired");
    assert.equal(again.pick("session"), null);
  });

  it("refuses an expired state", async () => {
    const { state, cookie } = await begin("github");
    await db.client.execute({ sql: "UPDATE oauth_states SET expires_at = ? WHERE id = ?", args: ["2020-01-01T00:00:00.000Z", state] });
    const code = fake.issueCode("github", { id: 1001, email: "a@example.com" });
    assert.equal((await hit(`/api/auth/oauth/github/callback?code=${code}&state=${state}`, cookie)).location, "/#/login?oauth_error=expired");
  });

  it("refuses a state started for another provider", async () => {
    const { state, cookie } = await begin("google");
    const code = fake.issueCode("github", { id: 1001, email: "a@example.com" });
    assert.equal((await hit(`/api/auth/oauth/github/callback?code=${code}&state=${state}`, cookie)).location, "/#/login?oauth_error=failed");
  });

  it("turns access_denied into cancelled, and any other provider error into failed", async () => {
    const a = await begin("github");
    assert.equal((await hit(`/api/auth/oauth/github/callback?error=access_denied&state=${a.state}`, a.cookie)).location, "/#/login?oauth_error=cancelled");
    const b = await begin("github");
    const res = await hit(`/api/auth/oauth/github/callback?error=server_error%20EVIL&state=${b.state}`, b.cookie);
    assert.equal(res.location, "/#/login?oauth_error=failed");
  });

  it("refuses an unverified e-mail, and GitHub with no primary verified address", async () => {
    for (const options of [{ unverified: true }, { noPrimary: true }]) {
      const { state, cookie } = await begin("github");
      const code = fake.issueCode("github", { id: 1001, email: "a@example.com" }, options);
      const res = await hit(`/api/auth/oauth/github/callback?code=${code}&state=${state}`, cookie);
      assert.equal(res.location, "/#/login?oauth_error=unverified_email");
      assert.equal(res.pick("session"), null);
    }
  });

  it("maps a refused code to failed and a dead provider to failed, never echoing its text", async () => {
    for (const options of [{ badToken: true }, { down: true }]) {
      const { state, cookie } = await begin("github");
      const code = fake.issueCode("github", { id: 1001, email: "a@example.com" }, options);
      const res = await hit(`/api/auth/oauth/github/callback?code=${code}&state=${state}`, cookie);
      assert.equal(res.location, "/#/login?oauth_error=failed");
      assert.equal(res.location.includes("FAKE-PROVIDER"), false);
    }
  });

  it("checks the PKCE verifier at the provider", async () => {
    const { state, cookie, challenge } = await begin("github");
    const code = fake.issueCode("github", { id: 1001, email: "a@example.com" }, { challenge });
    assert.equal((await hit(`/api/auth/oauth/github/callback?code=${code}&state=${state}`, cookie)).location, "/#/");
  });

  it("never puts a code, token, secret or e-mail in the logs", async () => {
    const logs = server.logs();
    for (const needle of ["gh-secret-VALUE", "g-secret-VALUE", "fake-github-token", "fake-google-token", "FAKE-PROVIDER", "shared@example.com", "nopw@example.com", "a@example.com"]) {
      assert.equal(logs.includes(needle), false, `logs contain ${needle}`);
    }
    assert.match(logs, /"event":"oauth_login"/);
    assert.match(logs, /"event":"oauth_failed"/);
  });
});

describe("rate limit", () => {
  it("answers 429 after 30 requests from one address", async () => {
    let last = 0;
    for (let i = 0; i < 40 && last !== 429; i++) last = (await hit("/api/auth/oauth/github/callback")).status;
    assert.equal(last, 429);
  });
});
