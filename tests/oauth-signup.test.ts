/**
 * A new member signs up through Google or GitHub (oauth step 6): the provider
 * step makes a pending sign-up, the member chooses a username, and /complete
 * creates the account with the verified e-mail stored. Real server, fake provider.
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
const fake = makeFakeOAuth();

let tmpDir = "";
let server: TestServer;
let api: ReturnType<typeof client>;
let db: typeof import("../db.js");
let domainServer: TestServer;

let nextIp = 1;
let ip = "10.1.0.1";
beforeEach(() => {
  ip = `10.1.0.${nextIp++}`;
});

const oauthEnv = {
  PUBLIC_URL: "https://leeterboard.test",
  GITHUB_CLIENT_ID: "gh-id",
  GITHUB_CLIENT_SECRET: "gh-secret-VALUE",
  GOOGLE_CLIENT_ID: "g-id",
  GOOGLE_CLIENT_SECRET: "g-secret-VALUE",
  OAUTH_DEV_PROVIDER_URL: ""
};

async function hit(base: TestServer, route: string, cookie?: string) {
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(base.url + route, { redirect: "manual", headers });
  const setCookies = res.headers.getSetCookie();
  const pick = (name: string) => setCookies.find((c) => c.startsWith(`${name}=`)) ?? null;
  return { status: res.status, location: res.headers.get("location") ?? "", pick };
}

// start -> the provider approves -> callback. Returns the callback's answer and the pending cookie.
async function approve(
  provider: "github" | "google",
  profile: { id: string | number; email: string; name?: string },
  options: Parameters<typeof fake.issueCode>[2] = {},
  base: TestServer = server
) {
  const start = await hit(base, `/api/auth/oauth/${provider}/start`);
  const state = new URL(start.location).searchParams.get("state")!;
  const stateCookie = start.pick("oauth_state")!.split(";")[0];
  const code = fake.issueCode(provider, profile, options);
  const cb = await hit(base, `/api/auth/oauth/${provider}/callback?code=${code}&state=${state}`, stateCookie);
  const signup = cb.pick("oauth_signup");
  return { ...cb, signupCookie: signup ? signup.split(";")[0] : null, rawSignup: signup };
}

const post = (route: string, body: unknown, cookie?: string | null) =>
  api("POST", route, { body, cookie, headers: { "x-forwarded-for": ip } });
const complete = (cookie: string | null, body: unknown) => post("/api/auth/oauth/complete", body, cookie);
const count = async (sql: string, args: (string | number)[] = []) =>
  Number((await db.client.execute({ sql, args })).rows[0].n);

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-oauth-signup-"));
  const dbUrl = `file:${path.join(tmpDir, "test.db")}`;
  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");
  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");
  await db.insertUser(makeUser("TakenName"), await hashPassword(PW), { loginUsername: "takenname" });
  await db.insertUser(makeUser("owner"), await hashPassword(PW));
  await db.setUserEmail((await db.getUserAuthByLoginUsername("owner"))!.user.id, "used@example.com");

  server = await startServer(mergeEnv(fake.env, { TURSO_DATABASE_URL: dbUrl, JWT_SECRET: secret, ...oauthEnv }));
  api = client(server);
  domainServer = await startServer(mergeEnv(fake.env, { ...oauthEnv, ALLOWED_EMAIL_DOMAINS: "school.edu" }));
});

after(async () => {
  await server?.stop();
  await domainServer?.stop();
  fake.cleanup();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("the provider step", () => {
  it("starts a pending sign-up and sends the browser to the username screen", async () => {
    const r = await approve("github", { id: 3001, email: "New.Person@Example.com", name: "New Person" });
    assert.equal(r.location, "/#/signup/username");
    assert.match(r.rawSignup!, /HttpOnly/i);
    assert.match(r.rawSignup!, /SameSite=Lax/i);
    assert.match(r.rawSignup!, /Secure/i);
    assert.match(r.rawSignup!, /Path=\/api\/auth(;|$)/);
    assert.equal(await count("SELECT count(*) AS n FROM users WHERE login_username = 'new.person'"), 0, "nothing is created yet");
    const row = (await db.client.execute("SELECT * FROM pending_oauth_signups WHERE provider_user_id = '3001'")).rows[0] as any;
    assert.equal(row.email, "new.person@example.com", "stored lowercase");
    assert.equal(row.display_name, "New Person");
  });

  it("refuses an address another member already uses, and creates nothing", async () => {
    const before = await count("SELECT count(*) AS n FROM pending_oauth_signups");
    const r = await approve("github", { id: 3002, email: "USED@example.com" });
    assert.equal(r.location, "/#/login?oauth_error=email_in_use");
    assert.equal(r.signupCookie, null);
    assert.equal(await count("SELECT count(*) AS n FROM pending_oauth_signups"), before);
    assert.equal(await count("SELECT count(*) AS n FROM oauth_identities WHERE provider_user_id = '3002'"), 0);
  });

  it("refuses an address outside ALLOWED_EMAIL_DOMAINS, and accepts one inside it", async () => {
    const no = await approve("github", { id: 3003, email: "x@gmail.com" }, {}, domainServer);
    assert.equal(no.location, "/#/login?oauth_error=domain_not_allowed");
    assert.equal(no.signupCookie, null);
    const yes = await approve("github", { id: 3004, email: "x@school.edu" }, {}, domainServer);
    assert.equal(yes.location, "/#/signup/username");
  });
});

describe("GET /api/auth/oauth/pending", () => {
  it("shows the provider, a masked address and the suggested name, and never the address", async () => {
    const r = await approve("google", { id: "g-3010", email: "alice@example.com", name: "Alice A" });
    const res = await api("GET", "/api/auth/oauth/pending", { cookie: r.signupCookie, headers: { "x-forwarded-for": ip } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { provider: "google", maskedEmail: "a***@example.com", suggestedDisplayName: "Alice A" });
    assert.equal(res.text.includes("alice@example.com"), false);
  });

  it("answers 400 without a cookie, with junk, and after it expired", async () => {
    const none = await api("GET", "/api/auth/oauth/pending", { headers: { "x-forwarded-for": ip } });
    assert.equal(none.status, 400);
    assert.equal(none.json.error, "This sign-up has expired. Please start again.");
    const junk = await api("GET", "/api/auth/oauth/pending", { cookie: "oauth_signup=../../etc", headers: { "x-forwarded-for": ip } });
    assert.equal(junk.status, 400);

    const r = await approve("google", { id: "g-3011", email: "bob@example.com" });
    await db.client.execute({ sql: "UPDATE pending_oauth_signups SET expires_at = ? WHERE provider_user_id = 'g-3011'", args: ["2020-01-01T00:00:00.000Z"] });
    const gone = await api("GET", "/api/auth/oauth/pending", { cookie: r.signupCookie, headers: { "x-forwarded-for": ip } });
    assert.equal(gone.status, 400);
  });
});

describe("POST /api/auth/oauth/complete", () => {
  it("creates the member with the verified e-mail, no password, and signs them in", async () => {
    const r = await approve("github", { id: 3020, email: "Carol@Example.com", name: "Carol C" });
    const res = await complete(r.signupCookie, { username: "Carol_C", displayName: "  Carol   C  " });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.json.loginUsername, "carol_c");
    assert.equal(res.json.displayName, "Carol C");
    assert.equal("email" in res.json, false);
    assert.equal(res.text.includes("carol@example.com"), false);

    const row = (await db.client.execute("SELECT * FROM users WHERE login_username = 'carol_c'")).rows[0] as any;
    assert.equal(row.email, "carol@example.com");
    assert.ok(row.email_verified_at, "email_verified_at is set");
    assert.equal(row.password_hash, "");
    assert.equal(await count("SELECT count(*) AS n FROM oauth_identities WHERE provider = 'github' AND provider_user_id = '3020' AND user_id = ?", [row.id]), 1);
    assert.equal(await count("SELECT count(*) AS n FROM pending_oauth_signups WHERE provider_user_id = '3020'"), 0);

    const me = await api("GET", "/api/auth/session", { cookie: res.cookie });
    assert.equal(me.json.status, "authenticated");
    assert.equal(me.json.user.loginUsername, "carol_c");
    assert.equal((await api("POST", "/api/auth/login", { body: { username: "carol_c", password: "" } })).status, 400);
  });

  it("falls back to the username when no display name is sent", async () => {
    const r = await approve("github", { id: 3021, email: "dave@example.com" });
    const res = await complete(r.signupCookie, { username: "dave_d" });
    assert.equal(res.status, 201);
    assert.equal(res.json.displayName, "dave_d");
  });

  it("answers 409 for a taken username in any case, and the sign-up stays usable", async () => {
    const r = await approve("github", { id: 3022, email: "erin@example.com" });
    for (const name of ["takenname", "TAKENNAME", "Carol_C"]) {
      const res = await complete(r.signupCookie, { username: name });
      assert.equal(res.status, 409, name);
      assert.equal(res.json.error, "That username is taken.");
    }
    assert.equal((await complete(r.signupCookie, { username: "erin_e" })).status, 201);
  });

  it("answers 400 for a bad username and keeps the sign-up", async () => {
    const r = await approve("github", { id: 3023, email: "frank@example.com" });
    for (const username of ["", "a", "has space", 42, undefined]) {
      assert.equal((await complete(r.signupCookie, { username })).status, 400, String(username));
    }
    assert.equal((await complete(r.signupCookie, { username: "frank_f" })).status, 201);
  });

  it("answers 400 without a cookie or with an expired sign-up, creating nothing", async () => {
    const users = await count("SELECT count(*) AS n FROM users");
    assert.equal((await complete(null, { username: "ghost_user" })).status, 400);
    const r = await approve("github", { id: 3024, email: "gina@example.com" });
    await db.client.execute({ sql: "UPDATE pending_oauth_signups SET expires_at = ? WHERE provider_user_id = '3024'", args: ["2020-01-01T00:00:00.000Z"] });
    const res = await complete(r.signupCookie, { username: "gina_g" });
    assert.equal(res.status, 400);
    assert.equal(res.json.expired, true);
    assert.equal(await count("SELECT count(*) AS n FROM users"), users);
  });

  it("refuses if the address was taken after the provider step, creating nothing", async () => {
    const r = await approve("github", { id: 3025, email: "late@example.com" });
    const owner = (await db.getUserAuthByLoginUsername("owner"))!.user.id;
    await db.client.execute({ sql: "UPDATE users SET email = 'late@example.com' WHERE id = ?", args: [owner] });
    const res = await complete(r.signupCookie, { username: "hank_h" });
    assert.equal(res.status, 409);
    assert.match(res.json.error, /already uses this email/);
    assert.equal(await count("SELECT count(*) AS n FROM users WHERE login_username = 'hank_h'"), 0);
    assert.equal(await count("SELECT count(*) AS n FROM oauth_identities WHERE provider_user_id = '3025'"), 0);
    await db.client.execute({ sql: "UPDATE users SET email = 'used@example.com' WHERE id = ?", args: [owner] });
  });

  it("is single use: two simultaneous completions create one member", async () => {
    const r = await approve("github", { id: 3026, email: "ivy@example.com" });
    const results = await Promise.all([complete(r.signupCookie, { username: "ivy_i" }), complete(r.signupCookie, { username: "ivy_j" })]);
    assert.deepEqual(results.map((x) => x.status).sort(), [201, 400]);
    assert.equal(await count("SELECT count(*) AS n FROM oauth_identities WHERE provider_user_id = '3026'"), 1);
  });

  it("never gives one provider account two members", async () => {
    // Two provider steps for the same identity: the second replaces the first.
    const a = await approve("github", { id: 3027, email: "jo@example.com" });
    const b = await approve("github", { id: 3027, email: "jo@example.com" });
    assert.equal((await complete(a.signupCookie, { username: "jo_one" })).status, 400, "the replaced sign-up is dead");
    assert.equal((await complete(b.signupCookie, { username: "jo_two" })).status, 201);
    // Signing in again with that identity signs in the same member, it does not start a sign-up.
    const again = await approve("github", { id: 3027, email: "jo@example.com" });
    assert.equal(again.location, "/#/");
    assert.equal(again.signupCookie, null);
    assert.equal(await count("SELECT count(*) AS n FROM users WHERE login_username IN ('jo_one','jo_two')"), 1);
  });

  it("the same e-mail through another provider is refused, not merged", async () => {
    const r = await approve("google", { id: "g-3028", email: "carol@example.com" });
    assert.equal(r.location, "/#/login?oauth_error=email_in_use");
    assert.equal(r.signupCookie, null);
  });

  it("is rate limited per address", async () => {
    let last = 0;
    for (let i = 0; i < 40 && last !== 429; i++) last = (await complete(null, { username: "spam_user" })).status;
    assert.equal(last, 429);
  });

  it("logs account_created with a masked address and no secrets", async () => {
    const logs = server.logs();
    assert.match(logs, /"event":"account_created"[^\n]*"provider":"github"/);
    assert.match(logs, /"maskedEmail":"c\*\*\*@example\.com"/);
    for (const needle of ["carol@example.com", "gh-secret-VALUE", "fake-github-token", "FAKE-PROVIDER"]) {
      assert.equal(logs.includes(needle), false, needle);
    }
  });
});
