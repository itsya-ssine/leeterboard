/**
 * Connecting and disconnecting Google / GitHub for members who already exist
 * (oauth step 7). Real server, fake provider.
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

let nextIp = 1;
let ip = "10.2.0.1";
beforeEach(() => {
  ip = `10.2.0.${nextIp++}`;
});

const count = async (sql: string, args: (string | number)[] = []) =>
  Number((await db.client.execute({ sql, args })).rows[0].n);
const idOf = async (login: string) => (await db.getUserAuthByLoginUsername(login))!.user.id;
const identities = async (login: string) => db.listOAuthProviders(await idOf(login));

async function hit(route: string, cookie?: string) {
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(server.url + route, { redirect: "manual", headers });
  const setCookies = res.headers.getSetCookie();
  const pick = (name: string) => setCookies.find((c) => c.startsWith(`${name}=`)) ?? null;
  return { status: res.status, location: res.headers.get("location") ?? "", pick };
}

const call = (method: string, route: string, cookie: string | null, body?: unknown) =>
  api(method, route, { cookie, body, headers: { "x-forwarded-for": ip } });

async function loginPw(username: string): Promise<string> {
  const res = await api("POST", "/api/auth/login", { body: { username, password: PW } });
  assert.equal(res.status, 200, res.text);
  return res.cookie!;
}

// A member without a password signs in through the provider and gets a session.
async function loginOAuth(provider: "github" | "google", profile: { id: string | number; email: string }): Promise<string> {
  const start = await hit(`/api/auth/oauth/${provider}/start`);
  const state = new URL(start.location).searchParams.get("state")!;
  const code = fake.issueCode(provider, profile);
  const cb = await hit(`/api/auth/oauth/${provider}/callback?code=${code}&state=${state}`, start.pick("oauth_state")!.split(";")[0]);
  assert.equal(cb.location, "/#/");
  return cb.pick("session")!.split(";")[0];
}

// Runs the whole connect flow: start (as the member) -> provider approves -> callback.
async function connect(
  session: string,
  provider: "github" | "google",
  profile: { id: string | number; email: string },
  opts: { password?: string; callbackSession?: string | null } = {}
) {
  const start = await call("POST", `/api/account/oauth/${provider}/start`, session, opts.password ? { currentPassword: opts.password } : {});
  assert.equal(start.status, 200, start.text);
  const state = new URL(start.json.url).searchParams.get("state")!;
  const stateCookie = `oauth_state=${state}`;
  const code = fake.issueCode(provider, profile);
  const sess = opts.callbackSession === undefined ? session : opts.callbackSession;
  return hit(`/api/auth/oauth/${provider}/callback?code=${code}&state=${state}`, sess ? `${sess}; ${stateCookie}` : stateCookie);
}

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-oauth-link-"));
  const dbUrl = `file:${path.join(tmpDir, "test.db")}`;
  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");
  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");
  const hash = await hashPassword(PW);
  for (const name of ["alice", "bob", "carl", "dora", "erin", "finn", "gail"]) await db.insertUser(makeUser(name), hash);
  await db.setUserEmail(await idOf("bob"), "bob-own@example.com"); // bob already has an address
  await db.setUserEmail(await idOf("carl"), "taken@example.com"); // carl owns an address others will meet

  server = await startServer(
    mergeEnv(fake.env, {
      TURSO_DATABASE_URL: dbUrl,
      JWT_SECRET: secret,
      PUBLIC_URL: "https://leeterboard.test",
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

describe("starting a connection", () => {
  it("needs a session", async () => {
    const res = await call("POST", "/api/account/oauth/github/start", null, {});
    assert.equal(res.status, 401);
    assert.equal(res.json.code, "session_required");
  });

  it("needs the current password from a member who has one", async () => {
    const session = await loginPw("alice");
    const none = await call("POST", "/api/account/oauth/github/start", session, {});
    assert.equal(none.status, 400);
    const wrong = await call("POST", "/api/account/oauth/github/start", session, { currentPassword: "not-the-password-1" });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.json.code, undefined, "a wrong password must not end the session");
    assert.match(server.logs(), /"event":"reauth_failed"[^\n]*"action":"oauth_link"/);
    assert.equal(await count("SELECT count(*) AS n FROM oauth_states WHERE intent = 'link'"), 0, "no state without the password");
  });

  it("answers with the provider URL and stores a link state for this member", async () => {
    const session = await loginPw("alice");
    const res = await call("POST", "/api/account/oauth/github/start", session, { currentPassword: PW });
    assert.equal(res.status, 200);
    const url = new URL(res.json.url);
    assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
    assert.equal(url.searchParams.get("redirect_uri"), "https://leeterboard.test/api/auth/oauth/github/callback");
    const row = (await db.client.execute({ sql: "SELECT * FROM oauth_states WHERE id = ?", args: [url.searchParams.get("state")!] })).rows[0] as any;
    assert.equal(row.intent, "link");
    assert.equal(row.user_id, await idOf("alice"));
    assert.equal(res.json.url.includes(row.code_verifier), false);
  });

  it("refuses an unknown provider", async () => {
    const session = await loginPw("alice");
    assert.equal((await call("POST", "/api/account/oauth/facebook/start", session, { currentPassword: PW })).status, 503);
  });
});

describe("connecting", () => {
  it("attaches the identity and stores the provider's verified address when the member has none", async () => {
    const session = await loginPw("alice");
    const res = await connect(session, "github", { id: 5001, email: "Alice@Example.com" }, { password: PW });
    assert.equal(res.location, "/#/account?connected=github");
    assert.deepEqual(await identities("alice"), ["github"]);
    const own = await db.getUserEmail(await idOf("alice"));
    assert.equal(own?.email, "alice@example.com");
    assert.ok(own?.verifiedAt);
    // Signing in with it now works, and it is the same member.
    const again = await loginOAuth("github", { id: 5001, email: "alice@example.com" });
    assert.equal((await api("GET", "/api/auth/session", { cookie: again })).json.user.loginUsername, "alice");
  });

  it("keeps the address a member already has", async () => {
    const session = await loginPw("bob");
    const res = await connect(session, "google", { id: "g-5002", email: "different@example.com" }, { password: PW });
    assert.equal(res.location, "/#/account?connected=google");
    assert.equal((await db.getUserEmail(await idOf("bob")))?.email, "bob-own@example.com");
  });

  it("refuses an identity that belongs to another member, attaching nothing", async () => {
    const session = await loginPw("dora");
    const res = await connect(session, "github", { id: 5001, email: "dora@example.com" }, { password: PW });
    assert.equal(res.location, "/#/account?oauth_error=already_linked");
    assert.deepEqual(await identities("dora"), []);
    assert.equal(await db.getUserEmail(await idOf("dora")), null);
  });

  it("refuses when the provider's address belongs to another member, attaching nothing", async () => {
    const session = await loginPw("erin");
    const res = await connect(session, "github", { id: 5003, email: "Taken@Example.com" }, { password: PW });
    assert.equal(res.location, "/#/account?oauth_error=email_in_use");
    assert.deepEqual(await identities("erin"), []);
    assert.equal(await count("SELECT count(*) AS n FROM oauth_identities WHERE provider_user_id = '5003'"), 0);
  });

  it("does not match by address: the same address on a different provider account attaches to nobody", async () => {
    const session = await loginPw("finn");
    await connect(session, "github", { id: 5004, email: "finn@example.com" }, { password: PW });
    // A stranger signs in with a NEW GitHub account that has finn's address.
    const start = await hit("/api/auth/oauth/github/start");
    const state = new URL(start.location).searchParams.get("state")!;
    const code = fake.issueCode("github", { id: 6666, email: "finn@example.com" });
    const cb = await hit(`/api/auth/oauth/github/callback?code=${code}&state=${state}`, start.pick("oauth_state")!.split(";")[0]);
    assert.equal(cb.location, "/#/login?oauth_error=email_in_use");
    assert.equal(cb.pick("session"), null);
    assert.deepEqual(await identities("finn"), ["github"]);
  });

  it("refuses a second account of the same provider", async () => {
    const session = await loginPw("alice");
    const res = await call("POST", "/api/account/oauth/github/start", session, { currentPassword: PW });
    assert.equal(res.status, 409);
  });

  it("needs the same member to still be signed in at the callback", async () => {
    const alice = await loginPw("gail");
    const bob = await loginPw("bob");
    const before = await count("SELECT count(*) AS n FROM oauth_identities");
    const other = await connect(alice, "google", { id: "g-5005", email: "gail@example.com" }, { password: PW, callbackSession: bob });
    assert.equal(other.location, "/#/account?oauth_error=failed");
    const none = await connect(alice, "google", { id: "g-5006", email: "gail@example.com" }, { password: PW, callbackSession: null });
    assert.equal(none.location, "/#/account?oauth_error=failed");
    assert.equal(await count("SELECT count(*) AS n FROM oauth_identities"), before);
  });

  it("goes to the account page when the member cancels at the provider", async () => {
    const session = await loginPw("gail");
    const start = await call("POST", "/api/account/oauth/github/start", session, { currentPassword: PW });
    const state = new URL(start.json.url).searchParams.get("state")!;
    const res = await hit(`/api/auth/oauth/github/callback?error=access_denied&state=${state}`, `${session}; oauth_state=${state}`);
    assert.equal(res.location, "/#/account?oauth_error=cancelled");
  });

  it("treats re-connecting the same identity as a no-op success", async () => {
    // A link state for alice, but the identity at the provider is alice's own already.
    const alice = await idOf("alice");
    const id = "a".repeat(32);
    await db.createOAuthState({ id, provider: "github", intent: "link", userId: alice, codeVerifier: "v".repeat(43), expiresAt: "2099-01-01T00:00:00.000Z" });
    const session = await loginPw("alice");
    const code = fake.issueCode("github", { id: 5001, email: "alice@example.com" });
    const res = await hit(`/api/auth/oauth/github/callback?code=${code}&state=${id}`, `${session}; oauth_state=${id}`);
    assert.equal(res.location, "/#/account?connected=github");
    assert.deepEqual(await identities("alice"), ["github"]);
  });
});

describe("disconnecting", () => {
  it("needs a session", async () => {
    assert.equal((await call("DELETE", "/api/account/oauth/github", null)).status, 401);
  });

  it("answers 404 for a provider that is not connected or does not exist", async () => {
    const session = await loginPw("carl");
    assert.equal((await call("DELETE", "/api/account/oauth/github", session)).status, 404);
    assert.equal((await call("DELETE", "/api/account/oauth/facebook", session)).status, 404);
  });

  it("lets a member with a password disconnect", async () => {
    const session = await loginPw("alice");
    const res = await call("DELETE", "/api/account/oauth/github", session);
    assert.equal(res.status, 200);
    assert.deepEqual(await identities("alice"), []);
    assert.equal((await db.getUserEmail(await idOf("alice")))?.email, "alice@example.com", "the address stays");
    assert.match(server.logs(), /"event":"oauth_unlinked"/);
  });

  it("refuses to remove the only way to sign in", async () => {
    await db.insertUserWithIdentity(makeUser("solo", { leetcodeLinked: false, leetcodeUsername: "" }), {
      loginUsername: "solo",
      email: "solo@example.com",
      provider: "github",
      providerUserId: "7001"
    });
    const session = await loginOAuth("github", { id: 7001, email: "solo@example.com" });
    const res = await call("DELETE", "/api/account/oauth/github", session);
    assert.equal(res.status, 409);
    assert.deepEqual(await identities("solo"), ["github"]);
  });

  it("allows it once another provider is connected, and then protects the last one", async () => {
    const session = await loginOAuth("github", { id: 7001, email: "solo@example.com" });
    const linked = await connect(session, "google", { id: "g-7002", email: "solo@example.com" });
    assert.equal(linked.location, "/#/account?connected=google");
    assert.equal((await call("DELETE", "/api/account/oauth/github", session)).status, 200);
    assert.equal((await call("DELETE", "/api/account/oauth/google", session)).status, 409);
    assert.deepEqual(await identities("solo"), ["google"]);
  });

  it("two simultaneous disconnects cannot remove both ways in", async () => {
    await db.insertUserWithIdentity(makeUser("twin", { leetcodeLinked: false, leetcodeUsername: "" }), {
      loginUsername: "twin",
      email: "twin@example.com",
      provider: "github",
      providerUserId: "8001"
    });
    await db.addOAuthIdentity(await idOf("twin"), "google", "g-8002");
    const session = await loginOAuth("github", { id: 8001, email: "twin@example.com" });
    const [a, b] = await Promise.all([
      call("DELETE", "/api/account/oauth/github", session),
      call("DELETE", "/api/account/oauth/google", session)
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal((await identities("twin")).length, 1);
  });
});

describe("privacy", () => {
  it("never logs an address, a code or a token", async () => {
    const logs = server.logs();
    for (const needle of ["alice@example.com", "taken@example.com", "solo@example.com", "gh-secret-VALUE", "fake-github-token", "FAKE-PROVIDER"]) {
      assert.equal(logs.includes(needle), false, needle);
    }
    assert.match(logs, /"event":"oauth_linked"/);
  });
});
