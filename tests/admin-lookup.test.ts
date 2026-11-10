/**
 * The admin command line finds members by the name they sign in with, so a
 * member who never linked LeetCode can still be found (and made an admin by id,
 * or have their password set). The old LeetCode name still works as a fallback.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { makeUser } from "./f2-seed.js";

const root = path.resolve(import.meta.dirname, "..");
const PW = "correct-horse-battery-9";

let tmpDir = "";
let dbUrl = "";
let secret = "";
let db: typeof import("../db.js");
const ids = new Map<string, string>();

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

function admin(args: string[], input?: string) {
  const res = spawnSync(process.execPath, ["--import", "tsx", "scripts/admin-account.ts", ...args], {
    cwd: root,
    input,
    encoding: "utf8",
    env: { ...process.env, TURSO_DATABASE_URL: dbUrl, JWT_SECRET: secret, NODE_ENV: "test" }
  });
  return { status: res.status, out: res.stdout, err: res.stderr };
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-adminlookup-"));
  secret = crypto.randomBytes(48).toString("hex");
  dbUrl = `file:${path.join(tmpDir, "test.db")}`;
  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");
  await db.initDb();
  const hash = await hashPassword(PW);

  const add = async (key: string, user: ReturnType<typeof makeUser>, loginUsername?: string) => {
    await db.insertUser(user, hash, loginUsername ? { loginUsername } : {});
    ids.set(key, user.id);
  };
  await add("alice", makeUser("Alice_LC")); // login name = their LeetCode name, lowercased
  await add("zed", makeUser("zed_lc"), "zed"); // signs in as zed, LeetCode account zed_lc
  await add("dave", noLeetCode("Dave"), "dave"); // never linked LeetCode
  await add("x", makeUser("x_lc"), "clash_name"); // login name that is also...
  await add("y", makeUser("clash_name"), "y_login"); // ...another member's LeetCode name
});

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe("findUserForAdmin", () => {
  it("finds a member by login name, in any letter case", async () => {
    const found = await db.findUserForAdmin("  DAVE ");
    assert.equal(found?.record.user.id, ids.get("dave"));
    assert.equal(found?.matchedBy, "login");
    assert.equal(found?.loginUsername, "dave");
    assert.equal(found?.record.user.leetcodeUsername, "");
  });

  it("falls back to the LeetCode username, and says so", async () => {
    const found = await db.findUserForAdmin("ZED_LC");
    assert.equal(found?.record.user.id, ids.get("zed"));
    assert.equal(found?.matchedBy, "leetcode");
    assert.equal(found?.loginUsername, "zed");
  });

  it("prefers the login name when it is also someone else's LeetCode name", async () => {
    const found = await db.findUserForAdmin("clash_name");
    assert.equal(found?.record.user.id, ids.get("x"));
    assert.equal(found?.matchedBy, "login");
  });

  it("finds nobody for an unknown or blank name", async () => {
    assert.equal(await db.findUserForAdmin("nobody_here"), null);
    assert.equal(await db.findUserForAdmin("   "), null);
  });
});

describe("npm run admin", () => {
  it("show-id finds a member who never linked LeetCode, and prints the id for ADMIN_USER_IDS", () => {
    const res = admin(["show-id", "Dave"]);
    assert.equal(res.status, 0, res.err);
    assert.match(res.out, /Matched:\s+dave \(by login username\)/);
    assert.match(res.out, /Login name:\s+dave/);
    assert.match(res.out, /LeetCode:\s+\(not linked\)/);
    assert.ok(res.out.includes(ids.get("dave")!), "prints their internal id");
  });

  it("show-id still finds an older member by LeetCode name, and says it did", () => {
    const res = admin(["show-id", "zed_lc"]);
    assert.equal(res.status, 0, res.err);
    assert.match(res.out, /\(by LeetCode username\)/);
    assert.match(res.out, /Login name:\s+zed/);
    assert.ok(res.out.includes(ids.get("zed")!));
  });

  it("exits with an error for a name nobody has", () => {
    const res = admin(["show-id", "nobody_here"]);
    assert.equal(res.status, 1);
    assert.match(res.err, /No member with the username "nobody_here"/);
  });

  it("set-password works on a member without LeetCode, and rejects a weak password first", async () => {
    const before = (await db.getUserAuthByLoginUsername("dave"))!.auth.passwordHash;

    const tooShort = admin(["set-password", "dave", "--password-stdin"], "short");
    assert.equal(tooShort.status, 1);
    assert.match(tooShort.err, /at least 12 characters/);
    assert.equal((await db.getUserAuthByLoginUsername("dave"))!.auth.passwordHash, before);

    const ok = admin(["set-password", "dave", "--password-stdin"], "a-brand-new-password-42");
    assert.equal(ok.status, 0, ok.err);
    assert.match(ok.out, /Password set for dave\./);
    assert.notEqual((await db.getUserAuthByLoginUsername("dave"))!.auth.passwordHash, before);
  });
});
