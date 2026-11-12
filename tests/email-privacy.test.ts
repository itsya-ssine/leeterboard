/**
 * E-mail privacy across the whole app (email sign-up step 16). The other e-mail
 * test files check one route at a time; this one runs real flows (sign-up,
 * changing an address, forgot password, wrong codes, a mail outage, an address
 * that is already taken) and then looks everywhere an address or a code could
 * have leaked to: what other members, an admin and a visitor can read, every
 * log line, and the tables that hold pending requests and rate-limit counters.
 *
 * The addresses and their local parts are distinctive on purpose, so a leak of
 * any piece of one is found by a plain substring search.
 */
import { createClient } from "@libsql/client";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { makeFakeMail } from "./f2-seed.js";
import { client, registerViaApi, startServer, type ApiResult, type TestServer } from "./helpers.js";

const NO_MAIL = { EMAIL_PROVIDER: "", EMAIL_API_KEY: "", EMAIL_FROM: "", EMAIL_OUTBOX_DIR: "", ALLOWED_EMAIL_DOMAINS: "" };
const PW = "correct-horse-9";
const NEW_PW = "a-brand-new-password-42";
const API_KEY = "re_test_key_do_not_log_me"; // what makeFakeMail().env gives the mailer

// Every address used below, and the part before the "@" of each.
const VICTIM_FIRST = "privacytarget.alpha@example.com";
const VICTIM_SECOND = "privacytarget.bravo@example.com";
const OTHER_NEW = "privacytarget.charlie@example.com"; // a sign-up that is started and never finished
const OUTAGE = "privacytarget.delta@example.com"; // asked for while the provider is down
const VIEWER = "privacyviewer.omega@example.com";
const ADMIN = "privacyadmin.sigma@example.com";
const ADDRESSES = [VICTIM_FIRST, VICTIM_SECOND, OTHER_NEW, OUTAGE];
const LOCAL_PARTS = ADDRESSES.map((a) => a.split("@")[0]);
// What nobody but the member may ever be shown: the address and its local part.
const VICTIM_PROBES = [VICTIM_FIRST, VICTIM_SECOND, ...LOCAL_PARTS];

let server: TestServer;
let api: ReturnType<typeof client>;
const mail = makeFakeMail();

let ipSeq = 0;
const nextIp = () => `10.70.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
const ip = () => ({ "x-forwarded-for": nextIp() });

const query = async (sql: string, args: (string | number)[] = []) => {
  const c = createClient({ url: server.dbUrl });
  try {
    await c.execute("PRAGMA busy_timeout = 5000");
    await c.execute("PRAGMA journal_mode = WAL");
    return (await c.execute({ sql, args })).rows.map((r) => ({ ...r }));
  } finally {
    c.close();
  }
};
const run = async (sql: string, args: (string | number | null)[] = []) => {
  const c = createClient({ url: server.dbUrl });
  try {
    await c.execute("PRAGMA busy_timeout = 5000");
    await c.execute("PRAGMA journal_mode = WAL");
    await c.execute({ sql, args });
  } finally {
    c.close();
  }
};
// The test server treats the member whose LeetCode name is "test_admin" as an admin.
const makeAdmin = async (id: string) => {
  await run("UPDATE users SET leetcode_username = NULL WHERE lower(leetcode_username) = 'test_admin'");
  await run("UPDATE users SET leetcode_username = 'test_admin' WHERE id = ?", [id]);
};

interface Member {
  id: string;
  cookie: string;
}
const signUp = async (username: string, email: string): Promise<Member> => {
  const res = await registerViaApi(api, mail, { username, password: PW, email });
  assert.equal(res.status, 201, res.text);
  return { id: res.json.id, cookie: res.cookie! };
};

const get = (route: string, cookie: string | null): Promise<ApiResult> => api("GET", route, { cookie, headers: ip() });
const leaks = (text: string, probes: string[]) => probes.filter((p) => text.toLowerCase().includes(p.toLowerCase()));

let victim: Member;
let viewer: Member;
let admin: Member;

before(async () => {
  server = await startServer({ ...NO_MAIL, ...mail.env });
  api = client(server);

  // Three members through the real flow, then the traffic that leaves traces.
  victim = await signUp("victimuser", VICTIM_FIRST);
  viewer = await signUp("viewermember", VIEWER);
  admin = await signUp("adminmember", ADMIN);
  await makeAdmin(admin.id);

  // 1. The victim changes their address (right password, a wrong code, the right code).
  let res = await api("POST", "/api/account/email/start", {
    body: { email: VICTIM_SECOND, currentPassword: PW },
    cookie: victim.cookie,
    headers: ip()
  });
  assert.equal(res.status, 200, res.text);
  const changeCode = mail.lastCode(VICTIM_SECOND)!;
  const wrong = changeCode === "000000" ? "000001" : "000000";
  await api("POST", "/api/account/email/verify", { body: { code: wrong }, cookie: victim.cookie, headers: ip() });
  res = await api("POST", "/api/account/email/verify", { body: { code: changeCode }, cookie: victim.cookie, headers: ip() });
  assert.equal(res.status, 200, res.text);

  // 2. Forgot password for the new address (a wrong code, then the right one).
  res = await api("POST", "/api/auth/reset/email/start", { body: { email: VICTIM_SECOND, newPassword: NEW_PW }, headers: ip() });
  assert.equal(res.status, 200, res.text);
  const resetCookie = `pwresetmail=${/(?:^|,\s*)pwresetmail=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1]}`;
  const resetCode = mail.lastCode(VICTIM_SECOND)!;
  await api("POST", "/api/auth/reset/email/verify", {
    body: { code: resetCode === "000000" ? "000001" : "000000" },
    cookie: resetCookie,
    headers: ip()
  });
  res = await api("POST", "/api/auth/reset/email/verify", { body: { code: resetCode }, cookie: resetCookie, headers: ip() });
  assert.equal(res.status, 200, res.text);
  // The reset signs every other session out, so the victim carries on with the new one.
  assert.ok(res.cookie, "the reset signs this device in");
  victim.cookie = res.cookie;

  // 3. A sign-up that is started and left open, and one for an address that is already taken.
  res = await api("POST", "/api/auth/register/start", {
    body: { username: "unfinished01", password: PW, email: OTHER_NEW },
    headers: ip()
  });
  assert.equal(res.status, 200, res.text);
  res = await api("POST", "/api/auth/register/start", {
    body: { username: "takenaddress1", password: PW, email: VICTIM_SECOND },
    headers: ip()
  });
  assert.equal(res.status, 200, res.text);

  // 4. A sign-up while the mail provider is down.
  mail.setDown(true);
  res = await api("POST", "/api/auth/register/start", {
    body: { username: "outageuser01", password: PW, email: OUTAGE },
    headers: ip()
  });
  assert.equal(res.status, 503, res.text);
  mail.setDown(false);
});

after(async () => {
  await server.stop();
  mail.cleanup();
});

describe("what other members, an admin and a visitor can read", () => {
  const SURFACES: [string, string][] = [
    ["GET", "/api/users"],
    ["GET", "/api/trends"],
    ["GET", "/api/trends?platform=codeforces"],
    ["GET", "/api/notifications"],
    ["GET", "/api/auth/session"]
  ];
  const ADMIN_SURFACES = ["/api/admin/sync-status", "/api/admin/feedback", "/api/admin/notifications"];

  it("the board and every other page another member can read hold no part of the victim's addresses", async () => {
    for (const [, route] of SURFACES) {
      const res = await get(route, viewer.cookie);
      assert.ok(res.status < 500, `${route} -> ${res.status}`);
      assert.deepEqual(leaks(res.text, VICTIM_PROBES), [], route);
    }
    // The victim IS on the board the viewer reads (this would be vacuous otherwise).
    const users = await get("/api/users", viewer.cookie);
    assert.equal(users.status, 200);
    assert.ok(users.json.users.some((u: any) => u.id === victim.id));
  });

  it("the board has no email field at all, not even an empty one, for anyone", async () => {
    for (const cookie of [viewer.cookie, admin.cookie, victim.cookie]) {
      const users = await get("/api/users", cookie);
      assert.equal(users.status, 200);
      assert.doesNotMatch(users.text, /"email/i);
    }
  });

  it("the admin tables hold no address of any member", async () => {
    for (const route of ADMIN_SURFACES) {
      const res = await get(route, admin.cookie);
      assert.equal(res.status, 200, `${route} -> ${res.status}: ${res.text.slice(0, 200)}`);
      assert.deepEqual(leaks(res.text, [...VICTIM_PROBES, VIEWER, "privacyviewer"]), [], route);
    }
    const sync = await get("/api/admin/sync-status", admin.cookie);
    assert.doesNotMatch(sync.text, /"email/i);
  });

  it("an admin's board and session show the admin's own address at most, never a member's", async () => {
    const users = await get("/api/users", admin.cookie);
    assert.deepEqual(leaks(users.text, [...VICTIM_PROBES, VIEWER]), []);
    const session = await get("/api/auth/session", admin.cookie);
    assert.equal(session.json.user.email, ADMIN);
    assert.deepEqual(leaks(session.text, [...VICTIM_PROBES, VIEWER]), []);
  });

  it("the session answers a member with their OWN address, and nobody else with it", async () => {
    const own = await get("/api/auth/session", victim.cookie);
    assert.equal(own.json.user.email, VICTIM_SECOND);
    assert.equal(own.json.user.emailVerified, true);
    const viewerSession = await get("/api/auth/session", viewer.cookie);
    assert.equal(viewerSession.json.user.email, VIEWER);
    assert.deepEqual(leaks(viewerSession.text, VICTIM_PROBES), []);
    assert.deepEqual(await get("/api/auth/session", null).then((r) => r.json), { status: "guest", oauthProviders: [] });
  });

  it("a visitor gets no member data at all, so no address", async () => {
    for (const [, route] of [...SURFACES.filter(([, r]) => r !== "/api/auth/session"), ...ADMIN_SURFACES.map((r): [string, string] => ["GET", r])]) {
      const res = await get(route, null);
      assert.equal(res.status, 401, route);
      assert.deepEqual(leaks(res.text, [...VICTIM_PROBES, VIEWER]), [], route);
    }
  });
});

describe("the mail that was sent", () => {
  it("went only to the addresses that asked, and the mail to a taken address carries no code", () => {
    const sent = mail.mails();
    assert.ok(sent.length >= 8, `expected the flows to send mail, saw ${sent.length}`);
    for (const m of sent) assert.ok([...ADDRESSES, VIEWER, ADMIN].includes(m.to.toLowerCase()), `unexpected recipient ${m.to}`);
    // The sign-up for VICTIM_SECOND (already registered) was answered with a notice.
    const taken = sent.filter((m) => m.to === VICTIM_SECOND && !/\b\d{6}\b/.test(m.text));
    assert.ok(taken.length >= 1, "the owner of a taken address gets a mail with no code");
  });
});

describe("the logs", () => {
  const codes = () => [...new Set(mail.mails().flatMap((m) => [...m.text.matchAll(/\b(\d{6})\b/g)].map((x) => x[1])))];

  it("hold no address, no part of one, no code, no password and no provider key", () => {
    const logs = server.logs();
    assert.ok(logs.length > 0, "the server logged something");
    for (const address of [...ADDRESSES, VIEWER, ADMIN]) {
      assert.equal(logs.toLowerCase().includes(address), false, `address in the logs: ${address}`);
      assert.equal(logs.toLowerCase().includes(address.split("@")[0]), false, `local part in the logs: ${address}`);
    }
    for (const secret of [PW, NEW_PW, API_KEY]) assert.equal(logs.includes(secret), false, "a secret is in the logs");
    const found = codes();
    assert.ok(found.length >= 5, "the flows mailed several codes");
    for (const code of found) {
      assert.equal(new RegExp(`(?<!\\d)${code}(?!\\d)`).test(logs), false, `code ${code} is in the logs`);
    }
  });

  it("do say what happened, with the masked address only", () => {
    const logs = server.logs();
    assert.match(logs, /"event":"signup_code_sent"/);
    assert.match(logs, /"event":"signup_code_failed"|"event":"email_code_failed"/);
    assert.match(logs, /"event":"mail_send_failed"/);
    assert.match(logs, /"maskedEmail":"p\*\*\*@example\.com"/);
  });
});

describe("what is stored", () => {
  it("keeps only hashes of codes in the pending requests, and never a code or a password", async () => {
    const rows = await query("SELECT * FROM pending_email_codes");
    assert.ok(rows.length >= 1, "the open sign-up is still pending");
    const found = [...new Set(mail.mails().flatMap((m) => [...m.text.matchAll(/\b(\d{6})\b/g)].map((x) => x[1])))];
    for (const row of rows) {
      assert.match(String(row.code_hash), /^[0-9a-f]{64}$/);
      const stored = JSON.stringify(row);
      for (const code of found) assert.equal(new RegExp(`(?<!\\d)${code}(?!\\d)`).test(stored), false, `code ${code} stored in plain text`);
      if (row.password_hash !== null) assert.match(String(row.password_hash), /^\S{20,}$/);
      assert.equal(stored.includes(PW) || stored.includes(NEW_PW), false, "a password is stored in plain text");
    }
  });

  it("leaves no pending request behind for a finished flow, and none for the failed send", async () => {
    assert.equal((await query("SELECT 1 FROM pending_email_codes WHERE email = ?", [VICTIM_FIRST])).length, 0);
    assert.equal((await query("SELECT 1 FROM pending_email_codes WHERE email = ? AND purpose = 'add_email'", [VICTIM_SECOND])).length, 0);
    assert.equal((await query("SELECT 1 FROM pending_email_codes WHERE purpose = 'reset'")).length, 0);
    assert.equal((await query("SELECT 1 FROM pending_email_codes WHERE email = ?", [OUTAGE])).length, 0);
  });

  it("keeps no address or local part in the rate-limit counters", async () => {
    const rows = JSON.stringify(await query("SELECT * FROM rate_limits"));
    assert.ok(rows.length > 2, "the flows were counted");
    assert.deepEqual(leaks(rows, [...ADDRESSES, VIEWER, ADMIN, ...LOCAL_PARTS, "privacyviewer", "privacyadmin"]), []);
  });

  it("keeps an address only in users.email (lowercase) for the member who proved it", async () => {
    const rows = await query("SELECT id, email FROM users WHERE email IS NOT NULL ORDER BY email");
    assert.deepEqual(
      rows.map((r) => r.email),
      [ADMIN, VICTIM_SECOND, VIEWER].sort()
    );
  });
});
