/**
 * LeetCode is optional: a member signs up with a username and password and can
 * link a LeetCode account afterwards, by putting a one-time code in its profile
 * Summary, or remove it again.
 *
 * Runs the real server with LeetCode faked. The account routes allow 20
 * requests per 15 minutes and verify 20, so the requests here are counted.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
let secret = "";
let server: TestServer;
let api: ReturnType<typeof client>;
let db: typeof import("../db.js");
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
const start = (name: string, leetcodeUsername: unknown) =>
  api("POST", "/api/account/leetcode/start", { cookie: as(name), body: { leetcodeUsername } });
const verify = (name: string) => api("POST", "/api/account/leetcode/verify", { cookie: as(name) });
// Each query runs on its own short-lived connection, like a separate process
// would: a long-lived one can keep reading an old snapshot while the server writes.
const q = async (sql: string, args: unknown[] = []) => {
  const c = createClient({ url: dbUrl });
  try {
    return await c.execute({ sql, args: args as any });
  } finally {
    c.close();
  }
};
const count = async (sql: string, args: unknown[] = []) => Number((await q(sql, args)).rows[0].n);

// What the periodic sync does after fresh stats arrive: compare everyone's
// badges with what is already known and notify of anything new. Run in its own
// process so it sees exactly what the server wrote.
function nextSync() {
  const res = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `const { listUsers } = await import("./db.ts");
       const { notifyNewAwards } = await import("./notifications.ts");
       await notifyNewAwards(await listUsers(), []);`
    ],
    {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: { ...process.env, TURSO_DATABASE_URL: dbUrl, JWT_SECRET: secret, NODE_ENV: "test" },
      encoding: "utf8"
    }
  );
  assert.equal(res.status, 0, res.stderr);
}

before(async () => {
  secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-lclink-"));
  dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");
  const { notifyNewAwards } = await import("../notifications.js");
  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");
  const hash = await hashPassword(PW);

  for (const name of ["ln_plain", "ln_other", "ln_race_a", "ln_race_b"]) {
    const user = noLeetCode(name);
    await db.insertUser(user, hash, { loginUsername: name });
    ids.set(name, user.id);
  }
  // A member who already has LeetCode, and a Codeforces account that must survive an unlink.
  const has = makeUser("ln_has_lc");
  await db.insertUser(has, hash, { loginUsername: "ln_has" });
  ids.set("ln_has", has.id);
  await db.insertPlatformAccount(has.id, "codeforces", "HasCfHandle");

  // A sync has already looked at everyone (with no LeetCode stats for the
  // unlinked members), so linking later must not make their first badges news.
  await notifyNewAwards(await db.listUsers(), []);

  for (const handle of ["ln_plain_lc", "ln_has_lc", "ln_race_lc", "ln_free_lc"]) fake.setAbout(handle, "hello");

  server = await startServer({ TURSO_DATABASE_URL: dbUrl, JWT_SECRET: secret, ...fake.env });
  api = client(server);
  for (const name of ["ln_plain", "ln_other", "ln_race_a", "ln_race_b", "ln_has"]) {
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

describe("starting to link", () => {
  it("needs a signed-in member", async () => {
    const res = await api("POST", "/api/account/leetcode/start", { body: { leetcodeUsername: "ln_plain_lc" } });
    assert.equal(res.status, 401);
  });

  it("refuses a name that isn't a LeetCode username", async () => {
    const res = await start("ln_plain", "has space");
    assert.equal(res.status, 400);
    assert.match(res.json.error, /valid LeetCode username/);
  });

  it("refuses a LeetCode account that doesn't exist", async () => {
    const res = await start("ln_plain", "nobody_here_xyz");
    assert.equal(res.status, 404);
  });

  it("refuses a LeetCode account another member already has, in any letter case", async () => {
    const res = await start("ln_other", "LN_HAS_LC");
    assert.equal(res.status, 409);
    assert.match(res.json.error, /already linked to another member/);
    assert.equal(await count("SELECT COUNT(*) AS n FROM pending_links WHERE platform = 'leetcode'"), 0);
  });

  it("refuses a member who already has a LeetCode account", async () => {
    const res = await start("ln_has", "ln_free_lc");
    assert.equal(res.status, 409);
    assert.match(res.json.error, /already have a LeetCode account/);
  });

  it("hands out a one-time code", async () => {
    const res = await start("ln_plain", "ln_plain_lc");
    assert.equal(res.status, 200);
    assert.match(res.json.code, /^leeterboard-[0-9a-f]{12}$/);
    assert.equal(res.json.handle, "ln_plain_lc");
    assert.match(res.json.instructions, /Summary/);
    assert.equal(res.json.expiresInMinutes, 30);
    assert.equal(await count("SELECT COUNT(*) AS n FROM users WHERE id = ? AND leetcode_username IS NULL", [ids.get("ln_plain")!]), 1);
  });
});

describe("proving it and linking", () => {
  let code = "";

  before(async () => {
    code = (await db.getPendingLink(ids.get("ln_plain")!, "leetcode"))!.code;
  });

  it("refuses while the code isn't on the profile, and links nothing", async () => {
    const res = await verify("ln_plain");
    assert.equal(res.status, 400);
    assert.match(res.json.error, /couldn't find the code/i);
    assert.equal(await count("SELECT COUNT(*) AS n FROM users WHERE id = ? AND leetcode_username IS NULL", [ids.get("ln_plain")!]), 1);
  });

  it("links the account once the code is there, and starts tracking from now", async () => {
    fake.setAbout("ln_plain_lc", `hello ${code} bye`);
    const res = await verify("ln_plain");
    assert.equal(res.status, 201);
    assert.equal(res.json.id, ids.get("ln_plain"));
    assert.equal(res.json.leetcodeLinked, true);
    assert.equal(res.json.leetcodeUsername, "ln_plain_lc");
    assert.equal(res.json.displayName, "ln_plain", "their name is untouched");
    assert.equal(res.json.allTimeSolved, 42);
    assert.equal(res.json.easySolved, 20);
    assert.equal(res.json.mediumSolved, 15);
    assert.equal(res.json.hardSolved, 7);
    assert.match(res.json.avatarUrl, /^https:\/\/assets\.leetcode\.com\//);
    assert.doesNotMatch(res.text, /scrypt|passwordHash|password_hash/i);

    // Everything solved before today is background: progress starts at zero.
    assert.equal(res.json.weeklyProgress, 0);
    assert.equal(res.json.monthlyProgress, 0);
    assert.equal(res.json.trackingStart, TODAY);
    assert.equal(res.json.baselineSolved, 42);
    assert.deepEqual(
      res.json.history.map((h: { date: string; solvedCount: number }) => [h.date, h.solvedCount]),
      [[TODAY, 42]]
    );
  });

  it("keeps the login name and the session, and spends the challenge", async () => {
    const row = (
      await q("SELECT login_username, leetcode_username FROM users WHERE id = ?", [ids.get("ln_plain")!])
    ).rows[0];
    assert.equal(row.login_username, "ln_plain");
    assert.equal(row.leetcode_username, "ln_plain_lc");
    assert.equal(await count("SELECT COUNT(*) AS n FROM pending_links WHERE user_id = ?", [ids.get("ln_plain")!]), 0);

    const session = await api("GET", "/api/auth/session", { cookie: as("ln_plain") });
    assert.equal(session.json.user.id, ids.get("ln_plain"));
    assert.equal(session.json.user.leetcodeLinked, true);
    assert.equal(
      (await api("POST", "/api/auth/login", { body: { username: "ln_plain", password: PW } })).status,
      200,
      "they still sign in with their username"
    );
  });

  it("doesn't turn what they already held into news", async () => {
    nextSync(); // the next sync looks at everyone again
    assert.equal(await count("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?", [ids.get("ln_plain")!]), 0);
    assert.ok(
      (await count("SELECT COUNT(*) AS n FROM user_awards WHERE user_id = ?", [ids.get("ln_plain")!])) > 1,
      "their existing badges were recorded as known"
    );
  });

  it("shows them on the board with their LeetCode stats", async () => {
    const board = await api("GET", "/api/users", { cookie: as("ln_other") });
    const me = board.json.users.find((u: { id: string }) => u.id === ids.get("ln_plain"));
    assert.equal(me.leetcodeLinked, true);
    assert.equal(me.allTimeSolved, 42);
  });

  it("can't be used a second time", async () => {
    const res = await verify("ln_plain");
    assert.equal(res.status, 400);
    assert.equal(res.json.expired, true);
  });

  it("logs the link without the code", () => {
    const logs = server.logs();
    assert.match(logs, /"event":"ownership_started"[^\n]*"platform":"leetcode"[^\n]*"purpose":"link"/);
    assert.match(logs, /"event":"ownership_verified"[^\n]*"platform":"leetcode"[^\n]*"purpose":"link"/);
    assert.equal(logs.includes(code), false);
  });
});

describe("guards", () => {
  it("refuses to verify when nothing was started", async () => {
    const res = await verify("ln_other");
    assert.equal(res.status, 400);
    assert.equal(res.json.expired, true);
  });

  it("lets only one of two members who both prove the same account link it", async () => {
    const a = await start("ln_race_a", "ln_race_lc");
    const b = await start("ln_race_b", "ln_race_lc");
    assert.equal(a.status, 200, "starting is allowed for both: nobody has it yet");
    assert.equal(b.status, 200);
    fake.setAbout("ln_race_lc", `${a.json.code} ${b.json.code}`);

    const first = await verify("ln_race_a");
    assert.equal(first.status, 201);
    const second = await verify("ln_race_b");
    assert.equal(second.status, 409);
    assert.match(second.json.error, /just linked to another member/);

    assert.equal(await count("SELECT COUNT(*) AS n FROM users WHERE leetcode_username = 'ln_race_lc'"), 1);
    assert.equal(
      await count("SELECT COUNT(*) AS n FROM users WHERE id = ? AND leetcode_username IS NULL", [ids.get("ln_race_b")!]),
      1,
      "the loser is left without it, not half-linked"
    );
    assert.equal(await count("SELECT COUNT(*) AS n FROM history WHERE user_id = ?", [ids.get("ln_race_b")!]), 0);
  });
});

describe("unlinking", () => {
  it("needs a signed-in member", async () => {
    assert.equal((await api("DELETE", "/api/account/leetcode")).status, 401);
  });

  it("removes the LeetCode account and its data, and nothing else", async () => {
    const id = ids.get("ln_has")!;
    await q("INSERT INTO history (user_id, date, solved_count) VALUES (?, '2026-01-01', 5)", [id]);

    const res = await api("DELETE", "/api/account/leetcode", { cookie: as("ln_has") });
    assert.equal(res.status, 200);
    assert.equal(res.json.leetcodeLinked, false);
    assert.equal(res.json.leetcodeUsername, "");
    assert.equal(res.json.allTimeSolved, 0);
    assert.equal(res.json.lastUpdated, null);
    assert.deepEqual(res.json.history, []);

    const row = (await q("SELECT leetcode_username, baseline_solved, tracking_start FROM users WHERE id = ?", [id])).rows[0];
    assert.equal(row.leetcode_username, null);
    assert.equal(row.baseline_solved, 0);
    assert.equal(row.tracking_start, "");
    assert.equal(await count("SELECT COUNT(*) AS n FROM history WHERE user_id = ?", [id]), 0);
    assert.equal(await count("SELECT COUNT(*) AS n FROM sync_status WHERE user_id = ?", [id]), 0);

    // The member, their login, and their other linked account are still there.
    assert.equal(await count("SELECT COUNT(*) AS n FROM users WHERE id = ? AND login_username = 'ln_has'", [id]), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM platform_accounts WHERE user_id = ? AND platform = 'codeforces'", [id]), 1);
    assert.equal((await api("POST", "/api/auth/login", { body: { username: "ln_has", password: PW } })).status, 200);
    assert.match(server.logs(), /"event":"platform_unlinked"[^\n]*"platform":"leetcode"/);
  });

  it("answers 404 when there is nothing to remove", async () => {
    const res = await api("DELETE", "/api/account/leetcode", { cookie: as("ln_has") });
    assert.equal(res.status, 404);
  });

  it("frees the LeetCode account for someone else", async () => {
    const res = await start("ln_other", "ln_has_lc");
    assert.equal(res.status, 200);
  });
});
