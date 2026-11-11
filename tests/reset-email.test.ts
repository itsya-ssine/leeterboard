/**
 * Forgot password by emailed code (email sign-up step 11):
 *   POST /api/auth/reset/email/start   { email, newPassword }
 *   POST /api/auth/reset/email/verify  { code }   (+ the "pwresetmail" cookie)
 *
 * Black-box, against the real server in production mode, the REAL resend
 * provider and a fake Resend. Every request comes from its own client IP
 * (x-forwarded-for), so the per-IP limits (10 starts an hour, 20 verifications
 * per 15 minutes) are never what is under test.
 */
import { createClient } from "@libsql/client";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { makeFakeMail } from "./f2-seed.js";
import { client, registerViaApi, startServer, type ApiResult, type TestServer } from "./helpers.js";

const NO_MAIL = { EMAIL_PROVIDER: "", EMAIL_API_KEY: "", EMAIL_FROM: "", EMAIL_OUTBOX_DIR: "", ALLOWED_EMAIL_DOMAINS: "" };
const OLD_PW = "correct-horse-9";
const NEW_PW = "a-brand-new-password-42";
const NEUTRAL = "If that address has an account, we sent a code.";

let server: TestServer;
let api: ReturnType<typeof client>;
const mail = makeFakeMail();

let ipSeq = 0;
const nextIp = () => `10.60.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
let uniq = 0;
const freshEmail = () => `reset${String(++uniq).padStart(4, "0")}@example.com`;

const query = async (sql: string, args: (string | number)[] = []) => {
  const c = createClient({ url: server.dbUrl });
  try {
    await c.execute("PRAGMA busy_timeout = 5000"); // the server may be mid-write
    await c.execute("PRAGMA journal_mode = WAL"); // readers and the server's writes then don't block each other
    return (await c.execute({ sql, args })).rows.map((r) => ({ ...r }));
  } finally {
    c.close();
  }
};
const run = async (sql: string, args: (string | number | null)[] = []) => {
  const c = createClient({ url: server.dbUrl });
  try {
    await c.execute("PRAGMA busy_timeout = 5000"); // the server may be mid-write
    await c.execute("PRAGMA journal_mode = WAL"); // readers and the server's writes then don't block each other
    await c.execute({ sql, args });
  } finally {
    c.close();
  }
};

interface Member {
  username: string;
  id: string;
  email: string;
  cookie: string;
}
let memberSeq = 0;
async function makeMember(): Promise<Member> {
  const username = `rset${String(++memberSeq).padStart(3, "0")}`;
  const email = freshEmail();
  const res = await registerViaApi(api, mail, { username, password: OLD_PW, email });
  assert.equal(res.status, 201, res.text);
  return { username, id: res.json.id, email, cookie: res.cookie! };
}

const startReset = (body: Record<string, unknown>) =>
  api("POST", "/api/auth/reset/email/start", { body, headers: { "x-forwarded-for": nextIp() } });
const verifyReset = (cookie: string | null, code: unknown) =>
  api("POST", "/api/auth/reset/email/verify", { body: { code }, cookie, headers: { "x-forwarded-for": nextIp() } });
const login = (username: string, password: string) =>
  api("POST", "/api/auth/login", { body: { username, password }, headers: { "x-forwarded-for": nextIp() } });

const resetCookieOf = (res: ApiResult) => /(?:^|,\s*)pwresetmail=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? null;
const clearsResetCookie = (res: ApiResult) => /pwresetmail=;[^,]*(Expires=Thu, 01 Jan 1970|Max-Age=0)/i.test(res.headers.get("set-cookie") ?? "");
const pendingFor = (email: string) => query("SELECT * FROM pending_email_codes WHERE purpose = 'reset' AND email = ?", [email.toLowerCase()]);
const skipResendWait = (email: string) =>
  run("UPDATE pending_email_codes SET last_sent_at = ? WHERE email = ?", [new Date(Date.now() - 61_000).toISOString(), email.toLowerCase()]);
// The test server treats the member whose LeetCode name is "test_admin" as an
// admin, and that name is unique, so making someone an admin moves it to them.
const makeAdmin = async (id: string) => {
  await run("UPDATE users SET leetcode_username = NULL WHERE lower(leetcode_username) = 'test_admin'");
  await run("UPDATE users SET leetcode_username = 'test_admin' WHERE id = ?", [id]);
};
const wrongCodeFor = (code: string | null) => (code === "000000" ? "000001" : "000000");

// Start for a member and return what the browser and the inbox now hold.
async function begin(email: string, newPassword = NEW_PW) {
  const res = await startReset({ email, newPassword });
  assert.equal(res.status, 200, res.text);
  return { res, cookie: `pwresetmail=${resetCookieOf(res)}`, code: mail.lastCode(email) as string };
}

before(async () => {
  server = await startServer({ ...NO_MAIL, ...mail.env });
  api = client(server);
});

after(async () => {
  await server.stop();
  mail.cleanup();
});

describe("start answers the same for every address", () => {
  it("is 200 with the same body and a cookie, for a member, an unknown address, an admin and an unverified address", async () => {
    const member = await makeMember();
    const admin = await makeMember();
    await makeAdmin(admin.id);
    const unverified = await makeMember();
    await run("UPDATE users SET email_verified_at = NULL WHERE id = ?", [unverified.id]);
    const unknown = freshEmail();

    const answers = [] as ApiResult[];
    for (const email of [member.email, unknown, admin.email, unverified.email]) answers.push(await startReset({ email, newPassword: NEW_PW }));

    for (const res of answers) {
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.json, { message: NEUTRAL, expiresInMinutes: 10 });
      assert.match(resetCookieOf(res) ?? "", /^[a-f0-9]{64}$/);
      assert.equal(res.cookie, null, "no session is created by asking");
    }
    for (const res of answers) {
      for (const secret of [member.email, unknown, admin.email, unverified.email, member.username]) assert.equal(res.text.includes(secret), false);
    }
  });

  it("mails a code only to a member's verified address, and mails nothing to the others", async () => {
    const member = await makeMember();
    const admin = await makeMember();
    await makeAdmin(admin.id);
    const unverified = await makeMember();
    await run("UPDATE users SET email_verified_at = NULL WHERE id = ?", [unverified.id]);
    const unknown = freshEmail();
    const before = new Map([member.email, admin.email, unverified.email, unknown].map((e) => [e, mail.mails(e).length]));

    for (const email of [member.email, unknown, admin.email, unverified.email]) await startReset({ email, newPassword: NEW_PW });

    const sent = (e: string) => mail.mails(e).slice(before.get(e));
    assert.equal(sent(member.email).length, 1);
    assert.equal(sent(member.email)[0].subject, "Your Leeterboard password reset code");
    assert.match(String(mail.lastCode(member.email)), /^\d{6}$/);
    for (const email of [admin.email, unverified.email, unknown]) assert.equal(sent(email).length, 0, `nothing for ${email}`);
  });

  it("keeps a pending request for the ones that can't reset too, holding no member, so verify looks the same", async () => {
    const admin = await makeMember();
    await makeAdmin(admin.id);
    const unknown = freshEmail();
    await startReset({ email: admin.email, newPassword: NEW_PW });
    await startReset({ email: unknown, newPassword: NEW_PW });
    for (const email of [admin.email, unknown]) {
      const row = (await pendingFor(email))[0];
      assert.ok(row, `a request exists for ${email}`);
      assert.equal(row.user_id, null);
      assert.equal(row.attempts, 0);
    }
  });

  it("holds the new password only as a hash, with the code hashed too", async () => {
    const member = await makeMember();
    const { code } = await begin(member.email, "plain-text-canary-77");
    const row = (await pendingFor(member.email))[0];
    assert.equal(row.user_id, member.id);
    assert.equal(row.purpose, "reset");
    assert.match(String(row.password_hash), /^scrypt\$/);
    assert.equal(JSON.stringify(row).includes("plain-text-canary-77"), false);
    assert.equal(JSON.stringify(row).includes(code), false);
    // Nothing changed yet.
    assert.equal((await login(member.username, OLD_PW)).status, 200);
  });

  it("answers a bad address or password with the same 400 whoever the address belongs to", async () => {
    const member = await makeMember();
    for (const email of [undefined, "", "not-an-email", "a@b@c.com", "x y@example.com", `${member.email}\r\nBcc: evil@example.com`]) {
      assert.equal((await startReset({ email, newPassword: NEW_PW })).status, 400, JSON.stringify(email));
    }
    for (const [email, who] of [[member.email, "member"], [freshEmail(), "unknown"]] as const) {
      const short = await startReset({ email, newPassword: "short" });
      assert.equal(short.status, 400, who);
      assert.equal(short.json.error, "Password must be at least 8 characters.");
      assert.equal((await startReset({ email, newPassword: undefined })).json.error, "Password is required.");
    }
    assert.equal(mail.mails().filter((m) => JSON.stringify(m).includes("evil@example.com")).length, 0);
  });

  it("looks the same when the new password is the member's username, and tells the owner by mail instead of sending a code", async () => {
    const member = await makeMember();
    // The generated usernames are shorter than the 8-character minimum, so give this member a long one.
    const long = `${member.username}_long_name`;
    await run("UPDATE users SET login_username = ? WHERE id = ?", [long, member.id]);
    const other = freshEmail();
    const before = mail.mails(member.email).length;

    const a = await startReset({ email: member.email, newPassword: long.toUpperCase() });
    const b = await startReset({ email: other, newPassword: long.toUpperCase() });
    assert.equal(a.status, 200);
    assert.deepEqual(a.json, b.json);

    const sent = mail.mails(member.email).slice(before);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].subject, "About your Leeterboard password reset");
    assert.doesNotMatch(sent[0].text, /\b\d{6}\b/);

    // Nothing the person could type opens that request.
    const res = await verifyReset(`pwresetmail=${resetCookieOf(a)}`, "123456");
    assert.notEqual(res.status, 200);
    assert.equal((await login(long, OLD_PW)).status, 200);
  });
});

describe("limits", () => {
  it("allows 3 starts an hour per address, then 429s the same for a member's address and an unknown one", async () => {
    const member = await makeMember();
    const unknown = freshEmail();
    const base = mail.mails(member.email).length;
    for (let n = 1; n <= 3; n++) {
      assert.equal((await startReset({ email: member.email, newPassword: NEW_PW })).status, 200);
      assert.equal((await startReset({ email: unknown, newPassword: NEW_PW })).status, 200);
      await skipResendWait(member.email);
      await skipResendWait(unknown);
    }
    const [a, b] = [await startReset({ email: member.email, newPassword: NEW_PW }), await startReset({ email: unknown, newPassword: NEW_PW })];
    assert.equal(a.status, 429);
    assert.deepEqual({ status: a.status, json: a.json }, { status: b.status, json: b.json });
    assert.equal(a.headers.get("set-cookie"), null);
    assert.equal(mail.mails(member.email).length - base, 3, "no fourth mail");
  });

  it("429s a second start within 60 seconds the same for both, and an early click costs none of the three", async () => {
    const member = await makeMember();
    const unknown = freshEmail();
    for (const email of [member.email, unknown]) {
      assert.equal((await startReset({ email, newPassword: NEW_PW })).status, 200);
      for (let n = 1; n <= 4; n++) {
        const early = await startReset({ email, newPassword: NEW_PW });
        assert.equal(early.status, 429);
        assert.equal(early.json.error, "Wait a minute before asking for another code.");
      }
      for (let n = 1; n <= 2; n++) {
        await skipResendWait(email);
        assert.equal((await startReset({ email, newPassword: NEW_PW })).status, 200, `${email} request ${n + 1}`);
      }
    }
  });

  it("invalidates the old code when a new one is asked for", async () => {
    const member = await makeMember();
    const first = await begin(member.email);
    await skipResendWait(member.email);
    const second = await begin(member.email);
    assert.notEqual(second.cookie, first.cookie);
    assert.equal((await verifyReset(first.cookie, first.code)).status, 400);
    assert.equal((await verifyReset(second.cookie, second.code)).status, 200);
  });

  it("is counted separately from sign-up and adding an address", async () => {
    const member = await makeMember();
    // Three sign-up starts and the address's reset allowance is untouched.
    for (let n = 1; n <= 3; n++) {
      await api("POST", "/api/auth/register/start", {
        body: { username: `strange${uniq}${n}`, password: OLD_PW, email: member.email },
        headers: { "x-forwarded-for": nextIp() }
      });
      await skipResendWait(member.email);
    }
    assert.equal((await startReset({ email: member.email, newPassword: NEW_PW })).status, 200);
  });
});

describe("when mail can't be sent", () => {
  it("answers a member's address the same 200, mails nothing, logs it, and a retry works (the count is given back)", async () => {
    const member = await makeMember();
    mail.setDown(true);
    try {
      for (let n = 1; n <= 4; n++) {
        const res = await startReset({ email: member.email, newPassword: NEW_PW });
        assert.equal(res.status, n === 1 ? 200 : 429, `down, request ${n}`); // the resend wait, not the outage, answers later ones
        if (n === 1) assert.deepEqual(res.json, { message: NEUTRAL, expiresInMinutes: 10 });
      }
    } finally {
      mail.setDown(false);
    }
    assert.match(server.logs(), /"event":"mail_send_failed"[^\n]*"route":"reset\/email\/start"/);
    await skipResendWait(member.email);
    assert.equal((await startReset({ email: member.email, newPassword: NEW_PW })).status, 200);
    assert.match(String(mail.lastCode(member.email)), /^\d{6}$/);
  });

  it("answers 503 when no mail provider is configured, whatever the address", async () => {
    const bare = await startServer({ ...NO_MAIL });
    try {
      const bareApi = client(bare);
      for (const email of ["someone@example.com", "other@example.com"]) {
        const res = await bareApi("POST", "/api/auth/reset/email/start", { body: { email, newPassword: NEW_PW } });
        assert.equal(res.status, 503);
      }
      assert.match(bare.logs(), /"event":"mail_unconfigured"/);
    } finally {
      await bare.stop();
    }
  });
});

describe("the right code", () => {
  it("sets the new password, signs the person in, and answers with the member and no address", async () => {
    const member = await makeMember();
    const { cookie, code } = await begin(member.email);
    const res = await verifyReset(cookie, code);
    assert.equal(res.status, 200, res.text);
    assert.ok(res.cookie, "a session cookie was set");
    assert.equal(res.json.loginUsername, member.username);
    assert.equal(res.json.id, member.id);
    assert.equal("email" in res.json, false);
    assert.equal(res.text.includes(member.email), false);
    assert.doesNotMatch(res.text, /scrypt|passwordHash|password_hash/i);
    assert.equal(clearsResetCookie(res), true);

    const session = await api("GET", "/api/auth/session", { cookie: res.cookie, headers: { "x-forwarded-for": nextIp() } });
    assert.equal(session.json.status, "authenticated");
    assert.equal(session.json.user.id, member.id);
  });

  it("changes the password: the new one signs in, the old one no longer does", async () => {
    const member = await makeMember();
    const { cookie, code } = await begin(member.email);
    assert.equal((await verifyReset(cookie, code)).status, 200);
    assert.equal((await login(member.username, NEW_PW)).status, 200);
    assert.equal((await login(member.username, OLD_PW)).status, 401);
  });

  it("signs every other session out", async () => {
    const member = await makeMember();
    assert.equal((await api("GET", "/api/users", { cookie: member.cookie, headers: { "x-forwarded-for": nextIp() } })).status, 200);
    const { cookie, code } = await begin(member.email);
    const res = await verifyReset(cookie, code);
    const stale = await api("GET", "/api/users", { cookie: member.cookie, headers: { "x-forwarded-for": nextIp() } });
    assert.equal(stale.status, 401);
    assert.equal(stale.json.code, "session_required");
    assert.equal((await api("GET", "/api/users", { cookie: res.cookie, headers: { "x-forwarded-for": nextIp() } })).status, 200);
  });

  it("clears a lockout", async () => {
    const member = await makeMember();
    await run("UPDATE users SET failed_logins = 5, locked_until = ? WHERE id = ?", [new Date(Date.now() + 3_600_000).toISOString(), member.id]);
    assert.equal((await login(member.username, OLD_PW)).status, 429);
    const { cookie, code } = await begin(member.email);
    assert.equal((await verifyReset(cookie, code)).status, 200);
    assert.equal((await login(member.username, NEW_PW)).status, 200);
  });

  it("leaves a notice in the account and mails the address that the password changed", async () => {
    const member = await makeMember();
    const before = mail.mails(member.email).length;
    const { cookie, code } = await begin(member.email);
    await verifyReset(cookie, code);

    const notices = await query("SELECT title, body FROM notifications WHERE user_id = ?", [member.id]);
    assert.ok(notices.some((n) => n.title === "Your password was reset"));
    const body = String(notices.find((n) => n.title === "Your password was reset")!.body);
    assert.equal(body.includes(member.email), false, "the notice holds the masked address only");
    assert.match(body, /r\*\*\*@example\.com/);

    const sent = mail.mails(member.email).slice(before);
    assert.deepEqual(sent.map((m) => m.subject), ["Your Leeterboard password reset code", "Your Leeterboard password was changed"]);
    assert.doesNotMatch(sent[1].text, /\b\d{6}\b/);
  });

  it("still resets when the confirmation mail can't be sent", async () => {
    const member = await makeMember();
    const { cookie, code } = await begin(member.email);
    mail.setDown(true);
    let res: ApiResult;
    try {
      res = await verifyReset(cookie, code);
    } finally {
      mail.setDown(false);
    }
    assert.equal(res.status, 200);
    assert.equal((await login(member.username, NEW_PW)).status, 200);
    assert.match(server.logs(), /"route":"reset\/email\/verify"/);
  });

  it("accepts the code the way people paste it, and is single use", async () => {
    const member = await makeMember();
    const { cookie, code } = await begin(member.email);
    assert.equal((await verifyReset(cookie, `${code.slice(0, 3)} ${code.slice(3)}`)).status, 200);
    const again = await verifyReset(cookie, code);
    assert.equal(again.status, 400);
    assert.equal(again.json.expired, true);
    assert.equal(again.cookie, null);
    assert.equal((await pendingFor(member.email)).length, 0);
  });

  it("lets exactly one of two simultaneous verifications win", async () => {
    const member = await makeMember();
    const { cookie, code } = await begin(member.email);
    const [x, y] = await Promise.all([verifyReset(cookie, code), verifyReset(cookie, code)]);
    assert.deepEqual([x.status, y.status].sort(), [200, 400]);
  });

  it("removes a pending platform-proof reset for the same member", async () => {
    const member = await makeMember();
    await run(
      `INSERT INTO pending_resets (id, user_id, platform, handle, password_hash, code, attempts, expires_at)
       VALUES (?, ?, 'leetcode', 'someone', 'scrypt$x', 'leeterboard-abc', 0, ?)`,
      ["a".repeat(64), member.id, new Date(Date.now() + 600_000).toISOString()]
    );
    assert.equal((await query("SELECT 1 FROM pending_resets WHERE user_id = ?", [member.id])).length, 1);
    const { cookie, code } = await begin(member.email);
    await verifyReset(cookie, code);
    assert.equal((await query("SELECT 1 FROM pending_resets WHERE user_id = ?", [member.id])).length, 0);
  });
});

describe("a wrong code", () => {
  it("answers 400 generically, counts the try, and changes nothing", async () => {
    const member = await makeMember();
    const { cookie, code } = await begin(member.email);
    const res = await verifyReset(cookie, wrongCodeFor(code));
    assert.equal(res.status, 400);
    assert.deepEqual(res.json, { error: "That code isn't right. Check it and try again." });
    assert.equal(res.cookie, null);
    assert.equal(Number((await pendingFor(member.email))[0].attempts), 1);
    assert.equal((await login(member.username, OLD_PW)).status, 200);
  });

  it("treats malformed input as a wrong code, never a server error", async () => {
    for (const code of ["", "12345", "abcdef", 123456, null, undefined, { a: 1 }]) {
      const member = await makeMember();
      const { cookie } = await begin(member.email);
      const res = await verifyReset(cookie, code);
      assert.equal(res.status, 400, JSON.stringify(code));
      assert.equal(Number((await pendingFor(member.email))[0].attempts), 1);
    }
  });

  it("locks at the 5th wrong try: 429, request deleted, cookie cleared, and the right code is then refused", async () => {
    const member = await makeMember();
    const { cookie, code } = await begin(member.email);
    for (let n = 1; n <= 4; n++) assert.equal((await verifyReset(cookie, wrongCodeFor(code))).status, 400, `try ${n}`);
    const fifth = await verifyReset(cookie, wrongCodeFor(code));
    assert.equal(fifth.status, 429);
    assert.equal(fifth.json.expired, true);
    assert.equal(clearsResetCookie(fifth), true);
    assert.equal((await pendingFor(member.email)).length, 0);

    const right = await verifyReset(cookie, code);
    assert.equal(right.status, 400);
    assert.equal(right.json.expired, true);
    assert.equal((await login(member.username, NEW_PW)).status, 401);
    assert.equal((await login(member.username, OLD_PW)).status, 200);
  });

  it("still accepts the right code on the 5th try after four wrong ones", async () => {
    const member = await makeMember();
    const { cookie, code } = await begin(member.email);
    for (let n = 1; n <= 4; n++) await verifyReset(cookie, wrongCodeFor(code));
    assert.equal((await verifyReset(cookie, code)).status, 200);
  });

  it("can't be beaten by guessing in parallel", async () => {
    const member = await makeMember();
    const { cookie, code } = await begin(member.email);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => verifyReset(cookie, i === 9 ? code : wrongCodeFor(code))));
    assert.ok(results.filter((r) => r.status === 200).length <= 1);
    assert.equal((await pendingFor(member.email)).length, 0);
  });

  it("fails try by try exactly the same for an address with no account", async () => {
    const member = await makeMember();
    const real = await begin(member.email);
    const unknownEmail = freshEmail();
    const fake = await begin(unknownEmail);
    assert.equal(fake.code, null, "no code was mailed for an unknown address");

    const tries = async (cookie: string, code: string | null) => {
      const out: { status: number; body: string; cleared: boolean }[] = [];
      for (let n = 1; n <= 5; n++) {
        const res = await verifyReset(cookie, wrongCodeFor(code));
        out.push({ status: res.status, body: JSON.stringify(res.json), cleared: clearsResetCookie(res) });
      }
      return out;
    };
    assert.deepEqual(await tries(fake.cookie, fake.code), await tries(real.cookie, real.code));
  });

  it("never signs anyone in or changes a password for an address that can't reset", async () => {
    const admin = await makeMember();
    await makeAdmin(admin.id);
    const { cookie } = await begin(admin.email);
    for (const code of ["000000", "123456", "999999", undefined]) {
      const res = await verifyReset(cookie, code);
      assert.notEqual(res.status, 200);
      assert.equal(res.cookie, null);
    }
    assert.equal((await login(admin.username, OLD_PW)).status, 200);
  });
});

describe("missing, unknown, expired and mismatched requests", () => {
  const expired = (res: ApiResult) => {
    assert.equal(res.status, 400);
    assert.deepEqual(res.json, { error: "This reset request has expired. Please start again.", expired: true });
    assert.equal(res.cookie, null);
  };

  it("400s without a cookie, with a malformed one and with an id nobody holds", async () => {
    expired(await verifyReset(null, "123456"));
    expired(await verifyReset("pwresetmail=nope", "123456"));
    expired(await verifyReset(`pwresetmail=${"a".repeat(64)}`, "123456"));
  });

  it("400s once the 10 minutes are over, even with the right code, and deletes the row", async () => {
    const member = await makeMember();
    const { cookie, code } = await begin(member.email);
    await run("UPDATE pending_email_codes SET expires_at = ? WHERE email = ?", [new Date(Date.now() - 1000).toISOString(), member.email]);
    const res = await verifyReset(cookie, code);
    expired(res);
    assert.equal(clearsResetCookie(res), true);
    assert.equal((await pendingFor(member.email)).length, 0);
    assert.equal((await login(member.username, OLD_PW)).status, 200);
  });

  it("doesn't take the id from the body", async () => {
    const member = await makeMember();
    const { code } = await begin(member.email);
    const id = (await pendingFor(member.email))[0].id;
    expired(await api("POST", "/api/auth/reset/email/verify", { body: { code, id, pendingId: id }, headers: { "x-forwarded-for": nextIp() } }));
  });

  it("refuses a sign-up request's cookie, and leaves that sign-up alone", async () => {
    const email = freshEmail();
    const started = await api("POST", "/api/auth/register/start", {
      body: { username: `crossover${++uniq}`, password: OLD_PW, email },
      headers: { "x-forwarded-for": nextIp() }
    });
    const signupId = /signup=([^;]+)/.exec(started.headers.get("set-cookie") ?? "")![1];
    const code = mail.lastCode(email);
    expired(await verifyReset(`pwresetmail=${signupId}`, code));
    const done = await api("POST", "/api/auth/register/verify", {
      body: { code },
      cookie: `signup=${signupId}`,
      headers: { "x-forwarded-for": nextIp() }
    });
    assert.equal(done.status, 201, "the sign-up still works");
  });
});

describe("things that change between the two steps", () => {
  it("is refused when the member became an admin", async () => {
    const member = await makeMember();
    const { cookie, code } = await begin(member.email);
    await makeAdmin(member.id);
    const res = await verifyReset(cookie, code);
    assert.equal(res.status, 400);
    assert.equal(res.json.expired, true);
    assert.equal((await login(member.username, OLD_PW)).status, 200);
    assert.equal((await pendingFor(member.email)).length, 0);
  });

  it("is refused when the member changed or removed their address", async () => {
    const changed = await makeMember();
    const a = await begin(changed.email);
    await run("UPDATE users SET email = ? WHERE id = ?", [freshEmail(), changed.id]);
    assert.equal((await verifyReset(a.cookie, a.code)).json.expired, true);
    assert.equal((await login(changed.username, OLD_PW)).status, 200);

    const unverified = await makeMember();
    const b = await begin(unverified.email);
    await run("UPDATE users SET email_verified_at = NULL WHERE id = ?", [unverified.id]);
    assert.equal((await verifyReset(b.cookie, b.code)).json.expired, true);
    assert.equal((await login(unverified.username, OLD_PW)).status, 200);
  });

  it("is refused when the account was deleted", async () => {
    const member = await makeMember();
    const { cookie, code } = await begin(member.email);
    const del = await api("POST", "/api/account/delete", { body: { password: OLD_PW }, cookie: member.cookie, headers: { "x-forwarded-for": nextIp() } });
    assert.equal(del.status, 200);
    const res = await verifyReset(cookie, code);
    assert.equal(res.status, 400);
    assert.equal(res.json.expired, true);
  });
});

describe("what gets logged and returned", () => {
  it("logs masked addresses only, never an address, a code or a password", async () => {
    const member = await makeMember();
    const { cookie, code } = await begin(member.email, "log-canary-password-99");
    await verifyReset(cookie, wrongCodeFor(code));
    await verifyReset(cookie, code);
    const unknown = freshEmail();
    await startReset({ email: unknown, newPassword: "log-canary-password-99" });

    const logs = server.logs();
    assert.match(logs, /"event":"email_code_sent"[^\n]*"purpose":"reset"/);
    assert.match(logs, /"event":"email_code_failed"[^\n]*"purpose":"reset"/);
    assert.match(logs, /"event":"password_reset_via_email"/);
    assert.match(logs, /"event":"reset_email_blocked"[^\n]*"reason":"unknown_email"/);
    for (const secret of [member.email, unknown, "log-canary-password-99"]) assert.equal(logs.includes(secret), false, `the logs leaked ${secret}`);
    assert.equal(new RegExp(`\\b${code}\\b`).test(logs), false, "the code must not be logged");
  });
});
