/**
 * POST /api/auth/register/start (email sign-up step 6): sign-up step 1 of 2.
 * Black-box, against the real server in production mode, the REAL resend
 * provider, and a fake Resend (tests/fake-mail.mjs). Every request comes from
 * its own client IP (x-forwarded-for; production trusts one proxy), because
 * the per-IP sign-up limit is 10 an hour.
 */
import { createClient } from "@libsql/client";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { codeMatches } from "../emailCodes.js";
import { maskEmail } from "../emails.js";
import { redact } from "../securityLog.js";
import { makeFakeMail } from "./f2-seed.js";
import { client, startServer, type TestServer } from "./helpers.js";

const NO_MAIL = { EMAIL_PROVIDER: "", EMAIL_API_KEY: "", EMAIL_FROM: "", EMAIL_OUTBOX_DIR: "", ALLOWED_EMAIL_DOMAINS: "" };

let server: TestServer;
let api: ReturnType<typeof client>;
const mail = makeFakeMail();

let ipSeq = 0;
const nextIp = () => `10.20.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

// Each test gets a name and an address nobody used before, so the 60-second
// resend rule (per address) never leaks from one test into another. Both are
// the same length, so equal-shaped responses have equal sizes.
let uniq = 0;
const fresh = () => {
  const n = String(++uniq).padStart(4, "0");
  return { username: `member${n}`, email: `person${n}@example.com`, password: "correct-horse-9", displayName: `Member ${n}` };
};

const start = (api_: ReturnType<typeof client>, body: unknown, ip = nextIp()) =>
  api_("POST", "/api/auth/register/start", { body, headers: { "x-forwarded-for": ip } });

// A fresh connection for every read, like a separate process.
const query = async (srv: TestServer, sql: string, args: (string | number)[] = []) => {
  const c = createClient({ url: srv.dbUrl });
  try {
    return (await c.execute({ sql, args })).rows.map((r) => ({ ...r }));
  } finally {
    c.close();
  }
};
const run = async (srv: TestServer, sql: string, args: (string | number | null)[] = []) => {
  const c = createClient({ url: srv.dbUrl });
  try {
    await c.execute({ sql, args });
  } finally {
    c.close();
  }
};
const pendingFor = (email: string) => query(server, "SELECT * FROM pending_email_codes WHERE email = ?", [email.toLowerCase()]);
const userCount = async (srv: TestServer, username: string) =>
  Number((await query(srv, "SELECT COUNT(*) AS n FROM users WHERE login_username = ?", [username]))[0].n);
const addMember = (srv: TestServer, id: string, username: string, email: string | null) =>
  run(
    srv,
    `INSERT INTO users (id, display_name, login_username, password_hash, email, email_verified_at)
     VALUES (?, ?, ?, 'scrypt$x', ?, ?)`,
    [id, username, username, email, email ? "2026-01-01T00:00:00.000Z" : null]
  );

const signupCookie = (res: { headers: Headers }) => /(?:^|,\s*)signup=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? null;
// The cookie line with its value blanked out, to compare two responses' attributes.
const cookieShape = (res: { headers: Headers }) => (res.headers.get("set-cookie") ?? "").replace(/signup=[^;]+/, "signup=<id>").replace(/Expires=[^;]+/i, "Expires=<date>");

before(async () => {
  server = await startServer({ ...NO_MAIL, ...mail.env });
  process.env.JWT_SECRET = server.secret; // so this process hashes codes the way the server does
  api = client(server);
  await addMember(server, "user-existing", "alice", null);
  await addMember(server, "user-owner", "ownerperson", "owner0001@example.com");
});

after(async () => {
  await server.stop();
  mail.cleanup();
});

describe("a valid start", () => {
  it("answers 200 with only the expiry and the masked address, and binds the browser with an httpOnly cookie", async () => {
    const body = { ...fresh(), email: "New.User@Example.COM" };
    const res = await start(api, body);

    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { expiresInMinutes: 10, maskedEmail: "n***@example.com" });

    const setCookie = res.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /^signup=[a-f0-9]{64};/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Path=\/api\/auth(;|$)/);
    assert.match(setCookie, /Max-Age=600/);
    assert.match(setCookie, /Secure/i);
    assert.equal(res.cookie, null, "no SESSION cookie: nobody is signed in yet");
  });

  it("creates only a pending request: the account does not exist yet, and the password is stored hashed", async () => {
    const body = fresh();
    const res = await start(api, { ...body, email: body.email.toUpperCase() });
    assert.equal(res.status, 200);

    assert.equal(await userCount(server, body.username), 0);
    const rows = await pendingFor(body.email);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.id, signupCookie(res));
    assert.equal(row.purpose, "signup");
    assert.equal(row.email, body.email, "stored lowercase");
    assert.equal(row.username, body.username);
    assert.equal(row.display_name, body.displayName);
    assert.equal(row.user_id, null);
    assert.equal(row.attempts, 0);
    assert.notEqual(row.password_hash, body.password);
    assert.equal(String(row.password_hash).includes(body.password), false);
    const expires = Date.parse(String(row.expires_at)) - Date.now();
    assert.ok(expires > 9 * 60_000 && expires <= 10 * 60_000 + 5000, `expires in ${expires} ms`);
  });

  it("falls back to the username when no display name is given", async () => {
    const body = fresh();
    await start(api, { username: body.username, password: body.password, email: body.email });
    assert.equal((await pendingFor(body.email))[0].display_name, body.username);
  });

  it("sends exactly one mail, to the address, holding the code that the stored hash was made from", async () => {
    const body = fresh();
    const res = await start(api, body);
    const sent = mail.mails(body.email);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].subject, "Your Leeterboard verification code");
    assert.equal(sent[0].from, mail.env.EMAIL_FROM);
    assert.match(sent[0].text, /expires in 10 minutes/);

    const code = mail.lastCode(body.email);
    assert.match(String(code), /^\d{6}$/);
    const row = (await pendingFor(body.email))[0];
    assert.equal(codeMatches(String(signupCookie(res)), String(code), row.code_hash), true);
    assert.equal(codeMatches(String(signupCookie(res)), code === "000000" ? "000001" : "000000", row.code_hash), false);
  });

  it("never puts the pending id or the code in the response body, and logs only the masked address", async () => {
    const body = fresh();
    const res = await start(api, body);
    const id = String(signupCookie(res));
    const code = String(mail.lastCode(body.email));
    assert.equal(res.text.includes(id), false);
    assert.equal(res.text.includes(code), false);
    assert.equal(res.text.includes(body.email), false);

    const logs = server.logs();
    assert.match(logs, new RegExp(`"event":"signup_code_sent"[^\\n]*"maskedEmail":"${maskEmail(body.email).replace(/\*/g, "\\*")}"`));
    for (const secret of [body.email, body.password, id, `${body.username}@`, mail.env.EMAIL_API_KEY]) {
      assert.equal(logs.includes(secret), false, `the logs leaked ${secret}`);
    }
    assert.equal(new RegExp(`\\b${code}\\b`).test(logs), false, "the code must not be logged");
  });
});

describe("what is refused before anything is sent", () => {
  const nothingHappened = async (res: { status: number; headers: Headers }, email: string, username: string, mailsBefore: number) => {
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(mail.mails().length, mailsBefore, "no mail");
    assert.equal((await pendingFor(email)).length, 0, "no pending request");
    assert.equal(await userCount(server, username), 0, "no account");
  };

  it("409s a username that is taken, in any letter case, without mailing anyone", async () => {
    for (const taken of ["alice", "Alice", "ALICE"]) {
      const body = { ...fresh(), username: taken };
      const before = mail.mails().length;
      const res = await start(api, body);
      assert.equal(res.status, 409);
      assert.deepEqual(res.json, { error: "That username is taken." });
      await nothingHappened(res, body.email, "none-such", before);
    }
  });

  it("400s a bad username, password or display-name-less body, with the existing messages", async () => {
    const good = fresh();
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ["no username", { ...good, username: undefined }, /./],
      ["short username", { ...good, username: "a" }, /./],
      ["username with a space", { ...good, username: "bad name" }, /./],
      ["no password", { ...good, password: undefined }, /Password is required/],
      ["short password", { ...good, password: "short" }, /at least 8 characters/],
      ["password equal to the username", { ...good, password: good.username }, /same as your username/]
    ];
    for (const [name, body, message] of cases) {
      const before = mail.mails().length;
      const res = await start(api, body);
      assert.equal(res.status, 400, name);
      assert.match(res.json.error, message, name);
      await nothingHappened(res, good.email, good.username, before);
    }
  });

  it("400s a missing, malformed or hostile email without mailing anyone", async () => {
    const good = fresh();
    const cases: [unknown, string][] = [
      [undefined, "Email is required."],
      ["", "Email is required."],
      [{ a: 1 }, "Email is required."],
      [["x@example.com"], "Email is required."],
      ["not-an-address", "Enter a valid email address."],
      ["a@b", "Enter a valid email address."],
      ["a b@example.com", "Email can't contain spaces or line breaks."],
      [`${good.email}\r\nBcc: victim@example.net`, "Email can't contain spaces or line breaks."],
      ["ä@example.com", "Email addresses with accented or non-Latin characters aren't supported."]
    ];
    for (const [email, message] of cases) {
      const before = mail.mails().length;
      const res = await start(api, { ...good, email });
      assert.equal(res.status, 400, JSON.stringify(email));
      assert.equal(res.json.error, message);
      assert.equal(res.headers.get("set-cookie"), null);
      assert.equal(mail.mails().length, before);
    }
    assert.equal(await userCount(server, good.username), 0);
  });

  it("treats a body that is not an object as an empty one", async () => {
    for (const rawBody of ["null", "[]", '"text"', "42"]) {
      const res = await api("POST", "/api/auth/register/start", { rawBody, headers: { "x-forwarded-for": nextIp() } });
      assert.equal(res.status, 400, rawBody);
    }
  });
});

describe("an address that already has an account is answered exactly like a new one", () => {
  it("same status, same body shape, same cookie attributes, one mail each: a code for the new, a notice for the registered", async () => {
    const brandNew = { ...fresh(), email: "newcomer1@example.com" };
    const registered = { ...fresh(), email: "OWNER0001@Example.com" }; // the same length as the new address, and the owner's, in other letter case

    const a = await start(api, brandNew);
    const b = await start(api, registered);

    assert.equal(a.status, 200);
    assert.equal(b.status, a.status);
    assert.deepEqual(Object.keys(b.json).sort(), Object.keys(a.json).sort());
    assert.equal(b.json.expiresInMinutes, a.json.expiresInMinutes);
    assert.equal(typeof b.json.maskedEmail, typeof a.json.maskedEmail);
    assert.equal(b.json.maskedEmail, "o***@example.com");
    assert.match(String(signupCookie(b)), /^[a-f0-9]{64}$/, "a registered address still gets a binding cookie");
    assert.equal(cookieShape(b), cookieShape(a));
    assert.equal(b.text.length, a.text.length, "the body is the same size");
    assert.deepEqual([...b.headers.keys()].sort(), [...a.headers.keys()].sort());

    // One mail each.
    assert.equal(mail.mails("newcomer1@example.com").length, 1);
    assert.equal(mail.mails("owner0001@example.com").length, 1);
    const code = mail.lastMail("newcomer1@example.com")!;
    const notice = mail.lastMail("owner0001@example.com")!;
    assert.equal(code.subject, "Your Leeterboard verification code");
    assert.match(code.text, /\b\d{6}\b/);
    assert.equal(notice.subject, "About your Leeterboard sign-up");
    assert.equal(/\d/.test(notice.text), false, "the notice carries no code");
    assert.match(notice.text, /already belongs to an account/);
  });

  it("gives the registered address a pending row too (nobody holds its code), so the next step can't tell them apart either", async () => {
    const rows = await pendingFor("owner0001@example.com");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].purpose, "signup");
    assert.equal(rows[0].user_id, null, "not tied to the real member");
    assert.match(String(rows[0].code_hash), /^[0-9a-f]{64}$/);
    // The code behind that hash was never mailed: the only mail the owner got has no digits (checked above).
  });

  it("leaves the existing account untouched", async () => {
    const owner = await query(server, "SELECT login_username, email, password_hash FROM users WHERE id = 'user-owner'");
    assert.equal(owner.length, 1);
    assert.equal(owner[0].login_username, "ownerperson");
    assert.equal(owner[0].email, "owner0001@example.com");
    assert.equal(owner[0].password_hash, "scrypt$x");
    assert.equal(Number((await query(server, "SELECT COUNT(*) AS n FROM users WHERE lower(email) = 'owner0001@example.com'"))[0].n), 1);
  });

  it("applies the same resend wait to a registered address as to a new one", async () => {
    const again = await start(api, { ...fresh(), email: "owner0001@example.com" });
    assert.equal(again.status, 429);
    assert.deepEqual(again.json, { error: "Wait a minute before asking for another code." });
    const brandNew = fresh();
    await start(api, brandNew);
    const againNew = await start(api, { ...fresh(), email: brandNew.email });
    assert.equal(againNew.status, again.status);
    assert.deepEqual(againNew.json, again.json);
    assert.equal(mail.mails("owner0001@example.com").length, 1, "no second notice");
  });

  it("logs the difference where only the operators can see it", () => {
    assert.match(server.logs(), /"event":"signup_notice_sent"[^\n]*"maskedEmail":"o\*\*\*@example\.com"/);
    assert.equal(server.logs().includes("owner0001@example.com"), false);
  });

  it("takes about as long either way (a coarse guard: both do the same work, including hashing the password)", async () => {
    const times = async (registered: boolean) => {
      const out: number[] = [];
      for (let i = 0; i < 5; i++) {
        const body = fresh();
        let email = body.email;
        if (registered) {
          email = `timing${uniq}@example.com`;
          await addMember(server, `user-timing-${uniq}`, `timinguser${uniq}`, email);
        }
        const t0 = performance.now();
        const res = await start(api, { ...body, email });
        out.push(performance.now() - t0);
        assert.equal(res.status, 200);
      }
      return out.sort((x, y) => x - y)[2];
    };
    const newMedian = await times(false);
    const registeredMedian = await times(true);
    assert.ok(Math.abs(newMedian - registeredMedian) < 400, `medians differ too much: new ${newMedian.toFixed(0)} ms, registered ${registeredMedian.toFixed(0)} ms`);
  });
});

describe("the 60-second resend rule", () => {
  it("answers 429 to a second start for the same address, even from another IP and with another username, and changes nothing", async () => {
    const first = fresh();
    const res1 = await start(api, first);
    assert.equal(res1.status, 200);
    const rowBefore = (await pendingFor(first.email))[0];

    const second = { ...fresh(), email: first.email.toUpperCase() };
    const res2 = await start(api, second);
    assert.equal(res2.status, 429);
    assert.deepEqual(res2.json, { error: "Wait a minute before asking for another code." });
    assert.equal(res2.headers.get("set-cookie"), null);

    assert.equal(mail.mails(first.email).length, 1, "no second mail");
    const rowAfter = (await pendingFor(first.email))[0];
    assert.deepEqual(rowAfter, rowBefore, "the first request is untouched");
    assert.equal(await userCount(server, second.username), 0);
  });

  it("lets a new start through once the wait is over, and then only the NEW code works", async () => {
    const body = fresh();
    const res1 = await start(api, body);
    const oldId = String(signupCookie(res1));
    const oldCode = String(mail.lastCode(body.email));

    // Pretend the first code went out two minutes ago, and some wrong guesses were made.
    await run(server, "UPDATE pending_email_codes SET last_sent_at = ?, attempts = 3 WHERE email = ?", [new Date(Date.now() - 120_000).toISOString(), body.email]);

    const res2 = await start(api, { ...fresh(), email: body.email });
    assert.equal(res2.status, 200);
    const newId = String(signupCookie(res2));
    assert.notEqual(newId, oldId);
    assert.equal(mail.mails(body.email).length, 2);

    const rows = await pendingFor(body.email);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, newId);
    assert.equal(rows[0].attempts, 0, "the counter starts again");
    assert.equal((await query(server, "SELECT 1 FROM pending_email_codes WHERE id = ?", [oldId])).length, 0, "the old id is gone");

    const newCode = String(mail.lastCode(body.email));
    assert.equal(codeMatches(newId, newCode, rows[0].code_hash), true);
    assert.equal(codeMatches(newId, oldCode, rows[0].code_hash), newCode === oldCode, "the old code does not open the new request");
    assert.equal(codeMatches(oldId, oldCode, rows[0].code_hash), false);
  });

  it("holds up under a burst: of many parallel starts for one address exactly one goes through and one mail is sent", async () => {
    const email = fresh().email;
    const results = await Promise.all(Array.from({ length: 6 }, () => start(api, { ...fresh(), email })));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal(results.filter((r) => r.status === 429).length, 5);
    assert.equal(mail.mails(email).length, 1);
    assert.equal((await pendingFor(email)).length, 1);
  });

  it("does not hold up a different address", async () => {
    const a = fresh();
    const b = fresh();
    assert.equal((await start(api, a)).status, 200);
    assert.equal((await start(api, b)).status, 200);
  });
});

describe("old pending requests", () => {
  it("are cleaned up when a new start comes in", async () => {
    await run(
      server,
      `INSERT INTO pending_email_codes (id, purpose, email, code_hash, created_at, last_sent_at, expires_at)
       VALUES ('stale-row', 'signup', 'stale@example.com', 'x', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', '2020-01-01T00:10:00.000Z')`
    );
    assert.equal((await pendingFor("stale@example.com")).length, 1);
    assert.equal((await start(api, fresh())).status, 200);
    assert.equal((await pendingFor("stale@example.com")).length, 0);
  });
});

describe("when the mail provider fails", () => {
  it("answers 503, leaves no pending request and no cookie, logs the failure without the address, and lets an immediate retry through", async () => {
    const body = fresh();
    const mailsBefore = mail.mails().length;
    mail.setDown(true);
    try {
      const res = await start(api, body);
      assert.equal(res.status, 503);
      assert.deepEqual(res.json, { error: "We couldn't send the email right now. Please try again in a few minutes." });
      assert.equal(res.headers.get("set-cookie"), null);
      assert.equal((await pendingFor(body.email)).length, 0, "no row left to block a retry");
      assert.equal(mail.mails().length, mailsBefore);
      assert.match(server.logs(), /"event":"mail_send_failed"[^\n]*"provider":"resend"[^\n]*"kind":"rejected"[^\n]*"status":500/);
    } finally {
      mail.setDown(false);
    }
    const retry = await start(api, body);
    assert.equal(retry.status, 200, "no resend wait after a mail that never left");
    assert.equal(mail.mails(body.email).length, 1);
  });

  it("answers a registered address the same way when the provider is down, and leaves no request behind", async () => {
    const body = fresh();
    await addMember(server, `user-down-${uniq}`, `downowner${uniq}`, body.email);
    mail.setDown(true);
    try {
      const res = await start(api, body);
      assert.equal(res.status, 503);
      assert.equal(res.json.error, "We couldn't send the email right now. Please try again in a few minutes.");
      assert.equal(res.headers.get("set-cookie"), null);
      assert.equal((await pendingFor(body.email)).length, 0);
    } finally {
      mail.setDown(false);
    }
    assert.equal((await start(api, body)).status, 200, "and it can be retried at once");
  });

  it("reports a refused sender (HTTP 422) the same way, and never logs the key or an address", async () => {
    const body = fresh();
    mail.setRejecting(true);
    try {
      const res = await start(api, body);
      assert.equal(res.status, 503);
      assert.match(server.logs(), /"event":"mail_send_failed"[^\n]*"status":422/);
    } finally {
      mail.setRejecting(false);
    }
    for (const secret of [body.email, mail.env.EMAIL_API_KEY]) assert.equal(server.logs().includes(secret), false);
  });
});

describe("restricting sign-up to some email domains", () => {
  let restricted: TestServer;
  let restrictedApi: ReturnType<typeof client>;
  const restrictedMail = makeFakeMail();

  before(async () => {
    restricted = await startServer({ ...NO_MAIL, ...restrictedMail.env, ALLOWED_EMAIL_DOMAINS: "School.edu, @uni.ma" });
    restrictedApi = client(restricted);
  });
  after(async () => {
    await restricted.stop();
    restrictedMail.cleanup();
  });

  it("says so at boot", () => {
    assert.match(restricted.logs(), /\[Config\] Sign-up is limited to email addresses at: school\.edu, uni\.ma/);
  });

  it("accepts a listed domain in any letter case, and mails it", async () => {
    for (const email of ["Student1@SCHOOL.edu", "student2@uni.ma"]) {
      const res = await start(restrictedApi, { ...fresh(), email });
      assert.equal(res.status, 200, email);
      assert.equal(restrictedMail.mails(email).length, 1);
    }
  });

  it("refuses any other domain, a subdomain and a look-alike, with no mail and no pending request", async () => {
    for (const email of ["a@gmail.com", "a@mail.school.edu", "a@notschool.edu", "a@school.edu.evil.com", "a@school.edux"]) {
      const body = { ...fresh(), email };
      const res = await start(restrictedApi, body);
      assert.equal(res.status, 400, email);
      assert.equal(res.json.error, "Sign-up is limited to email addresses from approved domains.");
      assert.equal(res.headers.get("set-cookie"), null);
    }
    assert.equal(restrictedMail.mails().length, 2, "only the two accepted ones were mailed");
    assert.equal(Number((await query(restricted, "SELECT COUNT(*) AS n FROM pending_email_codes"))[0].n), 2);
  });
});

describe("when e-mail is not configured", () => {
  let bare: TestServer;
  before(async () => {
    bare = await startServer({ ...NO_MAIL });
  });
  after(() => bare.stop());

  it("answers 503 instead of accepting a sign-up nobody could verify, and logs it", async () => {
    const body = fresh();
    const res = await start(client(bare), body);
    assert.equal(res.status, 503);
    assert.deepEqual(res.json, { error: "Sign-up is temporarily unavailable. Please try again later." });
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(Number((await query(bare, "SELECT COUNT(*) AS n FROM pending_email_codes"))[0].n), 0);
    assert.equal(await userCount(bare, body.username), 0);
    assert.match(bare.logs(), /"event":"mail_unconfigured"[^\n]*"route":"register\/start"/);
    assert.equal(bare.logs().includes(body.email), false);
  });
});

describe("log redaction", () => {
  it("hides a field named email, and keeps the masked form that is safe to log", () => {
    const out = redact({ email: "a@example.com", maskedEmail: "a***@example.com", code: "123456", ip: "1.2.3.4" });
    assert.equal(out.email, "[redacted]");
    assert.equal(out.code, "[redacted]");
    assert.equal(out.maskedEmail, "a***@example.com");
    assert.equal(out.ip, "1.2.3.4");
  });
});
