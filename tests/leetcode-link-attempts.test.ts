/**
 * Proving a LeetCode account is limited: every wrong check is counted, and
 * after too many the challenge is thrown away, even for the right code.
 * Kept apart from leetcode-link.test.ts because the verify route allows only
 * 20 requests per 15 minutes and this file spends 12 of them.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { client, startServer, type TestServer } from "./helpers.js";
import { makeFakeLeetCode, makeUser } from "./f2-seed.js";

const PW = "correct-horse-battery-9";
const MAX_ATTEMPTS = 10; // MAX_LINK_ATTEMPTS in server.ts

let tmpDir = "";
let server: TestServer;
let api: ReturnType<typeof client>;
let db: typeof import("../db.js");
let cookie = "";
let userId = "";
const fake = makeFakeLeetCode();

const verify = () => api("POST", "/api/account/leetcode/verify", { cookie });
const attempts = async () => (await db.getPendingLink(userId, "leetcode"))?.attempts ?? null;

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-lcattempts-"));
  const dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");
  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");

  const user = makeUser("att_member", {
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
  await db.insertUser(user, await hashPassword(PW), { loginUsername: "att_member" });
  userId = user.id;
  fake.setAbout("att_member_lc", "hello, no code here");

  server = await startServer({ TURSO_DATABASE_URL: dbUrl, JWT_SECRET: secret, ...fake.env });
  api = client(server);
  const login = await api("POST", "/api/auth/login", { body: { username: "att_member", password: PW } });
  assert.equal(login.status, 200);
  cookie = login.cookie!;
});

after(async () => {
  await server?.stop();
  fake.cleanup();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("a wrong code while linking LeetCode", () => {
  let code = "";

  it("starts a challenge that has had no wrong checks", async () => {
    const res = await api("POST", "/api/account/leetcode/start", { cookie, body: { leetcodeUsername: "att_member_lc" } });
    assert.equal(res.status, 200);
    code = res.json.code;
    assert.equal(await attempts(), 0);
  });

  it("fails with 400 and is counted every time", async () => {
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const res = await verify();
      assert.equal(res.status, 400, `check ${i}`);
      assert.match(res.json.error, /couldn't find the code/i);
      assert.equal(await attempts(), i, `after check ${i}`);
    }
    const me = await api("GET", "/api/auth/session", { cookie });
    assert.equal(me.json.user?.leetcodeLinked ?? me.json.leetcodeLinked, false, "nothing was linked");
  });

  it("then throws the challenge away with 429, even once the code is on the profile", async () => {
    fake.setAbout("att_member_lc", `now it is here: ${code}`);
    const res = await verify();
    assert.equal(res.status, 429);
    assert.equal(res.json.expired, true);
    assert.equal(await attempts(), null, "the challenge is gone");
    const me = await api("GET", "/api/auth/session", { cookie });
    assert.equal(me.json.user?.leetcodeLinked ?? me.json.leetcodeLinked, false);
  });

  it("lets the member start again with a fresh code", async () => {
    const res = await api("POST", "/api/account/leetcode/start", { cookie, body: { leetcodeUsername: "att_member_lc" } });
    assert.equal(res.status, 200);
    assert.notEqual(res.json.code, code);
    assert.equal(await attempts(), 0);
  });
});
