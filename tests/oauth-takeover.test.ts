/**
 * Account takeover prevention (oauth step 16):
 * Never sign someone in, or attach an identity, because an email matches.
 * Only (provider, provider_user_id) or an explicit signed-in link action does that.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { approveViaOAuth, client, startServer, type TestServer } from "./helpers.js";
import { makeFakeOAuth, makeUser, mergeEnv, OAUTH_TEST_ENV } from "./f2-seed.js";

const PW = "correct-horse-battery-9";
const fake = makeFakeOAuth();

let tmpDir = "";
let server: TestServer;
let api: ReturnType<typeof client>;
let db: typeof import("../db.js");

let nextIp = 1;
let ip = "10.3.0.1";
beforeEach(() => {
  ip = `10.3.0.${nextIp++}`;
});

async function hit(route: string, cookie?: string) {
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(server.url + route, { redirect: "manual", headers });
  const setCookies = res.headers.getSetCookie();
  const pick = (name: string) =>
    setCookies.find((c) => c.startsWith(`${name}=`) || c.startsWith(`__Host-${name}=`) || c.startsWith(`__Secure-${name}=`)) ?? null;
  return { status: res.status, location: res.headers.get("location") ?? "", pick };
}

async function loginPw(username: string): Promise<string> {
  const res = await api("POST", "/api/auth/login", { body: { username, password: PW } });
  assert.equal(res.status, 200, res.text);
  return res.cookie!;
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-takeover-"));
  const dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  const jwtSecret = crypto.randomBytes(48).toString("hex");
  process.env.JWT_SECRET = jwtSecret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");

  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");
  const hash = await hashPassword(PW);

  // 1. Password member with email
  const alice = makeUser("Alice");
  await db.insertUser(alice, hash, { loginUsername: "alice_pw" });
  await db.setUserEmail(alice.id, "alice@example.com");

  // 2. Member Bob with Google identity
  const bob = makeUser("Bob");
  await db.insertUser(bob, "", { loginUsername: "bob_oauth" });
  await db.setUserEmail(bob.id, "bob@example.com");
  await db.addOAuthIdentity(bob.id, "google", "google-bob-id");

  // 3. Member Eve (attacker with password and no email)
  const eve = makeUser("Eve");
  await db.insertUser(eve, hash, { loginUsername: "eve_attacker" });

  // 4. Admin account with email
  const admin = makeUser("AdminUser", { leetcodeUsername: "test_admin" });
  await db.insertUser(admin, hash, { loginUsername: "admin_takeover" });
  await db.setUserEmail(admin.id, "admin@example.com");

  server = await startServer(mergeEnv(fake.env, {
    ...OAUTH_TEST_ENV,
    TURSO_DATABASE_URL: dbUrl,
    JWT_SECRET: jwtSecret,
    ADMIN_USER_IDS: admin.id
  }));
  api = client(server);
});

after(async () => {
  await server.stop();
  fake.cleanup();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("preventing account takeover via email matching on sign-in", () => {
  it("cannot sign in as an existing password member by presenting their email", async () => {
    // Attacker visits OAuth callback with Alice's verified email, but a new provider ID
    const step = await approveViaOAuth(api, fake, {
      provider: "github",
      providerUserId: "91001",
      email: "alice@example.com"
    });

    // Refused because the email is in use: redirects to login, sets no session or signup cookie
    assert.equal(step.location, "/#/login?oauth_error=email_in_use");
    assert.equal(step.sessionCookie, null);
    assert.equal(step.signupCookie, null);

    // Alice has not been attached to the attacker's identity
    const aliceAuth = await db.getUserAuthByLoginUsername("alice_pw");
    assert.ok(aliceAuth);
    const identities = await db.listOAuthProviders(aliceAuth.user.id);
    assert.deepEqual(identities, [], "Alice still has no OAuth identities");

    // Alice can still sign in with her password
    const aliceCookie = await loginPw("alice_pw");
    assert.ok(aliceCookie);
  });

  it("case-insensitive email matching prevents takeover using uppercase email", async () => {
    const step = await approveViaOAuth(api, fake, {
      provider: "github",
      providerUserId: "91002",
      email: "ALICE@EXAMPLE.COM"
    });
    assert.equal(step.location, "/#/login?oauth_error=email_in_use");
    assert.equal(step.sessionCookie, null);
    assert.equal(step.signupCookie, null);
  });

  it("cannot cross-sign-in as a member who registered via another provider with the same email", async () => {
    // Bob signed up with Google. Attacker logs in with GitHub using Bob's email.
    const step = await approveViaOAuth(api, fake, {
      provider: "github",
      providerUserId: "91003",
      email: "bob@example.com"
    });

    assert.equal(step.location, "/#/login?oauth_error=email_in_use");
    assert.equal(step.sessionCookie, null);

    // Bob still only has Google connected
    const bobAuth = await db.getUserAuthByLoginUsername("bob_oauth");
    const bobIdentities = await db.listOAuthProviders(bobAuth!.user.id);
    assert.deepEqual(bobIdentities, ["google"]);
  });
});

describe("preventing account takeover via pending sign-up race", () => {
  it("refuses completion if another member took the email before complete was called", async () => {
    // Attacker starts sign-up for fresh-email@example.com
    const email = "racing-email@example.com";
    const start = await hit("/api/auth/oauth/github/start");
    const state = new URL(start.location).searchParams.get("state")!;
    const code = fake.issueCode("github", { id: 91004, email });
    const cb = await hit(`/api/auth/oauth/github/callback?code=${code}&state=${state}`, start.pick("oauth_state")!.split(";")[0]);
    assert.equal(cb.location, "/#/signup/username");
    const signupCookie = cb.pick("oauth_signup")!.split(";")[0];

    // Meanwhile, an existing member connects or is assigned this email in the database
    const legit = makeUser("LegitUser");
    await db.insertUser(legit, "hash", { loginUsername: "legit_user" });
    await db.setUserEmail(legit.id, email);

    // Attacker tries to complete sign-up with that pending cookie
    const complete = await api("POST", "/api/auth/oauth/complete", {
      body: { username: "attacker_race" },
      cookie: signupCookie,
      headers: { "x-forwarded-for": ip }
    });

    assert.equal(complete.status, 409);
    assert.match(complete.json.error, /already uses this email/);

    // No user was created for the attacker
    const check = await db.getUserAuthByLoginUsername("attacker_race");
    assert.equal(check, null);
  });
});

describe("preventing account takeover via connecting in Account settings", () => {
  it("refuses to connect an identity whose verified email belongs to another member", async () => {
    const eveCookie = await loginPw("eve_attacker");

    // Eve starts link flow
    const start = await api("POST", "/api/account/oauth/github/start", {
      body: { currentPassword: PW },
      cookie: eveCookie,
      headers: { "x-forwarded-for": ip }
    });
    assert.equal(start.status, 200);

    const state = new URL(start.json.url).searchParams.get("state")!;
    const stateCookie = `oauth_state=${state}`;

    // Fake GitHub responds with Alice's email
    const code = fake.issueCode("github", { id: 91005, email: "alice@example.com" });
    const cb = await hit(`/api/auth/oauth/github/callback?code=${code}&state=${state}`, `${eveCookie}; ${stateCookie}`);

    assert.equal(cb.location, "/#/account?oauth_error=email_in_use");

    // Eve did not get the identity attached
    const eveAuth = await db.getUserAuthByLoginUsername("eve_attacker");
    const eveIdentities = await db.listOAuthProviders(eveAuth!.user.id);
    assert.deepEqual(eveIdentities, []);

    // Alice is untouched
    const aliceAuth = await db.getUserAuthByLoginUsername("alice_pw");
    const aliceEmail = await db.getUserEmail(aliceAuth!.user.id);
    assert.equal(aliceEmail?.email, "alice@example.com");
  });

  it("refuses to connect an identity already linked to another member", async () => {
    const eveCookie = await loginPw("eve_attacker");

    // Eve starts link flow for Google
    const start = await api("POST", "/api/account/oauth/google/start", {
      body: { currentPassword: PW },
      cookie: eveCookie,
      headers: { "x-forwarded-for": ip }
    });
    assert.equal(start.status, 200);

    const state = new URL(start.json.url).searchParams.get("state")!;
    const stateCookie = `oauth_state=${state}`;

    // Google returns Bob's provider user id
    const code = fake.issueCode("google", { id: "google-bob-id", email: "eve-different@example.com" });
    const cb = await hit(`/api/auth/oauth/google/callback?code=${code}&state=${state}`, `${eveCookie}; ${stateCookie}`);

    assert.equal(cb.location, "/#/account?oauth_error=already_linked");

    // Bob still owns it, not Eve
    const owner = await db.getUserIdByOAuthIdentity("google", "google-bob-id");
    const bobAuth = await db.getUserAuthByLoginUsername("bob_oauth");
    assert.equal(owner, bobAuth!.user.id);
  });
});

describe("preventing admin account takeover (D5)", () => {
  it("cannot sign in as admin using admin's email", async () => {
    const step = await approveViaOAuth(api, fake, {
      provider: "github",
      providerUserId: "91006",
      email: "admin@example.com"
    });
    assert.equal(step.location, "/#/login?oauth_error=email_in_use");
    assert.equal(step.sessionCookie, null);
  });

  it("refuses OAuth callback even if admin identity exists in oauth_identities", async () => {
    const adminAuth = await db.getUserAuthByLoginUsername("admin_takeover");
    await db.addOAuthIdentity(adminAuth!.user.id, "github", "91007");

    const start = await hit("/api/auth/oauth/github/start");
    const state = new URL(start.location).searchParams.get("state")!;
    const code = fake.issueCode("github", { id: 91007, email: "admin@example.com" });
    const cb = await hit(`/api/auth/oauth/github/callback?code=${code}&state=${state}`, start.pick("oauth_state")!.split(";")[0]);

    assert.equal(cb.location, "/#/login?oauth_error=admin_refused");
    assert.equal(cb.pick("session"), null);
  });
});
