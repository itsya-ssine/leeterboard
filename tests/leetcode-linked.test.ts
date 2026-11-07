/**
 * "Has LeetCode" is decided by one thing: users.leetcode_username is not NULL.
 *
 * These tests cover the database layer only: how a member with and without a
 * LeetCode account is stored and read back, and that the unique indexes allow
 * any number of members without one. (Who may sign up without LeetCode is a
 * later step.)
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { makeUser } from "./f2-seed.js";

let tmpDir = "";
let db: typeof import("../db.js");

const raw = async (id: string) =>
  (await db.client.execute({ sql: "SELECT leetcode_username, login_username, last_updated FROM users WHERE id = ?", args: [id] })).rows[0];

/** A member who never linked LeetCode: no handle, never synced. */
const noLeetCode = (displayName: string) =>
  makeUser(displayName, {
    leetcodeLinked: false,
    leetcodeUsername: "",
    lastUpdated: null,
    trackingStart: "",
    allTimeSolved: 0,
    easySolved: 0,
    mediumSolved: 0,
    hardSolved: 0,
    weeklyProgress: 0,
    monthlyProgress: 0,
    baselineSolved: 0
  });

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-linked-"));
  process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
  process.env.TURSO_DATABASE_URL = `file:${path.join(tmpDir, "test.db")}`;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  await db.initDb();
});

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe("a member with LeetCode", () => {
  it("is stored with a lowercase login name and reads back as linked", async () => {
    const user = makeUser("Alice_LC");
    await db.insertUser(user, "hash");

    const row = await raw(user.id);
    assert.equal(row.leetcode_username, "Alice_LC");
    assert.equal(row.login_username, "alice_lc");

    const back = await db.getUserById(user.id);
    assert.equal(back?.leetcodeLinked, true);
    assert.equal(back?.leetcodeUsername, "Alice_LC");
    assert.equal(typeof back?.lastUpdated, "string");
  });
});

describe("a member without LeetCode", () => {
  it("is stored as NULL, not as an empty string, and reads back as not linked", async () => {
    const user = noLeetCode("Dave");
    await db.insertUser(user, "hash", { loginUsername: "Dave" });

    const row = await raw(user.id);
    assert.equal(row.leetcode_username, null);
    assert.equal(row.last_updated, null);
    assert.equal(row.login_username, "dave");

    const back = await db.getUserById(user.id);
    assert.equal(back?.leetcodeLinked, false);
    assert.equal(back?.leetcodeUsername, "");
    assert.equal(back?.lastUpdated, null);
    // Not the text "null", which is what slicing a missing date used to give.
    assert.equal(back?.trackingStart, "");
  });

  it("can be any number of members, because NULLs don't collide", async () => {
    await db.insertUser(noLeetCode("Erin"), "hash", { loginUsername: "erin" });
    await db.insertUser(noLeetCode("Frank"), "hash", { loginUsername: "frank" });
    const users = await db.listUsers();
    assert.equal(users.filter((u) => !u.leetcodeLinked).length, 3);
  });

  it("needs a login name, since there is no LeetCode name to fall back on", async () => {
    await assert.rejects(db.insertUser(noLeetCode("Nobody"), "hash"), /needs a loginUsername/);
  });

  it("still can't reuse someone's login name, in any letter case", async () => {
    await assert.rejects(db.insertUser(noLeetCode("Dave Two"), "hash", { loginUsername: "DAVE" }), /UNIQUE/);
    // ...including a name that already belongs to a LeetCode member.
    await assert.rejects(db.insertUser(noLeetCode("Alias"), "hash", { loginUsername: "alice_lc" }), /UNIQUE/);
  });

  it("can't take a LeetCode handle that is already linked", async () => {
    await assert.rejects(
      db.insertUser(makeUser("ALICE_LC", { id: `user-${crypto.randomUUID()}` }), "hash", { loginUsername: "someone_else" }),
      /UNIQUE/
    );
  });
});

describe("the helpers", () => {
  it("leetcodeLinkedUsers keeps only members with LeetCode, in order", async () => {
    const users = await db.listUsers();
    const linked = db.leetcodeLinkedUsers(users);
    assert.deepEqual(linked.map((u) => u.leetcodeUsername), ["Alice_LC"]);
    assert.ok(linked.every(db.isLeetcodeLinked));
    assert.ok(users.length > linked.length, "listUsers still returns everyone");
  });
});
