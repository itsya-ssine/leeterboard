/**
 * Members without a LeetCode account have nothing to fetch from LeetCode and
 * nothing to rank. This runs the real server with LeetCode and CodinGame faked
 * and checks that every path that syncs or compares members treats them
 * correctly: the visit-triggered sync, "sync all", an admin refreshing one
 * member, the admin sync report, the ranking, awards and the winners archive.
 * Their other linked accounts must keep syncing.
 *
 * Refresh routes allow 6 requests a minute, so the requests here are counted.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createClient } from "@libsql/client";
import { client, startServer, type TestServer } from "./helpers.js";
import { makeFakeLeetCode, makeUser } from "./f2-seed.js";

const PW = "correct-horse-battery-9";

let tmpDir = "";
let dbUrl = "";
let server: TestServer;
let api: ReturnType<typeof client>;
const fake = makeFakeLeetCode();
const ids = new Map<string, string>();
const sessions = new Map<string, string>();

const LINKED = ["sy_a", "sy_b", "sy_c", "sy_w"]; // have LeetCode
const UNLINKED = ["sy_u1", "sy_u2", "sy_admin"]; // don't (u1 has a CodinGame account)

const noLeetCode = (name: string) =>
  makeUser(name, {
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

// Each query runs on its own short-lived connection, like a separate process.
const q = async (sql: string, args: unknown[] = []) => {
  const c = createClient({ url: dbUrl });
  try {
    return await c.execute({ sql, args: args as any });
  } finally {
    c.close();
  }
};
const count = async (sql: string, args: unknown[] = []) => Number((await q(sql, args)).rows[0].n);
const idList = (names: string[]) => names.map((n) => ids.get(n)!);
const inList = (names: string[]) => idList(names).map((id) => `'${id}'`).join(",");

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-syncun-"));
  dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  const db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");
  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");
  const hash = await hashPassword(PW);

  for (const name of LINKED) {
    const user = makeUser(name);
    await db.insertUser(user, hash);
    ids.set(name, user.id);
    fake.setAbout(name, "hello");
  }
  fake.setStats("sy_a", { all: 50, easy: 25, medium: 15, hard: 10 });
  fake.setStats("sy_b", { all: 30, easy: 20, medium: 8, hard: 2 });
  fake.setStats("sy_c", { all: 0, easy: 0, medium: 0, hard: 0 }); // linked, nothing solved yet
  fake.setStats("sy_w", { all: 20, easy: 10, medium: 6, hard: 4 });

  // makeUser stamps members as just synced; the visit-triggered sync only
  // refreshes stale ones, so make them stale.
  await db.client.execute({
    sql: `UPDATE users SET last_updated = '2000-01-01T00:00:00.000Z' WHERE id IN (${LINKED.map(() => "?").join(",")})`,
    args: LINKED.map((n) => ids.get(n)!)
  });

  for (const name of UNLINKED) {
    const user = noLeetCode(name);
    await db.insertUser(user, hash, { loginUsername: name });
    ids.set(name, user.id);
  }
  await db.insertPlatformAccount(ids.get("sy_u1")!, "codingame", "SyU1Cg");
  fake.setPlatformProfile("codingame", "SyU1Cg", "hello");

  // A past weekly win by a LeetCode member, and one by someone who has since left.
  await db.setMeta(
    "weeklyWinners",
    JSON.stringify([
      { weekStart: "2026-01-05", userId: ids.get("sy_w"), gained: 12 },
      { weekStart: "2025-12-29", userId: "user-who-left", gained: 9 }
    ])
  );

  server = await startServer({
    TURSO_DATABASE_URL: dbUrl,
    JWT_SECRET: secret,
    ADMIN_USER_IDS: ids.get("sy_admin")!,
    ...fake.env
  });
  api = client(server);
  for (const name of ["sy_a", "sy_admin"]) {
    const res = await api("POST", "/api/auth/login", { body: { username: name, password: PW } });
    assert.equal(res.status, 200, name);
    sessions.set(name, res.cookie!);
  }
});

after(async () => {
  await server?.stop();
  fake.cleanup();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** What must be true after ANY sync pass. */
async function assertUnlinkedUntouched() {
  assert.equal(
    await count(`SELECT COUNT(*) AS n FROM sync_status WHERE user_id IN (${inList(UNLINKED)})`),
    0,
    "no LeetCode sync was attempted, or failed, for them"
  );
  assert.equal(await count(`SELECT COUNT(*) AS n FROM users WHERE id IN (${inList(UNLINKED)}) AND last_updated IS NOT NULL`), 0);
  assert.equal(await count(`SELECT COUNT(*) AS n FROM history WHERE user_id IN (${inList(UNLINKED)})`), 0);
  assert.equal(await count(`SELECT COUNT(*) AS n FROM sync_status WHERE reset_frozen_at IS NOT NULL`), 0, "nothing is frozen");
  // Awards are LeetCode badges: nobody without LeetCode is looked at, so there is nothing to record or announce.
  assert.equal(await count(`SELECT COUNT(*) AS n FROM user_awards WHERE user_id IN (${inList(UNLINKED)})`), 0);
  assert.equal(await count(`SELECT COUNT(*) AS n FROM notifications WHERE user_id IN (${inList(UNLINKED)})`), 0);
}

describe("a visit-triggered sync (sync-if-stale)", () => {
  it("refreshes the members with LeetCode and leaves the others alone", async () => {
    const res = await api("POST", "/api/sync-if-stale", { cookie: sessions.get("sy_a") });
    assert.equal(res.status, 200);
    assert.equal(res.json.synced, true);

    assert.equal(await count(`SELECT COUNT(*) AS n FROM sync_status WHERE user_id IN (${inList(LINKED)}) AND state = 'ok'`), LINKED.length);
    assert.equal(await count("SELECT all_time_solved AS n FROM users WHERE id = ?", [ids.get("sy_a")!]), 50);
    assert.equal(await count("SELECT all_time_solved AS n FROM users WHERE id = ?", [ids.get("sy_w")!]), 20);
    await assertUnlinkedUntouched();
  });

  it("only counts members with LeetCode, and doesn't try to fetch a profile for the others", () => {
    const logs = server.logs();
    assert.match(logs, new RegExp(`Refreshing ${LINKED.length} of ${LINKED.length} LeetCode members \\(${LINKED.length + UNLINKED.length} members in all\\)`));
    assert.doesNotMatch(logs, /\[Sync All\] Skipping/);
  });

  it("still syncs the other accounts a member without LeetCode has linked", async () => {
    const u1 = ids.get("sy_u1")!;
    assert.equal(await count("SELECT COUNT(*) AS n FROM platform_sync_status WHERE user_id = ? AND platform = 'codingame' AND state = 'ok'", [u1]), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM platform_history WHERE user_id = ? AND platform = 'codingame'", [u1]), 1);
  });
});

describe("sync all (admin)", () => {
  it("does the same, and returns everyone, ranked", async () => {
    const res = await api("POST", "/api/refresh-all", { cookie: sessions.get("sy_admin") });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.users.length, LINKED.length + UNLINKED.length);
    await assertUnlinkedUntouched();
  });
});

describe("the ranking", () => {
  it("ranks only members with LeetCode, ahead of everyone else", async () => {
    const board = await api("GET", "/api/users", { cookie: sessions.get("sy_a") });
    const users: Array<{ displayName: string; rank: number; leetcodeLinked: boolean }> = board.json.users;

    const onBoard = users.filter((u) => u.leetcodeLinked);
    assert.deepEqual(onBoard.map((u) => u.rank), [1, 2, 3, 4], "ranks 1..4 with no gaps");
    assert.ok(users.filter((u) => !u.leetcodeLinked).every((u) => u.rank === 0), "no rank for the rest");

    // Everyone with LeetCode comes first, even sy_c who has solved nothing.
    const firstUnranked = users.findIndex((u) => !u.leetcodeLinked);
    assert.equal(firstUnranked, onBoard.length);
    assert.equal(users.find((u) => u.displayName === "sy_c")!.rank >= 1, true);
  });
});

describe("one member refreshed by an admin", () => {
  it("a member without LeetCode: only their other accounts are fetched, and nothing fails", async () => {
    const res = await api("POST", `/api/users/${ids.get("sy_u1")}/refresh`, { cookie: sessions.get("sy_admin") });
    assert.equal(res.status, 200);
    assert.equal(res.json.id, ids.get("sy_u1"));
    assert.equal(res.json.leetcodeLinked, false);
    assert.equal(res.json.platforms.codingame.handle, "SyU1Cg");
    await assertUnlinkedUntouched();
  });

  it("a member with nothing linked at all: a harmless success", async () => {
    const res = await api("POST", `/api/users/${ids.get("sy_u2")}/refresh`, { cookie: sessions.get("sy_admin") });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.platforms, {});
    await assertUnlinkedUntouched();
  });

  it("a member with LeetCode: refreshed as before", async () => {
    const res = await api("POST", `/api/users/${ids.get("sy_b")}/refresh`, { cookie: sessions.get("sy_admin") });
    assert.equal(res.status, 200);
    assert.equal(res.json.leetcodeLinked, true);
    assert.equal(res.json.allTimeSolved, 30);
  });
});

describe("the admin sync report", () => {
  it("lists only the members that are synced from LeetCode", async () => {
    const res = await api("GET", "/api/admin/sync-status", { cookie: sessions.get("sy_admin") });
    assert.equal(res.status, 200);
    const members: Array<{ id: string; leetcodeUsername: string; state: string }> = res.json.members;
    assert.deepEqual(members.map((m) => m.id).sort(), idList(LINKED).sort());
    assert.ok(members.every((m) => m.leetcodeUsername && m.state === "ok"));
  });
});

describe("the weekly winners archive", () => {
  it("keeps a member's win when they unlink LeetCode, and drops wins by people who left", async () => {
    const winnersFor = async () => {
      const board = await api("GET", "/api/users", { cookie: sessions.get("sy_a") });
      return board.json.winners as Array<{ userId: string; weekStart: string }>;
    };

    const before = await winnersFor();
    assert.deepEqual(before.map((w) => w.userId), [ids.get("sy_w")], "the one by someone who left is gone");

    // sy_w removes their LeetCode account: their LeetCode stats go, their past win stays.
    const sw = await api("POST", "/api/auth/login", { body: { username: "sy_w", password: PW } });
    assert.equal((await api("DELETE", "/api/account/leetcode", { cookie: sw.cookie })).status, 200);

    const after = await winnersFor();
    assert.deepEqual(after.map((w) => w.userId), [ids.get("sy_w")], "unlinking isn't leaving");
  });
});
