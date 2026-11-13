/**
 * DB functions for signing in with Google / GitHub (oauth step 4): the one-use
 * state and pending sign-up rows, identities, sign-in method counting and the
 * all-or-nothing creation of a member with its identity.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import type { User } from "../src/types.js";

let tmpDir = "";
let db: typeof import("../db.js");

const PAST = "2020-01-01T00:00:00.000Z";
const NOW = "2026-06-01T12:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";

const count = async (sql: string, args: (string | number)[] = []) =>
  Number((await db.client.execute({ sql, args })).rows[0].n);

const addUser = (id: string, login: string, passwordHash = "scrypt$x") =>
  db.client.execute({
    sql: `INSERT INTO users (id, display_name, login_username, password_hash) VALUES (?, ?, ?, ?)`,
    args: [id, login, login, passwordHash]
  });

const oauthUser = (id: string, login: string): User => ({
  id,
  displayName: login,
  loginUsername: login,
  leetcodeUsername: "",
  leetcodeLinked: false,
  avatarUrl: "",
  school: "",
  bio: "",
  githubUrl: "",
  linkedinUrl: "",
  websiteUrl: "",
  allTimeSolved: 0,
  easySolved: 0,
  mediumSolved: 0,
  hardSolved: 0,
  contestRating: null,
  contestsAttended: 0,
  currentStreak: null,
  longestStreak: null,
  weeklyProgress: 0,
  monthlyProgress: 0,
  rank: 0,
  lastUpdated: null,
  trackingStart: "",
  baselineSolved: 0,
  history: [],
  platforms: []
} as unknown as User);

let seq = 0;
const state = (over: Partial<import("../db.js").OAuthState> = {}) => ({
  id: `state-${++seq}`,
  provider: "github" as const,
  intent: "signin" as const,
  userId: null,
  codeVerifier: "verifier",
  expiresAt: FUTURE,
  ...over
});
const pending = (over: Partial<import("../db.js").PendingOAuthSignup> = {}) => ({
  id: `pending-${++seq}`,
  provider: "github" as const,
  providerUserId: "gh-1",
  email: "New@Example.com",
  displayName: "Newbie",
  expiresAt: FUTURE,
  ...over
});

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-oauth-db-"));
  process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
  process.env.TURSO_DATABASE_URL = `file:${path.join(tmpDir, "test.db")}`;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  await db.initDb();
});

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

beforeEach(async () => {
  await db.client.execute("DELETE FROM oauth_states");
  await db.client.execute("DELETE FROM pending_oauth_signups");
  await db.client.execute("DELETE FROM oauth_identities");
  await db.client.execute("DELETE FROM users");
});

describe("oauth states", () => {
  it("is consumed exactly once", async () => {
    const s = state();
    await db.createOAuthState(s);
    const first = await db.consumeOAuthState(s.id, NOW);
    assert.equal(first?.codeVerifier, "verifier");
    assert.equal(first?.intent, "signin");
    assert.equal(await db.consumeOAuthState(s.id, NOW), null);
  });

  it("only one of several racing consumers wins", async () => {
    const s = state();
    await db.createOAuthState(s);
    const results = await Promise.all(Array.from({ length: 6 }, () => db.consumeOAuthState(s.id, NOW)));
    assert.equal(results.filter(Boolean).length, 1);
  });

  it("refuses an expired state and an unknown id", async () => {
    const s = state({ expiresAt: PAST });
    await db.createOAuthState(s);
    assert.equal(await db.consumeOAuthState(s.id, NOW), null);
    assert.equal(await db.consumeOAuthState("nope", NOW), null);
  });

  it("keeps the member of a link state and requires one", async () => {
    await addUser("u1", "alice");
    const s = state({ intent: "link", userId: "u1", provider: "google" });
    await db.createOAuthState(s);
    const taken = await db.consumeOAuthState(s.id, NOW);
    assert.equal(taken?.userId, "u1");
    assert.equal(taken?.provider, "google");
    await assert.rejects(db.createOAuthState(state({ intent: "link", userId: null })));
    await assert.rejects(db.createOAuthState(state({ intent: "signin", userId: "u1" })));
  });
});

describe("pending sign-ups", () => {
  it("stores the e-mail lowercase and is consumed exactly once", async () => {
    const p = pending();
    await db.createPendingOAuthSignup(p);
    const seen = await db.getPendingOAuthSignup(p.id, NOW);
    assert.equal(seen?.email, "new@example.com");
    assert.equal(seen?.displayName, "Newbie");
    assert.ok(await db.consumePendingOAuthSignup(p.id, NOW));
    assert.equal(await db.consumePendingOAuthSignup(p.id, NOW), null);
    assert.equal(await db.getPendingOAuthSignup(p.id, NOW), null);
  });

  it("only one of several racing consumers wins", async () => {
    const p = pending();
    await db.createPendingOAuthSignup(p);
    const results = await Promise.all(Array.from({ length: 6 }, () => db.consumePendingOAuthSignup(p.id, NOW)));
    assert.equal(results.filter(Boolean).length, 1);
  });

  it("ignores an expired row", async () => {
    const p = pending({ expiresAt: PAST });
    await db.createPendingOAuthSignup(p);
    assert.equal(await db.getPendingOAuthSignup(p.id, NOW), null);
    assert.equal(await db.consumePendingOAuthSignup(p.id, NOW), null);
  });

  it("starting again for the same identity replaces the open row", async () => {
    const first = pending({ providerUserId: "gh-7" });
    const second = pending({ providerUserId: "gh-7", email: "other@example.com" });
    await db.createPendingOAuthSignup(first);
    await db.createPendingOAuthSignup(second);
    assert.equal(await db.getPendingOAuthSignup(first.id, NOW), null);
    assert.equal((await db.getPendingOAuthSignup(second.id, NOW))?.email, "other@example.com");
    assert.equal(await count("SELECT COUNT(*) AS n FROM pending_oauth_signups"), 1);
  });

  it("keeps different identities apart", async () => {
    await db.createPendingOAuthSignup(pending({ providerUserId: "a" }));
    await db.createPendingOAuthSignup(pending({ providerUserId: "a", provider: "google" }));
    await db.createPendingOAuthSignup(pending({ providerUserId: "b" }));
    assert.equal(await count("SELECT COUNT(*) AS n FROM pending_oauth_signups"), 3);
  });
});

describe("identities", () => {
  it("finds a member by provider identity, never by anything else", async () => {
    await addUser("u1", "alice");
    await db.addOAuthIdentity("u1", "github", "gh-1");
    assert.equal(await db.getUserIdByOAuthIdentity("github", "gh-1"), "u1");
    assert.equal(await db.getUserIdByOAuthIdentity("google", "gh-1"), null);
    assert.equal(await db.getUserIdByOAuthIdentity("github", "gh-2"), null);
  });

  it("lists a member's providers in a stable order", async () => {
    await addUser("u1", "alice");
    await db.addOAuthIdentity("u1", "google", "g-1");
    await db.addOAuthIdentity("u1", "github", "gh-1");
    assert.deepEqual(await db.listOAuthProviders("u1"), ["github", "google"]);
    assert.deepEqual(await db.listOAuthProviders("nobody"), []);
  });

  it("refuses an identity that already belongs to a member, with a typed error", async () => {
    await addUser("u1", "alice");
    await addUser("u2", "bob");
    await db.addOAuthIdentity("u1", "github", "gh-1");
    await assert.rejects(db.addOAuthIdentity("u2", "github", "gh-1"), (e: unknown) => {
      assert.ok(e instanceof db.OAuthIdentityConflictError);
      assert.equal(e.reason, "identity_taken");
      return true;
    });
    // The same member connecting the same account again is also "taken".
    await assert.rejects(db.addOAuthIdentity("u1", "github", "gh-1"), (e: unknown) => {
      return e instanceof db.OAuthIdentityConflictError && e.reason === "identity_taken";
    });
    assert.equal(await db.getUserIdByOAuthIdentity("github", "gh-1"), "u1");
  });

  it("allows one account per provider for each member", async () => {
    await addUser("u1", "alice");
    await db.addOAuthIdentity("u1", "github", "gh-1");
    await assert.rejects(db.addOAuthIdentity("u1", "github", "gh-2"), (e: unknown) => {
      return e instanceof db.OAuthIdentityConflictError && e.reason === "provider_already_connected";
    });
    await db.addOAuthIdentity("u1", "google", "g-1");
    assert.equal(await count("SELECT COUNT(*) AS n FROM oauth_identities WHERE user_id = 'u1'"), 2);
  });

  it("removes a connection and reports whether one existed", async () => {
    await addUser("u1", "alice");
    await db.addOAuthIdentity("u1", "github", "gh-1");
    assert.equal(await db.removeOAuthIdentity("u1", "google"), false);
    assert.equal(await db.removeOAuthIdentity("u1", "github"), true);
    assert.equal(await db.removeOAuthIdentity("u1", "github"), false);
    assert.equal(await db.getUserIdByOAuthIdentity("github", "gh-1"), null);
  });
});

describe("countSignInMethods", () => {
  it("counts a password and each connected provider", async () => {
    await addUser("u1", "alice");
    assert.deepEqual(await db.countSignInMethods("u1"), { password: true, providers: [], count: 1 });
    await db.addOAuthIdentity("u1", "github", "gh-1");
    await db.addOAuthIdentity("u1", "google", "g-1");
    assert.deepEqual(await db.countSignInMethods("u1"), {
      password: true,
      providers: ["github", "google"],
      count: 3
    });
  });

  it("does not count an empty or old-format hash as a password", async () => {
    await addUser("u1", "alice", "");
    await addUser("u2", "bob", "legacy-hash");
    assert.equal((await db.countSignInMethods("u1")).password, false);
    assert.equal((await db.countSignInMethods("u1")).count, 0);
    assert.equal((await db.countSignInMethods("u2")).password, false);
    await db.addOAuthIdentity("u1", "github", "gh-1");
    assert.deepEqual(await db.countSignInMethods("u1"), { password: false, providers: ["github"], count: 1 });
  });

  it("is empty for an unknown member", async () => {
    assert.deepEqual(await db.countSignInMethods("nobody"), { password: false, providers: [], count: 0 });
  });
});

describe("deleteExpiredOAuthRows", () => {
  it("removes only expired states and pending sign-ups", async () => {
    await db.createOAuthState(state({ id: "old-state", expiresAt: PAST }));
    await db.createOAuthState(state({ id: "live-state" }));
    await db.createPendingOAuthSignup(pending({ id: "old-pending", providerUserId: "x", expiresAt: PAST }));
    await db.createPendingOAuthSignup(pending({ id: "live-pending", providerUserId: "y" }));
    await db.deleteExpiredOAuthRows(NOW);
    const ids = async (table: string) =>
      (await db.client.execute(`SELECT id FROM ${table}`)).rows.map((r) => r.id);
    assert.deepEqual(await ids("oauth_states"), ["live-state"]);
    assert.deepEqual(await ids("pending_oauth_signups"), ["live-pending"]);
  });
});

describe("insertUserWithIdentity", () => {
  const opts = (over = {}) => ({
    loginUsername: "Newbie",
    email: "New@Example.com",
    provider: "github" as const,
    providerUserId: "gh-1",
    ...over
  });

  it("creates the member and the identity together", async () => {
    await db.insertUserWithIdentity(oauthUser("u1", "Newbie"), opts());
    assert.equal(await db.getUserIdByOAuthIdentity("github", "gh-1"), "u1");
    const row = (await db.client.execute("SELECT * FROM users WHERE id = 'u1'")).rows[0];
    assert.equal(row.login_username, "newbie");
    assert.equal(row.password_hash, "");
    assert.equal(row.leetcode_username, null);
    const stored = await db.getUserEmail("u1");
    assert.equal(stored?.email, "new@example.com");
    assert.ok(stored?.verifiedAt);
    assert.deepEqual(await db.countSignInMethods("u1"), { password: false, providers: ["github"], count: 1 });
  });

  it("leaves neither the member nor the identity when the identity is taken", async () => {
    await addUser("u0", "alice");
    await db.addOAuthIdentity("u0", "github", "gh-1");
    await assert.rejects(db.insertUserWithIdentity(oauthUser("u1", "newbie"), opts()), /UNIQUE/i);
    assert.equal(await count("SELECT COUNT(*) AS n FROM users WHERE id = 'u1'"), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM users"), 1);
    assert.equal(await db.getUserIdByOAuthIdentity("github", "gh-1"), "u0");
  });

  it("leaves nothing when the username or the e-mail is already used", async () => {
    await db.insertUserWithIdentity(oauthUser("u1", "newbie"), opts());
    await assert.rejects(
      db.insertUserWithIdentity(oauthUser("u2", "NEWBIE"), opts({ email: "x@example.com", providerUserId: "gh-2" })),
      /UNIQUE/i
    );
    await assert.rejects(
      db.insertUserWithIdentity(oauthUser("u3", "other"), opts({ loginUsername: "other", providerUserId: "gh-3" })),
      /UNIQUE/i
    );
    assert.equal(await count("SELECT COUNT(*) AS n FROM users"), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM oauth_identities"), 1);
  });

  it("never puts the e-mail in the member mapping", async () => {
    await db.insertUserWithIdentity(oauthUser("u1", "newbie"), opts());
    const all = JSON.stringify(await db.listUsers());
    assert.ok(!all.includes("new@example.com"));
    assert.ok(!/"email"/i.test(all));
  });

  it("removes the identity, e-mail and pending rows when the member is deleted", async () => {
    await db.insertUserWithIdentity(oauthUser("u1", "newbie"), opts());
    await db.createOAuthState(state({ intent: "link", userId: "u1" }));
    assert.equal(await db.deleteUserById("u1"), true);
    assert.equal(await count("SELECT COUNT(*) AS n FROM oauth_identities"), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM oauth_states"), 0);
    assert.equal(await db.getUserEmail("u1"), null);
  });

  // deleteUserById also deletes these rows by hand, because SQLite only enforces
  // foreign keys on connections that turn them on. This checks the schema's own
  // ON DELETE CASCADE, the safety net behind that list, with enforcement on.
  it("is also covered by ON DELETE CASCADE alone", async () => {
    await db.insertUserWithIdentity(oauthUser("u1", "newbie"), opts());
    await db.createOAuthState(state({ intent: "link", userId: "u1", provider: "google" }));
    await db.createOAuthState(state({ id: "someone-elses" })); // a sign-in state belongs to nobody and stays
    const was = (await db.client.execute("PRAGMA foreign_keys")).rows[0].foreign_keys;
    await db.client.execute("PRAGMA foreign_keys = ON");
    try {
      await db.client.execute("DELETE FROM users WHERE id = 'u1'");
    } finally {
      await db.client.execute(`PRAGMA foreign_keys = ${Number(was) === 1 ? "ON" : "OFF"}`);
    }
    assert.equal(await count("SELECT COUNT(*) AS n FROM oauth_identities"), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM oauth_states WHERE user_id = 'u1'"), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM oauth_states WHERE id = 'someone-elses'"), 1);
  });
});

describe("insertUser still works as before", () => {
  it("creates a member with a password and no identity", async () => {
    await db.insertUser(oauthUser("u9", "plain"), "scrypt$hash", { loginUsername: "plain" });
    assert.equal(await count("SELECT COUNT(*) AS n FROM users WHERE id = 'u9'"), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM oauth_identities"), 0);
    assert.equal(await db.getUserEmail("u9"), null);
  });
});
