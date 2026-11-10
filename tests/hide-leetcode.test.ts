/**
 * "Hide my LeetCode stats" is a per-member switch on the profile. Hidden
 * stats still count on the leaderboard (the numbers stay in the board data);
 * the flag tells the profile page to keep them private. Only the member can
 * change it, and only to a real true/false.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { client, startServer, type TestServer } from "./helpers.js";
import { makeUser } from "./f2-seed.js";

const PW = "correct-horse-battery-9";
let tmpDir = "";
let server: TestServer;
let api: ReturnType<typeof client>;
const ids = new Map<string, string>();
const sessions = new Map<string, string>();
const as = (name: string) => sessions.get(name)!;

const seenBy = async (viewer: string, target: string) => {
  const board = await api("GET", "/api/users", { cookie: as(viewer) });
  assert.equal(board.status, 200);
  return board.json.users.find((u: { id: string }) => u.id === ids.get(target));
};
const hide = (name: string, value: unknown) =>
  api("PATCH", "/api/account/profile", { cookie: as(name), body: { hideLeetcodeStats: value } });

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-hidelc-"));
  const dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  const db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");
  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");
  const hash = await hashPassword(PW);
  for (const name of ["hl_owner", "hl_viewer"]) {
    const user = makeUser(name);
    await db.insertUser(user, hash, { loginUsername: name });
    ids.set(name, user.id);
  }
  await db.setMeta("lastSyncAll", new Date().toISOString());

  server = await startServer({ TURSO_DATABASE_URL: dbUrl, JWT_SECRET: secret });
  api = client(server);
  for (const name of ["hl_owner", "hl_viewer"]) {
    const res = await api("POST", "/api/auth/login", { body: { username: name, password: PW } });
    assert.equal(res.status, 200, name);
    sessions.set(name, res.cookie!);
  }
});

after(async () => {
  await server?.stop();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("hiding LeetCode stats", () => {
  it("starts visible", async () => {
    assert.equal((await seenBy("hl_viewer", "hl_owner")).hideLeetcodeStats, false);
  });

  it("is flagged for everyone once the member hides them, while the board numbers stay", async () => {
    const res = await hide("hl_owner", true);
    assert.equal(res.status, 200);
    assert.equal(res.json.hideLeetcodeStats, true);
    for (const viewer of ["hl_viewer", "hl_owner"]) {
      const row = await seenBy(viewer, "hl_owner");
      assert.equal(row.hideLeetcodeStats, true, `seen by ${viewer}`);
      assert.equal(row.leetcodeLinked, true);
      assert.equal(row.allTimeSolved, 100, "still counts on the leaderboard");
    }
  });

  it("leaves other members alone", async () => {
    assert.equal((await seenBy("hl_owner", "hl_viewer")).hideLeetcodeStats, false);
  });

  it("can be shown again", async () => {
    const res = await hide("hl_owner", false);
    assert.equal(res.status, 200);
    assert.equal((await seenBy("hl_viewer", "hl_owner")).hideLeetcodeStats, false);
  });

  it("only takes a real true or false", async () => {
    for (const bad of ["true", 1, null, {}]) {
      const res = await hide("hl_owner", bad);
      assert.equal(res.status, 400, JSON.stringify(bad));
    }
    assert.equal((await seenBy("hl_viewer", "hl_owner")).hideLeetcodeStats, false, "nothing changed");
  });

  it("needs a signed-in member", async () => {
    const res = await api("PATCH", "/api/account/profile", { body: { hideLeetcodeStats: true } });
    assert.equal(res.status, 401);
  });
});
