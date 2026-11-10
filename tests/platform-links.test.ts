/**
 * Codeforces and CodinGame are optional links, and they belong to the member's
 * id, not to a LeetCode account. These tests run the real flows for members who
 * signed up with a username only and have no LeetCode: link by proving the
 * profile, see the stats, appear on the board and in the trends, hide, unlink,
 * and keep them alongside a LeetCode account that is linked or removed later.
 *
 * Codeforces, CodinGame and LeetCode are faked. The account routes allow 20
 * requests per 15 minutes and verify 20, so the requests here are counted.
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
const TODAY = new Date().toISOString().split("T")[0];

let tmpDir = "";
let dbUrl = "";
let server: TestServer;
let api: ReturnType<typeof client>;
const fake = makeFakeLeetCode();
const ids = new Map<string, string>();
const sessions = new Map<string, string>();

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

const as = (name: string) => sessions.get(name)!;
const post = (name: string, url: string, body?: unknown) => api("POST", url, { cookie: as(name), body });

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

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-platforms-"));
  dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  const db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");
  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");
  const hash = await hashPassword(PW);

  for (const name of ["pl_cf", "pl_other", "pl_cg", "pl_both"]) {
    const user = noLeetCode(name);
    await db.insertUser(user, hash, { loginUsername: name });
    ids.set(name, user.id);
  }
  fake.setAbout("pl_both_lc", "hello");

  server = await startServer({ TURSO_DATABASE_URL: dbUrl, JWT_SECRET: secret, ...fake.env });
  api = client(server);
  for (const name of ["pl_cf", "pl_other", "pl_cg", "pl_both"]) {
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

describe("Codeforces, for a member with no LeetCode account", () => {
  it("links after proving the profile, and the stats show straight away", async () => {
    fake.setPlatformProfile("codeforces", "PlCfHandle", "My school");
    const started = await post("pl_cf", "/api/account/platforms/codeforces/start", { handle: "PlCfHandle" });
    assert.equal(started.status, 200);
    assert.match(started.json.code, /^leeterboard-[0-9a-f]{12}$/);

    fake.setPlatformProfile("codeforces", "PlCfHandle", `My school ${started.json.code}`);
    const res = await post("pl_cf", "/api/account/platforms/codeforces/verify");
    assert.equal(res.status, 201);
    assert.equal(res.json.id, ids.get("pl_cf"));
    assert.equal(res.json.leetcodeLinked, false);

    const cf = res.json.platforms.codeforces;
    assert.equal(cf.handle, "PlCfHandle");
    assert.equal(cf.solved, 3);
    assert.equal(cf.rating, 1250);
    assert.equal(cf.maxRating, 1300);
    assert.equal(cf.rankTitle, "pupil");
    assert.equal(cf.contests, 2);
    assert.equal(cf.hidden, false);
    assert.ok(cf.lastUpdated, "the first sync ran");
  });

  it("is stored under the member's id, with their own stats history", async () => {
    const id = ids.get("pl_cf")!;
    assert.equal(await count("SELECT COUNT(*) AS n FROM platform_accounts WHERE user_id = ? AND platform = 'codeforces'", [id]), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM platform_history WHERE user_id = ? AND platform = 'codeforces' AND date = ?", [id, TODAY]), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM platform_sync_status WHERE user_id = ? AND platform = 'codeforces' AND state = 'ok'", [id]), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM users WHERE id = ? AND leetcode_username IS NULL", [id]), 1, "still no LeetCode");
  });

  it("shows on the board for other members", async () => {
    const board = await api("GET", "/api/users", { cookie: as("pl_other") });
    const me = board.json.users.find((u: { id: string }) => u.id === ids.get("pl_cf"));
    assert.equal(me.leetcodeLinked, false);
    assert.equal(me.platforms.codeforces.handle, "PlCfHandle");
    assert.equal(me.platforms.codeforces.solved, 3);
  });

  it("counts in the Codeforces trends", async () => {
    const trend = await api("GET", "/api/trends?platform=codeforces", { cookie: as("pl_other") });
    assert.equal(trend.status, 200);
    assert.equal(trend.json.totalSolved, 3);
    assert.ok(trend.json.difficultyBreakdown.length > 0);
  });

  it("refuses a second Codeforces account, and a handle someone else has", async () => {
    const again = await post("pl_cf", "/api/account/platforms/codeforces/start", { handle: "SomeoneElse" });
    assert.equal(again.status, 409);
    assert.match(again.json.error, /already linked a Codeforces account/);

    const taken = await post("pl_other", "/api/account/platforms/codeforces/start", { handle: "plcfhandle" });
    assert.equal(taken.status, 409);
    assert.match(taken.json.error, /already linked to a member/);
  });

  it("can be hidden on the profile, and shown again", async () => {
    const seenBy = async (viewer: string) => {
      const board = await api("GET", "/api/users", { cookie: as(viewer) });
      return board.json.users.find((u: { id: string }) => u.id === ids.get("pl_cf")).platforms.codeforces;
    };

    const hidden = await api("PATCH", "/api/account/platforms/codeforces", { cookie: as("pl_cf"), body: { hidden: true } });
    assert.equal(hidden.status, 200);
    assert.equal(hidden.json.platforms.codeforces.hidden, true);

    // Others still get the account (the leaderboard and trends count it) but
    // flagged hidden and without the day-by-day series; the profile page hides it.
    const others = await seenBy("pl_other");
    assert.equal(others.hidden, true);
    assert.equal(others.extra.daily, undefined);
    assert.ok(others.extra.buckets, "what the leaderboard draws is kept");
    assert.ok((await seenBy("pl_cf")).extra.daily, "the owner still gets everything");

    const shown = await api("PATCH", "/api/account/platforms/codeforces", { cookie: as("pl_cf"), body: { hidden: false } });
    assert.equal(shown.json.platforms.codeforces.hidden, false);
    assert.ok((await seenBy("pl_other")).extra.daily, "visible to others again");
  });

  it("can be unlinked, which removes what was stored for it", async () => {
    const id = ids.get("pl_cf")!;
    const res = await api("DELETE", "/api/account/platforms/codeforces", { cookie: as("pl_cf") });
    assert.equal(res.status, 200);
    assert.equal(res.json.platforms.codeforces, undefined);
    assert.equal(await count("SELECT COUNT(*) AS n FROM platform_accounts WHERE user_id = ?", [id]), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM platform_history WHERE user_id = ?", [id]), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM users WHERE id = ?", [id]), 1, "the member stays");

    assert.equal((await api("DELETE", "/api/account/platforms/codeforces", { cookie: as("pl_cf") })).status, 404);
    assert.match(server.logs(), /"event":"platform_unlinked"[^\n]*"platform":"codeforces"/);
  });
});

describe("CodinGame, for a member with no LeetCode account", () => {
  const handle = "PlCgHandle1";

  it("refuses to link until the code is on the profile", async () => {
    fake.setPlatformProfile("codingame", handle, "Hello");
    const started = await post("pl_cg", "/api/account/platforms/codingame/start", { handle });
    assert.equal(started.status, 200);

    const miss = await post("pl_cg", "/api/account/platforms/codingame/verify");
    assert.equal(miss.status, 400);
    assert.match(miss.json.error, /couldn't find the code/i);
    assert.equal(await count("SELECT COUNT(*) AS n FROM platform_accounts WHERE user_id = ?", [ids.get("pl_cg")!]), 0);

    fake.setPlatformProfile("codingame", handle, `Hello ${started.json.code}`);
    const res = await post("pl_cg", "/api/account/platforms/codingame/verify");
    assert.equal(res.status, 201);
    assert.equal(res.json.leetcodeLinked, false);
    const cg = res.json.platforms.codingame;
    assert.equal(cg.handle, handle);
    assert.equal(cg.solved, 5000, "XP");
    assert.equal(cg.rating, 12, "level");
    assert.equal(cg.rankTitle, "Level 12");
  });

  it("is on the board, and the member keeps signing in with their username", async () => {
    const board = await api("GET", "/api/users", { cookie: as("pl_other") });
    const me = board.json.users.find((u: { id: string }) => u.id === ids.get("pl_cg"));
    assert.equal(me.platforms.codingame.handle, handle);
    assert.equal((await api("POST", "/api/auth/login", { body: { username: "pl_cg", password: PW } })).status, 200);
  });
});

describe("alongside LeetCode", () => {
  const handle = "PlBothHandle";

  it("keeps an extra platform when LeetCode is linked, and again when it is removed", async () => {
    fake.setPlatformProfile("codingame", handle, "Hi");
    const started = await post("pl_both", "/api/account/platforms/codingame/start", { handle });
    fake.setPlatformProfile("codingame", handle, `Hi ${started.json.code}`);
    assert.equal((await post("pl_both", "/api/account/platforms/codingame/verify")).status, 201);

    const lc = await post("pl_both", "/api/account/leetcode/start", { leetcodeUsername: "pl_both_lc" });
    assert.equal(lc.status, 200);
    fake.setAbout("pl_both_lc", lc.json.code);
    const linked = await post("pl_both", "/api/account/leetcode/verify");
    assert.equal(linked.status, 201);
    assert.equal(linked.json.leetcodeLinked, true);
    assert.equal(linked.json.platforms.codingame.handle, handle, "the extra platform is still there");

    const removed = await api("DELETE", "/api/account/leetcode", { cookie: as("pl_both") });
    assert.equal(removed.status, 200);
    assert.equal(removed.json.leetcodeLinked, false);
    assert.equal(removed.json.platforms.codingame.handle, handle, "and it survives LeetCode being removed");
    assert.equal(await count("SELECT COUNT(*) AS n FROM platform_accounts WHERE user_id = ?", [ids.get("pl_both")!]), 1);
  });
});
