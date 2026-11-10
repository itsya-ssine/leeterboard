/**
 * The "reset freeze" markers: which accounts must never have their password
 * reset on the strength of a LeetCode username alone, because that username
 * may now belong to someone else (the LeetCode account was renamed or deleted,
 * or has not synced for days).
 *
 * "Forgot password" asks this before it will accept a proof, for the specific
 * account being used (LeetCode, Codeforces or CodinGame), and `npm run admin --
 * approve-reset` lifts it. The HTTP side is in password-reset*.test.ts; this
 * covers the marker logic itself.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { makeUser } from "./f2-seed.js";

const DAY = 24 * 3_600_000;
let tmpDir = "";
let db: typeof import("../db.js");
const ids = new Map<string, string>();

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-freeze-"));
  process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
  process.env.TURSO_DATABASE_URL = `file:${path.join(tmpDir, "test.db")}`;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  await db.initDb();

  for (const name of ["healthy", "name_gone", "name_gone_approved", "failing_long", "failing_recent"]) {
    const user = makeUser(name);
    await db.insertUser(user, "hash");
    ids.set(name, user.id);
  }
  const id = (name: string) => ids.get(name)!;

  await db.recordSyncResult(id("healthy"), { ok: true });

  // LeetCode said "no such user", and later the (recycled) name synced fine.
  await db.recordSyncResult(id("name_gone"), { ok: false, state: "not_found", error: "gone" });
  await db.recordSyncResult(id("name_gone"), { ok: true });

  // The same, but an admin looked into it and approved.
  await db.recordSyncResult(id("name_gone_approved"), { ok: false, state: "not_found", error: "gone" });
  await db.recordSyncResult(id("name_gone_approved"), { ok: true });
  await db.approveReset(id("name_gone_approved"));

  // The same markers for a linked Codeforces account.
  for (const name of ["cf_healthy", "cf_gone", "cf_failing_long", "both_frozen"]) {
    const user = makeUser(name);
    await db.insertUser(user, "hash");
    ids.set(name, user.id);
    await db.insertPlatformAccount(user.id, "codeforces", `${name}_handle`);
  }
  await db.recordPlatformSyncResult(id("cf_healthy"), "codeforces", { ok: true });
  await db.recordPlatformSyncResult(id("cf_gone"), "codeforces", { ok: false, state: "not_found", error: "gone" });
  await db.recordPlatformSyncResult(id("cf_gone"), "codeforces", { ok: true });
  await db.recordPlatformSyncResult(id("cf_failing_long"), "codeforces", { ok: false, state: "unavailable", error: "boom" });
  await db.client.execute({
    sql: "UPDATE platform_sync_status SET failing_since = ? WHERE user_id = ? AND platform = 'codeforces'",
    args: [new Date(Date.now() - 8 * DAY).toISOString(), id("cf_failing_long")]
  });
  // Frozen on both LeetCode and Codeforces.
  for (const platform of ["leetcode", "codeforces"] as const) {
    const result = { ok: false as const, state: "not_found" as const, error: "gone" };
    if (platform === "leetcode") await db.recordSyncResult(id("both_frozen"), result);
    else await db.recordPlatformSyncResult(id("both_frozen"), platform, result);
  }

  // Failing (not "not found") for 8 days versus 1 hour.
  for (const [name, ago] of [["failing_long", 8 * DAY], ["failing_recent", 3_600_000]] as const) {
    await db.recordSyncResult(id(name), { ok: false, state: "unavailable", error: "boom" });
    await db.client.execute({
      sql: "UPDATE sync_status SET failing_since = ? WHERE user_id = ?",
      args: [new Date(Date.now() - ago).toISOString(), id(name)]
    });
  }
});

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe("getResetFreeze", () => {
  it("is null for a healthy account", async () => {
    assert.equal(await db.getResetFreeze(ids.get("healthy")!), null);
  });

  it("stays on after a name that stopped resolving 'resolves' again (the marker is sticky)", async () => {
    assert.equal(await db.getResetFreeze(ids.get("name_gone")!), "name_not_found");
  });

  it("freezes an account whose syncs have failed for days, but not one that just started failing", async () => {
    assert.equal(await db.getResetFreeze(ids.get("failing_long")!), "sync_failing");
    assert.equal(await db.getResetFreeze(ids.get("failing_recent")!), null);
  });

  it("is lifted by an admin's approval", async () => {
    assert.equal(await db.getResetFreeze(ids.get("name_gone_approved")!), null);
  });
});

describe("getResetFreeze for a linked Codeforces account", () => {
  it("is null while the handle resolves", async () => {
    assert.equal(await db.getResetFreeze(ids.get("cf_healthy")!, "codeforces"), null);
  });

  it("is sticky once the handle stopped resolving, even after it 'resolves' again", async () => {
    assert.equal(await db.getResetFreeze(ids.get("cf_gone")!, "codeforces"), "name_not_found");
  });

  it("also freezes an account whose syncs have been failing for days", async () => {
    assert.equal(await db.getResetFreeze(ids.get("cf_failing_long")!, "codeforces"), "sync_failing");
  });

  it("is kept apart per platform: one frozen account doesn't freeze another", async () => {
    // Frozen on Codeforces only: LeetCode (and CodinGame) are unaffected.
    assert.equal(await db.getResetFreeze(ids.get("cf_gone")!, "leetcode"), null);
    assert.equal(await db.getResetFreeze(ids.get("cf_gone")!, "codingame"), null);
    // Frozen on LeetCode only: Codeforces is unaffected.
    assert.equal(await db.getResetFreeze(ids.get("name_gone")!, "codeforces"), null);
  });
});

describe("approveReset", () => {
  it("lifts the freeze on every linked account, and says so once", async () => {
    const id = ids.get("both_frozen")!;
    assert.equal(await db.getResetFreeze(id, "leetcode"), "name_not_found");
    assert.equal(await db.getResetFreeze(id, "codeforces"), "name_not_found");

    assert.equal(await db.approveReset(id), true);
    assert.equal(await db.getResetFreeze(id, "leetcode"), null);
    assert.equal(await db.getResetFreeze(id, "codeforces"), null);

    assert.equal(await db.approveReset(id), false, "nothing left to approve");
  });

  it("is enough for a Codeforces-only freeze too", async () => {
    const id = ids.get("cf_gone")!;
    assert.equal(await db.approveReset(id), true);
    assert.equal(await db.getResetFreeze(id, "codeforces"), null);
  });
});
