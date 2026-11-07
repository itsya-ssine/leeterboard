/**
 * The "reset freeze" markers: which accounts must never have their password
 * reset on the strength of a LeetCode username alone, because that username
 * may now belong to someone else (the LeetCode account was renamed or deleted,
 * or has not synced for days).
 *
 * Nothing in the app asks this any more, since signing up and logging in no
 * longer involve a LeetCode proof. The markers and `npm run admin --
 * approve-reset` are kept until a decision is made about how forgotten
 * passwords are reset; this keeps their logic covered in the meantime.
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
