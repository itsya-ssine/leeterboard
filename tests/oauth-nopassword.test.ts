/**
 * Members without a password (oauth step 9): the ones created through Google or
 * GitHub. They can't be locked out, have nothing to change a password on, and
 * confirm "delete my account" by typing their username (D4). Members with a
 * password keep the password check. Real server, fake provider.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { client, startServer, type TestServer } from "./helpers.js";
import { makeFakeOAuth, makeUser, mergeEnv } from "./f2-seed.js";

const PW = "correct-horse-battery-9";
const fake = makeFakeOAuth();

let tmpDir = "";
let secret = "";
let server: TestServer;
let api: ReturnType<typeof client>;
let db: typeof import("../db.js");

let nextIp = 1;
let ip = "10.3.0.1";
beforeEach(() => {
  ip = `10.3.0.${nextIp++}`;
});

const count = async (sql: string, args: (string | number)[] = []) =>
  Number((await db.client.execute({ sql, args })).rows[0].n);
const idOf = async (login: string) => (await db.getUserAuthByLoginUsername(login))?.user.id ?? null;

async function hit(route: string, cookie?: string) {
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(server.url + route, { redirect: "manual", headers });
  const setCookies = res.headers.getSetCookie();
  const pick = (name: string) =>
    setCookies.find((c) => c.startsWith(`${name}=`) || c.startsWith(`__Host-${name}=`) || c.startsWith(`__Secure-${name}=`)) ?? null;
  return { status: res.status, location: res.headers.get("location") ?? "", pick };
}

const call = (method: string, route: string, cookie: string | null, body?: unknown, from = ip) =>
  api(method, route, { cookie, body, headers: { "x-forwarded-for": from } });

type Profile = { id: string | number; email: string };

// start -> the provider approves -> callback. Returns the callback's answer.
async function approve(provider: "github" | "google", profile: Profile) {
  const start = await hit(`/api/auth/oauth/${provider}/start`);
  const state = new URL(start.location).searchParams.get("state")!;
  const code = fake.issueCode(provider, profile);
  const cb = await hit(`/api/auth/oauth/${provider}/callback?code=${code}&state=${state}`, start.pick("oauth_state")!.split(";")[0]);
  const signup = cb.pick("oauth_signup");
  const session = cb.pick("session");
  return { ...cb, signupCookie: signup ? signup.split(";")[0] : null, sessionCookie: session ? session.split(";")[0] : null };
}

// A real new member: provider step, then the username step. No password is ever set.
async function signUp(provider: "github" | "google", profile: Profile, username: string): Promise<string> {
  const step = await approve(provider, profile);
  assert.equal(step.location, "/#/signup/username");
  const done = await call("POST", "/api/auth/oauth/complete", step.signupCookie, { username });
  assert.equal(done.status, 201, done.text);
  return done.cookie!;
}

const loginPw = async (username: string) => {
  const res = await call("POST", "/api/auth/login", null, { username, password: PW });
  assert.equal(res.status, 200, res.text);
  return res.cookie!;
};

const deleteAccount = (cookie: string | null, body: unknown) => call("POST", "/api/account/delete", cookie, body);

before(async () => {
  secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-oauth-nopw-"));
  const dbUrl = `file:${path.join(tmpDir, "test.db")}`;
  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");
  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");
  // Written before the server starts, so no test writes to the file while the server uses it.
  await db.insertUser(makeUser("withpw"), await hashPassword(PW));
  // An admin (ADMIN_LEETCODE_USERNAMES is test_admin) that somehow has no password.
  await db.insertUser(makeUser("test_admin"), "");

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

describe("signing in as a member without a password", () => {
  it("is refused with an empty password, and with any password", async () => {
    await signUp("github", { id: 7001, email: "nopw1@example.com" }, "nopw_one");
    const empty = await call("POST", "/api/auth/login", null, { username: "nopw_one", password: "" });
    assert.equal(empty.status, 400);
    assert.equal(empty.cookie, null);
    for (const password of [PW, "x".repeat(20), "scrypt$abc", " "]) {
      const res = await call("POST", "/api/auth/login", null, { username: "nopw_one", password });
      assert.equal(res.status, 401, password);
      assert.equal(res.json.needsPassword, true);
      assert.equal(res.cookie, null, "no session may come out of a password login");
    }
  });

  it("is never locked out by wrong passwords, and the provider still signs them in", async () => {
    await signUp("github", { id: 7002, email: "nopw2@example.com" }, "nopw_two");
    // More attempts than the lockout threshold, each from its own address so the per-IP limiter stays out of it.
    for (let i = 0; i < 8; i++) {
      const res = await call("POST", "/api/auth/login", null, { username: "nopw_two", password: `wrong-guess-${i}-x` }, `10.9.${nextIp}.${i + 1}`);
      assert.equal(res.status, 401);
    }
    const row = (await db.client.execute("SELECT failed_logins, locked_until FROM users WHERE login_username = 'nopw_two'")).rows[0] as any;
    assert.equal(Number(row.failed_logins ?? 0), 0, "nothing is counted against an account that has no password");
    assert.equal(row.locked_until ?? null, null);

    const back = await approve("github", { id: 7002, email: "nopw2@example.com" });
    assert.equal(back.location, "/#/");
    assert.ok(back.sessionCookie, "the provider still signs them in");
    const me = await call("GET", "/api/auth/session", back.sessionCookie);
    assert.equal(me.json.status, "authenticated");
    assert.deepEqual(me.json.user.signInMethods, { password: false, providers: ["github"] });
  });
});

describe("changing a password that doesn't exist", () => {
  it("answers 409 no_password, records no failed attempt and keeps the session", async () => {
    const session = await signUp("google", { id: "g-7003", email: "nopw3@example.com" }, "nopw_three");
    for (const body of [{}, { currentPassword: "", newPassword: "brand-new-pass-77" }, { currentPassword: PW, newPassword: "brand-new-pass-77" }]) {
      const res = await call("POST", "/api/account/password", session, body);
      assert.equal(res.status, 409, JSON.stringify(body));
      assert.equal(res.json.code, "no_password");
      assert.equal(res.json.error, "This account doesn't use a password.");
    }
    const row = (await db.client.execute("SELECT failed_logins, locked_until, password_hash FROM users WHERE login_username = 'nopw_three'")).rows[0] as any;
    assert.equal(Number(row.failed_logins ?? 0), 0);
    assert.equal(row.locked_until ?? null, null);
    assert.equal(row.password_hash, "", "no password was set by the attempts");
    assert.equal((await call("GET", "/api/auth/session", session)).json.status, "authenticated");
    assert.equal(server.logs().includes('"action":"password_change"'), false, "no reauth_failed for them");
  });
});

describe("deleting an account without a password (D4)", () => {
  it("needs their own username, and refuses everything else without deleting", async () => {
    const session = await signUp("github", { id: 7004, email: "nopw4@example.com" }, "Nopw_Four");
    const wrongName = "That isn't your username. Check the spelling and try again.";
    const refused: [unknown, string][] = [
      [{}, "Type your username to confirm."],
      [{ confirmUsername: "" }, "Type your username to confirm."],
      [{ confirmUsername: 42 }, "Type your username to confirm."],
      [{ password: PW }, "Type your username to confirm."], // a password is not what this account confirms with
      [{ confirmUsername: "someone_else" }, wrongName],
      [{ confirmUsername: "nopw_fou" }, wrongName],
      [{ confirmUsername: "nopw_four2" }, wrongName],
      [{ confirmUsername: "nopw four" }, wrongName]
    ];
    for (const [body, error] of refused) {
      const res = await deleteAccount(session, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.json.error, error);
      assert.equal(res.json.code, undefined, "a wrong confirmation must not end the session");
    }
    assert.ok(await idOf("nopw_four"), "still there");
    assert.equal((await call("GET", "/api/auth/session", session)).json.status, "authenticated");
    assert.equal(server.logs().includes('"event":"account_deleted"'), false);
  });

  it("takes the name in the case and with the spaces the member typed it", async () => {
    const session = await signUp("github", { id: 7006, email: "nopw6@example.com" }, "Nopw_Six");
    const res = await deleteAccount(session, { confirmUsername: "  NOPW_six " });
    assert.equal(res.status, 200, res.text);
    assert.equal(await idOf("nopw_six"), null);
  });

  it("needs a session", async () => {
    const res = await deleteAccount(null, { confirmUsername: "whoever" });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, "session_required");
  });

  it("deletes the member, the identity, the e-mail and the pending rows, and ends the session", async () => {
    const session = await signUp("github", { id: 7005, email: "Nopw5@Example.com" }, "nopw_five");
    const id = (await idOf("nopw_five"))!;
    // A connection in flight leaves a state row tied to the member.
    const start = await call("POST", "/api/account/oauth/google/start", session, {});
    assert.equal(start.status, 200, start.text);
    assert.equal(await count("SELECT COUNT(*) AS n FROM oauth_states WHERE user_id = ?", [id]), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM oauth_identities WHERE user_id = ?", [id]), 1);
    assert.equal((await db.getUserEmail(id))?.email, "nopw5@example.com");

    const res = await deleteAccount(session, { confirmUsername: "nopw_five" });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.json, { success: true });
    assert.match(res.headers.get("set-cookie") ?? "", /session=;/);

    assert.equal(await idOf("nopw_five"), null);
    assert.equal(await count("SELECT COUNT(*) AS n FROM oauth_identities WHERE user_id = ?", [id]), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM oauth_states WHERE user_id = ?", [id]), 0);
    assert.equal(await db.getUserEmail(id), null);
    assert.equal(await count("SELECT COUNT(*) AS n FROM users WHERE lower(email) = 'nopw5@example.com'"), 0);
    assert.equal((await call("GET", "/api/auth/session", session)).json.status, "guest", "the old cookie is dead");

    const logs = server.logs();
    assert.match(logs, /"event":"account_deleted"[^\n]*"confirmedWith":"username"/);
    assert.equal(logs.includes("nopw5@example.com"), false);
  });

  it("frees the provider account and the address, so they can sign up again", async () => {
    const again = await approve("github", { id: 7005, email: "nopw5@example.com" });
    assert.equal(again.location, "/#/signup/username", "not email_in_use, not a known identity");
    assert.equal(again.sessionCookie, null);
  });
});

describe("deleting an account that has a password", () => {
  it("still needs the password, and a typed username does not replace it", async () => {
    const session = await loginPw("withpw");
    const byName = await deleteAccount(session, { confirmUsername: "withpw" });
    assert.equal(byName.status, 400);
    assert.equal(byName.json.error, "Enter your current password.");
    assert.ok(await idOf("withpw"), "still there");

    const wrong = await deleteAccount(session, { password: "not-the-password-1", confirmUsername: "withpw" });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.json.code, undefined);
    assert.match(server.logs(), /"event":"reauth_failed"[^\n]*"action":"account_delete"/);
    assert.ok(await idOf("withpw"), "still there");

    const ok = await deleteAccount(session, { password: PW });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(await idOf("withpw"), null);
    assert.match(server.logs(), /"event":"account_deleted"[^\n]*"username":"withpw"[^\n]*"confirmedWith":"password"/);
  });
});

describe("an admin account without a password", () => {
  it("can't be deleted by typing the username", async () => {
    const id = (await idOf("test_admin"))!;
    // The old token shape: no password stamp, accepted only while the account has no password.
    const token = jwt.sign({ id, loginUsername: "test_admin" }, secret, { algorithm: "HS256", expiresIn: "7d" });
    const session = `session=${token}`;
    assert.equal((await call("GET", "/api/auth/session", session)).json.user?.isAdmin, true);

    const res = await deleteAccount(session, { confirmUsername: "test_admin" });
    assert.equal(res.status, 403);
    assert.equal(res.json.code, "no_password");
    assert.ok(await idOf("test_admin"), "still there");
  });
});
