/**
 * Forgot password: someone who can't sign in proves they own an account the
 * member linked (LeetCode, Codeforces or CodinGame) by putting a one-time code
 * in its public profile, and sets a new password.
 *
 * Runs the real server, with LeetCode / Codeforces / CodinGame faked. Start is
 * limited to 10 requests an hour per IP and verify to 20 per 15 minutes, so this
 * file spends them deliberately (refusals and attempt limits are in
 * password-reset-blocked.test.ts, which has its own server).
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

const login = (username: string, password: string) => api("POST", "/api/auth/login", { body: { username, password } });
const resetCookieOf = (res: { headers: Headers }) => res.headers.get("set-cookie")?.match(/pwreset=[^;]+/)?.[0] ?? null;
const start = (body: Record<string, unknown>) => api("POST", "/api/auth/reset/start", { body });
const verify = (cookie: string | null) => api("POST", "/api/auth/reset/verify", { cookie });

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-reset-"));
  const dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");
  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");
  const hash = await hashPassword(OLD_PW);

  // A member who signed up with LeetCode.
  const lc = makeUser("rs_lc");
  await db.insertUser(lc, hash);
  ids.set("rs_lc", lc.id);
  fake.setAbout("rs_lc", "I like graphs.");

  // A member with no LeetCode, who linked Codeforces / CodinGame instead.
  for (const [name, platform, handle] of [
    ["rs_cf", "codeforces", "RsCfHandle"],
    ["rs_cg", "codingame", "abc123def4567890"],
    ["rs_cf_changed", "codeforces", "RsChangedHandle"],
    ["rs_cf_frozen_later", "codeforces", "RsLateHandle"]
  ] as const) {
    const user = noLeetCode(name);
    await db.insertUser(user, hash, { loginUsername: name });
    await db.insertPlatformAccount(user.id, platform, handle);
    ids.set(name, user.id);
    fake.setPlatformProfile(platform, handle, "Just a handle");
  }

  // An old account from before passwords existed: LeetCode linked, no password.
  const nopw = makeUser("rs_nopw");
  await db.insertUser(nopw, "");
  ids.set("rs_nopw", nopw.id);
  fake.setAbout("rs_nopw", "");

  server = await startServer({ TURSO_DATABASE_URL: dbUrl, JWT_SECRET: secret, ...fake.env });
  api = client(server);
});

after(async () => {
  await server?.stop();
  fake.cleanup();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("resetting through LeetCode", () => {
  let cookie: string | null;
  let code = "";
  let oldSession: string | null;

  it("hands out a one-time code and says where to put it, without naming the account", async () => {
    oldSession = (await login("rs_lc", OLD_PW)).cookie;
    assert.ok(oldSession);

    const res = await start({ username: "RS_LC", platform: "leetcode", password: NEW_PW });
    assert.equal(res.status, 200);
    code = res.json.code;
    assert.match(code, /^leeterboard-[0-9a-f]{12}$/);
    assert.match(res.json.instructions, /Summary/);
    assert.equal(res.json.expiresInMinutes, 30);
    assert.equal(res.text.includes("rs_lc"), false, "the response doesn't name the linked account");
    cookie = resetCookieOf(res);
    assert.ok(cookie, "a challenge cookie was set");
    assert.match(res.headers.get("set-cookie")!, /HttpOnly/i);
  });

  it("changes nothing until the code is proven", async () => {
    assert.equal((await login("rs_lc", OLD_PW)).status, 200, "the old password still works");
    assert.equal((await login("rs_lc", NEW_PW)).status, 401, "the new one doesn't work yet");
  });

  it("refuses while the code isn't on the profile", async () => {
    const res = await verify(cookie);
    assert.equal(res.status, 400);
    assert.match(res.json.error, /couldn't find the code/i);
    assert.equal(res.cookie, null, "no session");
  });

  it("sets the password, signs the person in, and signs everyone else out", async () => {
    fake.setAbout("rs_lc", `I like graphs. ${code} thanks`);
    const res = await verify(cookie);
    assert.equal(res.status, 200);
    assert.equal(res.json.id, ids.get("rs_lc"));
    assert.equal(res.json.isAdmin, false);
    assert.ok(res.cookie, "a session cookie was set");
    assert.doesNotMatch(res.text, /scrypt|passwordHash|password_hash/i);
    assert.match(res.headers.get("set-cookie")!, /pwreset=;/, "the challenge cookie is cleared");

    assert.equal((await login("rs_lc", NEW_PW)).status, 200, "the new password works");
    assert.equal((await login("rs_lc", OLD_PW)).status, 401, "the old one doesn't");
    assert.equal(
      (await api("GET", "/api/users", { cookie: oldSession })).status,
      401,
      "a session from before the reset is no longer valid"
    );
    assert.equal((await api("GET", "/api/users", { cookie: res.cookie })).status, 200, "the new session is");
  });

  it("leaves the owner a notice, and logs it", async () => {
    const session = (await login("rs_lc", NEW_PW)).cookie;
    const feed = await api("GET", "/api/notifications", { cookie: session });
    const notice = feed.json.notifications.find((n: { title: string }) => n.title === "Your password was reset");
    assert.ok(notice, "the owner was told");
    assert.match(notice.body, /LeetCode account "rs_lc"/);

    const logs = server.logs();
    assert.match(logs, /"event":"ownership_started"[^\n]*"purpose":"reset"/);
    assert.match(logs, /"event":"password_reset_via_ownership"/);
    assert.equal(logs.includes(NEW_PW), false, "the new password is never logged");
    assert.equal(logs.includes(code), false, "the proof code isn't logged");
  });

  it("can't be used a second time", async () => {
    const res = await verify(cookie);
    assert.equal(res.status, 400);
    assert.equal(res.json.expired, true);
    assert.equal(res.cookie, null);
  });
});

describe("resetting through the other platforms", () => {
  it("works through Codeforces for a member with no LeetCode account", async () => {
    const started = await start({ username: "rs_cf", platform: "codeforces", password: NEW_PW });
    assert.equal(started.status, 200);
    assert.match(started.json.instructions, /Codeforces/);

    fake.setPlatformProfile("codeforces", "RsCfHandle", `Org ${started.json.code}`);
    const res = await verify(resetCookieOf(started));
    assert.equal(res.status, 200);
    assert.equal(res.json.id, ids.get("rs_cf"));
    assert.equal(res.json.leetcodeLinked, false);
    assert.equal((await login("rs_cf", NEW_PW)).status, 200);
    assert.equal((await login("rs_cf", OLD_PW)).status, 401);
  });

  it("works through CodinGame", async () => {
    const started = await start({ username: "rs_cg", platform: "codingame", password: NEW_PW });
    assert.equal(started.status, 200);
    fake.setPlatformProfile("codingame", "abc123def4567890", `tagline ${started.json.code}`);
    const res = await verify(resetCookieOf(started));
    assert.equal(res.status, 200);
    assert.equal(res.json.id, ids.get("rs_cg"));
    assert.equal((await login("rs_cg", NEW_PW)).status, 200);
  });

  it("lets an old account that never had a password set one", async () => {
    const blocked = await login("rs_nopw", NEW_PW);
    assert.equal(blocked.status, 401, "it can't sign in yet");
    assert.equal(blocked.json.needsPassword, true);
    assert.match(blocked.json.error, /Forgot password/);
    const started = await start({ username: "rs_nopw", platform: "leetcode", password: NEW_PW });
    assert.equal(started.status, 200);
    fake.setAbout("rs_nopw", started.json.code);
    const res = await verify(resetCookieOf(started));
    assert.equal(res.status, 200);
    assert.equal((await login("rs_nopw", NEW_PW)).status, 200);
  });
});

describe("a challenge is checked again at the second step", () => {
  it("only works with the cookie the start step issued", async () => {
    const none = await verify(null);
    assert.equal(none.status, 400);
    assert.equal(none.json.expired, true);

    const forged = await verify(`pwreset=${crypto.randomBytes(32).toString("hex")}`);
    assert.equal(forged.status, 400);
    assert.equal(forged.json.expired, true);
  });

  it("is refused if the linked account is no longer the one it was started for", async () => {
    const started = await start({ username: "rs_cf_changed", platform: "codeforces", password: NEW_PW });
    assert.equal(started.status, 200);

    // The member unlinks it and links a different handle, which has the code.
    await db.removePlatformAccount(ids.get("rs_cf_changed")!, "codeforces");
    await db.insertPlatformAccount(ids.get("rs_cf_changed")!, "codeforces", "SomeoneElse");
    fake.setPlatformProfile("codeforces", "RsChangedHandle", started.json.code);
    fake.setPlatformProfile("codeforces", "SomeoneElse", started.json.code);

    const res = await verify(resetCookieOf(started));
    assert.equal(res.status, 403);
    assert.equal(res.cookie, null);
    assert.equal((await login("rs_cf_changed", NEW_PW)).status, 401, "the password was not changed");
  });

  it("is refused if the account's name stopped resolving in between", async () => {
    const started = await start({ username: "rs_cf_frozen_later", platform: "codeforces", password: NEW_PW });
    assert.equal(started.status, 200);

    // A sync discovers the handle is gone, and later it "comes back" (recycled).
    await db.recordPlatformSyncResult(ids.get("rs_cf_frozen_later")!, "codeforces", {
      ok: false,
      state: "not_found",
      error: "gone"
    });
    await db.recordPlatformSyncResult(ids.get("rs_cf_frozen_later")!, "codeforces", { ok: true });
    fake.setPlatformProfile("codeforces", "RsLateHandle", started.json.code);

    const res = await verify(resetCookieOf(started));
    assert.equal(res.status, 403);
    assert.equal((await login("rs_cf_frozen_later", NEW_PW)).status, 401, "the password was not changed");
    assert.match(server.logs(), /"event":"ownership_blocked"[^\n]*"reason":"name_not_found"[^\n]*"stage":"verify"/);
  });
});
