/**
 * DB functions for e-mail addresses and verification codes (email sign-up
 * step 3): the pending code lifecycle, atomic single-use consumption, attempt
 * counting, and the guarantee that an address never rides along in a member's
 * public payload.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

let tmpDir = "";
let db: typeof import("../db.js");

const PAST = "2020-01-01T00:00:00.000Z";
const NOW = "2026-06-01T12:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";

const count = async (sql: string, args: (string | number)[] = []) =>
  Number((await db.client.execute({ sql, args })).rows[0].n);

const addUser = (id: string, login: string) =>
  db.client.execute({
    sql: `INSERT INTO users (id, display_name, login_username, password_hash) VALUES (?, ?, ?, 'scrypt$x')`,
    args: [id, login, login]
  });

let seq = 0;
const code = (over: Partial<Omit<import("../db.js").PendingEmailCode, "attempts">> = {}) => ({
  id: `pending-${++seq}`,
  purpose: "signup" as const,
  email: "new@example.com",
  userId: null,
  username: "newbie",
  displayName: "Newbie",
  passwordHash: "scrypt$hash",
  codeHash: "hmac-hex",
  createdAt: NOW,
  lastSentAt: NOW,
  expiresAt: FUTURE,
  ...over
});

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-email-db-"));
  process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
  process.env.TURSO_DATABASE_URL = `file:${path.join(tmpDir, "test.db")}`;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  await db.initDb();
});

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

beforeEach(async () => {
  await db.client.execute("DELETE FROM pending_email_codes");
  await db.client.execute("DELETE FROM users");
});

describe("pending e-mail codes", () => {
  it("stores a sign-up and reads it back with attempts at zero", async () => {
    const c = code();
    await db.createPendingEmailCode(c);
    assert.deepEqual(await db.getPendingEmailCode(c.id), { ...c, attempts: 0 });
  });

  it("stores the member and no sign-up fields for add-e-mail and reset", async () => {
    await addUser("u1", "alice");
    const c = code({ purpose: "add_email", userId: "u1", username: null, displayName: null, passwordHash: null });
    await db.createPendingEmailCode(c);
    const got = await db.getPendingEmailCode(c.id);
    assert.equal(got?.userId, "u1");
    assert.equal(got?.username, null);
    assert.equal(got?.passwordHash, null);
  });

  it("returns null for an unknown id", async () => {
    assert.equal(await db.getPendingEmailCode("nope"), null);
    assert.equal(await db.bumpPendingEmailAttempts("nope"), null);
    assert.equal(await db.consumePendingEmailCode("nope", NOW), null);
  });

  it("lowercases the address it stores and looks up", async () => {
    const c = code({ email: "Mixed.Case@Example.COM" });
    await db.createPendingEmailCode(c);
    assert.equal((await db.getPendingEmailCode(c.id))?.email, "mixed.case@example.com");
    assert.equal((await db.getOpenPendingEmailCode("signup", "MIXED.case@example.com"))?.id, c.id);
  });

  it("replaces the open request for the same purpose and address: old id gone, attempts back to zero", async () => {
    const first = code();
    await db.createPendingEmailCode(first);
    await db.bumpPendingEmailAttempts(first.id);
    await db.bumpPendingEmailAttempts(first.id);

    const second = code({ codeHash: "another-hmac", lastSentAt: "2026-06-01T12:05:00.000Z" });
    await db.createPendingEmailCode(second);

    assert.equal(await db.getPendingEmailCode(first.id), null);
    assert.deepEqual(await db.getPendingEmailCode(second.id), { ...second, attempts: 0 });
    assert.equal(await count("SELECT COUNT(*) AS n FROM pending_email_codes"), 1);
    assert.equal((await db.getOpenPendingEmailCode("signup", "new@example.com"))?.id, second.id);
  });

  it("keeps requests for another purpose or another address side by side", async () => {
    await addUser("u1", "alice");
    await db.createPendingEmailCode(code());
    await db.createPendingEmailCode(code({ purpose: "reset", userId: "u1", username: null, displayName: null }));
    await db.createPendingEmailCode(code({ email: "other@example.com" }));
    assert.equal(await count("SELECT COUNT(*) AS n FROM pending_email_codes"), 3);
  });

  it("finds no open request when there is none", async () => {
    assert.equal(await db.getOpenPendingEmailCode("signup", "nobody@example.com"), null);
  });

  it("counts wrong guesses and returns the running total", async () => {
    const c = code();
    await db.createPendingEmailCode(c);
    assert.equal(await db.bumpPendingEmailAttempts(c.id), 1);
    assert.equal(await db.bumpPendingEmailAttempts(c.id), 2);
    assert.equal((await db.getPendingEmailCode(c.id))?.attempts, 2);
  });

  it("gives every parallel wrong guess its own count, so none can slip past a limit", async () => {
    const c = code();
    await db.createPendingEmailCode(c);
    const totals = await Promise.all(Array.from({ length: 12 }, () => db.bumpPendingEmailAttempts(c.id)));
    assert.deepEqual([...totals].sort((a, b) => Number(a) - Number(b)), Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("deletes a request", async () => {
    const c = code();
    await db.createPendingEmailCode(c);
    await db.deletePendingEmailCode(c.id);
    assert.equal(await db.getPendingEmailCode(c.id), null);
  });
});

describe("consumePendingEmailCode", () => {
  it("hands back the whole row once, then never again", async () => {
    const c = code();
    await db.createPendingEmailCode(c);
    assert.deepEqual(await db.consumePendingEmailCode(c.id, NOW), { ...c, attempts: 0 });
    assert.equal(await db.consumePendingEmailCode(c.id, NOW), null);
    assert.equal(await db.getPendingEmailCode(c.id), null);
  });

  it("lets exactly one of many simultaneous verifications win", async () => {
    const c = code();
    await db.createPendingEmailCode(c);
    const results = await Promise.all(Array.from({ length: 10 }, () => db.consumePendingEmailCode(c.id, NOW)));
    assert.equal(results.filter((r) => r !== null).length, 1);
  });

  it("does not hand out an expired request, and leaves it for the purge", async () => {
    const c = code({ expiresAt: PAST });
    await db.createPendingEmailCode(c);
    assert.equal(await db.consumePendingEmailCode(c.id, NOW), null);
    assert.equal(await count("SELECT COUNT(*) AS n FROM pending_email_codes WHERE id = ?", [c.id]), 1);
  });

  it("is not tied to the clock of the database: the caller's time decides", async () => {
    const c = code({ expiresAt: "2026-06-01T12:10:00.000Z" });
    await db.createPendingEmailCode(c);
    assert.equal(await db.consumePendingEmailCode(c.id, "2026-06-01T12:10:00.000Z"), null); // exactly at expiry: gone
    assert.ok(await db.consumePendingEmailCode(c.id, "2026-06-01T12:09:59.999Z"));
  });
});

describe("deleteExpiredPendingEmailCodes", () => {
  it("removes only the expired ones", async () => {
    const old = code({ email: "old@example.com", expiresAt: PAST });
    const fresh = code({ email: "fresh@example.com" });
    await db.createPendingEmailCode(old);
    await db.createPendingEmailCode(fresh);
    await db.deleteExpiredPendingEmailCodes(NOW);
    assert.equal(await db.getPendingEmailCode(old.id), null);
    assert.ok(await db.getPendingEmailCode(fresh.id));
  });
});

describe("member e-mail addresses", () => {
  it("setUserEmail stores the address lowercase, with a verification time", async () => {
    await addUser("u1", "alice");
    const before = Date.now();
    assert.equal(await db.setUserEmail("u1", "  Alice@Example.COM "), true);
    const got = await db.getUserEmail("u1");
    assert.equal(got?.email, "alice@example.com");
    const stamp = Date.parse(String(got?.verifiedAt));
    assert.ok(stamp >= before - 1 && stamp <= Date.now() + 1);
  });

  it("getUserEmail is null for a member with none, and for nobody", async () => {
    await addUser("u1", "alice");
    assert.equal(await db.getUserEmail("u1"), null);
    assert.equal(await db.getUserEmail("ghost"), null);
  });

  it("setUserEmail changes an existing address", async () => {
    await addUser("u1", "alice");
    await db.setUserEmail("u1", "one@example.com");
    assert.equal(await db.setUserEmail("u1", "two@example.com"), true);
    assert.equal((await db.getUserEmail("u1"))?.email, "two@example.com");
    assert.equal(await db.getUserByEmail("one@example.com"), null);
  });

  it("setUserEmail refuses an address another member has, whatever its letter case", async () => {
    await addUser("u1", "alice");
    await addUser("u2", "bob");
    assert.equal(await db.setUserEmail("u1", "shared@example.com"), true);
    assert.equal(await db.setUserEmail("u2", "SHARED@example.com"), false);
    assert.equal(await db.getUserEmail("u2"), null);
    assert.equal((await db.getUserEmail("u1"))?.email, "shared@example.com");
  });

  it("when two members race for one address, exactly one gets it", async () => {
    await addUser("u1", "alice");
    await addUser("u2", "bob");
    const results = await Promise.all([db.setUserEmail("u1", "race@example.com"), db.setUserEmail("u2", "race@example.com")]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM users WHERE email = 'race@example.com'"), 1);
  });

  it("setUserEmail is false for a member that doesn't exist", async () => {
    assert.equal(await db.setUserEmail("ghost", "x@example.com"), false);
  });

  it("emailTaken ignores letter case and can leave one member out", async () => {
    await addUser("u1", "alice");
    await addUser("u2", "bob");
    await db.setUserEmail("u1", "alice@example.com");
    assert.equal(await db.emailTaken("ALICE@example.com"), true);
    assert.equal(await db.emailTaken("alice@example.com", "u2"), true);
    assert.equal(await db.emailTaken("alice@example.com", "u1"), false); // their own
    assert.equal(await db.emailTaken("free@example.com"), false);
  });

  it("getUserByEmail finds the member whatever the letter case, with the verification time", async () => {
    await addUser("u1", "alice");
    await addUser("u2", "bob"); // no e-mail: must never match
    await db.setUserEmail("u1", "alice@example.com");
    const found = await db.getUserByEmail("Alice@Example.com");
    assert.equal(found?.record.user.id, "u1");
    assert.equal(found?.record.user.loginUsername, "alice");
    assert.ok(found?.emailVerifiedAt);
    assert.equal(await db.getUserByEmail("nobody@example.com"), null);
    assert.equal(await db.getUserByEmail(""), null);
  });
});

describe("an address never rides along in a member's payload", () => {
  const ADDRESS = "very.private@example.com";

  // Every key anywhere in the value, and every string in it.
  function walk(value: unknown, keys: string[] = [], strings: string[] = []) {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach((v) => walk(v, keys, strings));
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        keys.push(k);
        walk(v, keys, strings);
      }
    }
    return { keys, strings };
  }

  it("is absent from listUsers, getUserById and the auth lookups", async () => {
    await addUser("u1", "alice");
    await addUser("u2", "bob");
    await db.setUserEmail("u1", ADDRESS);

    const payloads: unknown[] = [
      await db.listUsers(),
      await db.getUserById("u1"),
      (await db.getUserAuthById("u1"))?.user,
      (await db.getUserAuthByLoginUsername("alice"))?.user,
      (await db.getUserByEmail(ADDRESS))?.record.user
    ];
    for (const payload of payloads) {
      assert.ok(payload);
      const { keys, strings } = walk(payload);
      assert.deepEqual(keys.filter((k) => /e-?mail/i.test(k)), [], "no e-mail key");
      assert.equal(JSON.stringify(payload).includes(ADDRESS), false, "no address string");
      assert.equal(strings.some((s) => s.toLowerCase().includes("private@")), false);
    }
  });
});
