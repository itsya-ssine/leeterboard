/**
 * DB functions for member e-mail addresses (the address a provider verified):
 * storing, uniqueness ignoring case, lookups, and the guarantee that an address
 * never rides along in a member's public payload.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

let tmpDir = "";
let db: typeof import("../db.js");

const count = async (sql: string, args: (string | number)[] = []) =>
  Number((await db.client.execute({ sql, args })).rows[0].n);

const addUser = (id: string, login: string) =>
  db.client.execute({
    sql: `INSERT INTO users (id, display_name, login_username, password_hash) VALUES (?, ?, ?, 'scrypt$x')`,
    args: [id, login, login]
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
  await db.client.execute("DELETE FROM users");
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
