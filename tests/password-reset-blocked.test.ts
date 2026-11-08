/**
 * Forgot password: who is refused, and the limits.
 *
 * A reset is refused for an unknown username, an admin, an account whose linked
 * name stopped resolving, a member with nothing linked, and a platform the
 * member hasn't linked. Every refusal must look the same from outside. Runs the
 * real server; start allows 10 requests an hour per IP, so the requests here
 * are counted: 10 starts, then an 11th that must be rate limited.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { client, startServer, type TestServer } from "./helpers.js";
import { makeFakeLeetCode, makeUser } from "./f2-seed.js";

const OLD_PW = "the-old-password-1";
const NEW_PW = "a-brand-new-password-42";

let tmpDir = "";
let server: TestServer;
let api: ReturnType<typeof client>;
let db: typeof import("../db.js");
const fake = makeFakeLeetCode();
const ids = new Map<string, string>();

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

const start = (body: Record<string, unknown>) => api("POST", "/api/auth/reset/start", { body });
const verify = (cookie: string | null) => api("POST", "/api/auth/reset/verify", { cookie });
const login = (username: string, password: string) => api("POST", "/api/auth/login", { body: { username, password } });
const resetCookieOf = (res: { headers: Headers }) => res.headers.get("set-cookie")?.match(/pwreset=[^;]+/)?.[0] ?? null;
const pendingCount = async () => Number((await db.client.execute("SELECT COUNT(*) AS n FROM pending_resets")).rows[0].n);

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-reset-blocked-"));
  const dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");
  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");
  const hash = await hashPassword(OLD_PW);

  const add = async (name: string, user = makeUser(name), loginUsername?: string) => {
    await db.insertUser(user, hash, loginUsername ? { loginUsername } : {});
    ids.set(name, user.id);
    return user;
  };

  await add("rs_admin"); // an admin, with a LeetCode account that would pass the proof
  await add("rs_gone"); // LeetCode name stopped resolving once, then "came back"
  await add("rs_lc2"); // an ordinary member with LeetCode
  await add("rs_none", noLeetCode("rs_none"), "rs_none"); // nothing linked at all
  const cf = await add("rs_cf_gone", noLeetCode("rs_cf_gone"), "rs_cf_gone");
  await db.insertPlatformAccount(cf.id, "codeforces", "GoneHandle");

  await db.recordSyncResult(ids.get("rs_gone")!, { ok: false, state: "not_found", error: "gone" });
  await db.recordSyncResult(ids.get("rs_gone")!, { ok: true });
  await db.recordPlatformSyncResult(cf.id, "codeforces", { ok: false, state: "not_found", error: "gone" });
  await db.recordPlatformSyncResult(cf.id, "codeforces", { ok: true });

  for (const name of ["rs_admin", "rs_gone", "rs_lc2"]) fake.setAbout(name, "hello");
  fake.setPlatformProfile("codeforces", "GoneHandle", "hello");

  server = await startServer({
    TURSO_DATABASE_URL: dbUrl,
    JWT_SECRET: secret,
    ADMIN_USER_IDS: ids.get("rs_admin")!,
    ...fake.env
  });
  api = client(server);
});

after(async () => {
  await server?.stop();
  fake.cleanup();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("a reset that can't go ahead", () => {
  const refused: Array<[label: string, body: Record<string, unknown>]> = [
    ["an unknown username", { username: "nobody_here_xyz", platform: "leetcode", password: NEW_PW }],
    ["an admin account", { username: "rs_admin", platform: "leetcode", password: NEW_PW }],
    ["an account whose LeetCode name stopped resolving", { username: "rs_gone", platform: "leetcode", password: NEW_PW }],
    ["an account whose Codeforces handle stopped resolving", { username: "rs_cf_gone", platform: "codeforces", password: NEW_PW }],
    ["a member with nothing linked", { username: "rs_none", platform: "leetcode", password: NEW_PW }],
    ["a platform the member hasn't linked", { username: "rs_lc2", platform: "codeforces", password: NEW_PW }]
  ];
  const responses: Awaited<ReturnType<typeof start>>[] = [];

  for (const [label, body] of refused) {
    it(`is refused for ${label}`, async () => {
      const res = await start(body);
      responses.push(res);
      assert.equal(res.status, 403);
      assert.match(res.json.error, /can't be reset online/);
      assert.equal(res.headers.get("set-cookie"), null, "no challenge cookie");
      assert.equal(res.cookie, null, "no session");
    });
  }

  it("answers every one of them the same way, so nothing reveals why", () => {
    assert.equal(responses.length, refused.length);
    for (const res of responses) {
      assert.equal(res.status, responses[0].status);
      assert.deepEqual(res.json, responses[0].json);
    }
  });

  it("tells the person what they can do instead", () => {
    assert.match(responses[0].json.error, /change it in your account settings/);
    assert.match(responses[0].json.error, /new account with a different username/);
    assert.match(responses[0].json.error, /ask an admin/);
  });

  it("stores no challenge and changes no password", async () => {
    assert.equal(await pendingCount(), 0);
    for (const name of ["rs_admin", "rs_gone", "rs_lc2"]) {
      assert.equal((await login(name, OLD_PW)).status, 200, `${name} can still sign in with the old password`);
      assert.equal((await login(name, NEW_PW)).status, 401, `${name} can't sign in with the chosen one`);
    }
  });

  it("is logged with the real reason, which the person never sees", () => {
    const logs = server.logs();
    for (const reason of ["unknown_user", "admin", "name_not_found", "not_linked"]) {
      assert.match(logs, new RegExp(`"event":"ownership_blocked"[^\\n]*"reason":"${reason}"[^\\n]*"stage":"start"`), reason);
    }
    assert.equal(logs.includes(NEW_PW), false, "the chosen password is never logged");
  });
});

describe("input that is refused before anything else", () => {
  it("asks for a username", async () => {
    const res = await start({ platform: "leetcode", password: NEW_PW });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, "Enter your username.");
  });

  it("asks for one of the three platforms", async () => {
    const res = await start({ username: "rs_lc2", platform: "github", password: NEW_PW });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /LeetCode, Codeforces or CodinGame/);
  });

  it("holds the new password to the usual rules", async () => {
    const res = await start({ username: "rs_lc2", platform: "leetcode", password: "short" });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /at least \d+ characters/);
  });
});

describe("guessing", () => {
  let cookie: string | null;
  let code = "";

  it("gives up on a challenge after too many wrong checks", async () => {
    const started = await start({ username: "rs_lc2", platform: "leetcode", password: NEW_PW });
    assert.equal(started.status, 200);
    cookie = resetCookieOf(started);
    code = started.json.code;

    for (let i = 0; i < 10; i++) {
      assert.equal((await verify(cookie)).status, 400, `wrong check ${i + 1}`);
    }
    const locked = await verify(cookie);
    assert.equal(locked.status, 429);
    assert.equal(locked.json.expired, true);
  });

  it("then refuses even the right code, and leaves the password alone", async () => {
    fake.setAbout("rs_lc2", code);
    const res = await verify(cookie);
    assert.equal(res.status, 400);
    assert.equal(res.json.expired, true);
    assert.equal(res.cookie, null);
    assert.equal((await login("rs_lc2", NEW_PW)).status, 401);
    assert.equal((await login("rs_lc2", OLD_PW)).status, 200);
  });
});

describe("rate limiting", () => {
  it("answers 429 once the hourly allowance for starting resets is used up", async () => {
    // Ten starts have been spent above; the next one is over the limit.
    const res = await start({ username: "rs_lc2", platform: "leetcode", password: NEW_PW });
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("set-cookie"), null);
  });
});
