/**
 * POST /api/auth/register/verify (email sign-up step 7): sign-up step 2 of 2.
 * Black-box, against the real server in production mode, the REAL resend
 * provider, and a fake Resend (tests/fake-mail.mjs). Every request comes from
 * its own client IP (x-forwarded-for; production trusts one proxy), because
 * the per-IP limits are 10 starts an hour and 20 verifications per 15 minutes.
 */
import { createClient } from "@libsql/client";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { makeFakeMail } from "./f2-seed.js";
import { client, startServer, type ApiResult, type TestServer } from "./helpers.js";

const NO_MAIL = { EMAIL_PROVIDER: "", EMAIL_API_KEY: "", EMAIL_FROM: "", EMAIL_OUTBOX_DIR: "", ALLOWED_EMAIL_DOMAINS: "" };

let server: TestServer;
let api: ReturnType<typeof client>;
const mail = makeFakeMail();

let ipSeq = 0;
const nextIp = () => `10.30.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

let uniq = 0;
const fresh = () => {
  const n = String(++uniq).padStart(4, "0");
  return { username: `member${n}`, email: `person${n}@example.com`, password: "correct-horse-9", displayName: `Member ${n}` };
};

const query = async (sql: string, args: (string | number)[] = []) => {
  const c = createClient({ url: server.dbUrl });
  try {
    return (await c.execute({ sql, args })).rows.map((r) => ({ ...r }));
  } finally {
    c.close();
  }
};
const run = async (sql: string, args: (string | number | null)[] = []) => {
  const c = createClient({ url: server.dbUrl });
  try {
    await c.execute({ sql, args });
  } finally {
    c.close();
  }
};
const pendingFor = (email: string) => query("SELECT * FROM pending_email_codes WHERE email = ?", [email.toLowerCase()]);
const userByName = (username: string) => query("SELECT * FROM users WHERE login_username = ?", [username]);
const addMember = (id: string, username: string, email: string | null) =>
  run(
    `INSERT INTO users (id, display_name, login_username, password_hash, email, email_verified_at)
     VALUES (?, ?, ?, 'scrypt$x', ?, ?)`,
    [id, username, username, email, email ? "2026-01-01T00:00:00.000Z" : null]
  );

const cookieOf = (res: ApiResult) => /(?:^|,\s*)signup=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? null;

interface Begun {
  body: ReturnType<typeof fresh>;
  cookie: string; // "signup=<id>", as a browser would send it
  id: string;
  code: string; // what the mail said (null for an address that was already registered: the owner got a notice)
}

// Step 1 for a brand-new address: returns what the browser and the inbox now hold.
async function begin(overrides: Partial<ReturnType<typeof fresh>> = {}): Promise<Begun> {
  const body = { ...fresh(), ...overrides };
  const res = await api("POST", "/api/auth/register/start", { body, headers: { "x-forwarded-for": nextIp() } });
  assert.equal(res.status, 200, res.text);
  const id = cookieOf(res)!;
  return { body, cookie: `signup=${id}`, id, code: mail.lastCode(body.email) as string };
}

const verify = (cookie: string | null, code: unknown, ip = nextIp()) =>
  api("POST", "/api/auth/register/verify", { body: { code }, cookie, headers: { "x-forwarded-for": ip } });

const wrongCodeFor = (code: string) => (code === "000000" ? "000001" : "000000");
const clearsSignupCookie = (res: ApiResult) => /signup=;[^,]*(Expires=Thu, 01 Jan 1970|Max-Age=0)/i.test(res.headers.get("set-cookie") ?? "");

before(async () => {
  server = await startServer({ ...NO_MAIL, ...mail.env });
  api = client(server);
  await addMember("user-owner", "ownerperson", "owner0001@example.com");
});

after(async () => {
  await server.stop();
  mail.cleanup();
});

describe("the right code", () => {
  it("creates the member, signs them in and answers 201 with the member and no address", async () => {
    const b = await begin({ email: "New.Person@Example.COM" });
    assert.equal((await userByName(b.body.username)).length, 0, "no account before verify");

    const res = await verify(b.cookie, b.code);
    assert.equal(res.status, 201, res.text);
    assert.ok(res.cookie, "a session cookie was set");
    assert.equal(res.json.loginUsername, b.body.username);
    assert.equal(res.json.displayName, b.body.displayName);
    assert.equal(res.json.leetcodeLinked, false);
    assert.equal(res.json.isAdmin, false);
    assert.equal("email" in res.json, false);
    assert.equal(res.text.toLowerCase().includes("new.person@example.com"), false);
    assert.doesNotMatch(res.text, /scrypt|passwordHash|password_hash/i);
    assert.equal(clearsSignupCookie(res), true, "the signup cookie is cleared");
  });

  it("stores the address lowercase and verified, and the password hash made at the start", async () => {
    const b = await begin({ email: "Mixed.Case@Example.COM" });
    const hashAtStart = String((await pendingFor(b.body.email))[0].password_hash);
    const res = await verify(b.cookie, b.code);
    assert.equal(res.status, 201);

    const row = (await userByName(b.body.username))[0];
    assert.equal(row.email, "mixed.case@example.com");
    assert.ok(Date.parse(String(row.email_verified_at)) > Date.now() - 60_000);
    assert.equal(row.password_hash, hashAtStart);
    assert.equal(row.leetcode_username, null);
  });

  it("gives a working session, and /api/users answers 200", async () => {
    const b = await begin();
    const res = await verify(b.cookie, b.code);
    const session = await api("GET", "/api/auth/session", { cookie: res.cookie });
    assert.equal(session.json.status, "authenticated");
    assert.equal(session.json.user.id, res.json.id);
    const users = await api("GET", "/api/users", { cookie: res.cookie });
    assert.equal(users.status, 200);
    assert.equal(users.text.toLowerCase().includes(b.body.email), false, "/api/users never carries the address");
  });

  it("lets the new member sign in again with the password they chose", async () => {
    const b = await begin();
    assert.equal((await verify(b.cookie, b.code)).status, 201);
    const login = await api("POST", "/api/auth/login", {
      body: { username: b.body.username, password: b.body.password },
      headers: { "x-forwarded-for": nextIp() }
    });
    assert.equal(login.status, 200);
  });

  it("accepts the code the way people paste it, with a space or a hyphen in the middle", async () => {
    const b = await begin();
    const res = await verify(b.cookie, `${b.code.slice(0, 3)} ${b.code.slice(3)}`);
    assert.equal(res.status, 201, res.text);
    const c = await begin();
    assert.equal((await verify(c.cookie, `${c.code.slice(0, 3)}-${c.code.slice(3)}`)).status, 201);
  });

  it("removes the pending request, and is single use", async () => {
    const b = await begin();
    assert.equal((await verify(b.cookie, b.code)).status, 201);
    assert.equal((await pendingFor(b.body.email)).length, 0);

    const again = await verify(b.cookie, b.code);
    assert.equal(again.status, 400);
    assert.equal(again.json.expired, true);
    assert.equal(again.cookie, null, "no second session");
    assert.equal((await userByName(b.body.username)).length, 1);
  });

  it("lets exactly one of two simultaneous verifications win", async () => {
    const b = await begin();
    const [x, y] = await Promise.all([verify(b.cookie, b.code), verify(b.cookie, b.code)]);
    assert.deepEqual([x.status, y.status].sort(), [201, 400]);
    assert.equal((await userByName(b.body.username)).length, 1);
  });

  it("logs account_created with the masked address only", async () => {
    const b = await begin();
    await verify(b.cookie, b.code);
    const logs = server.logs();
    const line = logs.split("\n").find((l) => l.includes('"event":"account_created"') && l.includes(b.body.username));
    assert.ok(line, "account_created was logged");
    assert.equal(JSON.parse(line!).maskedEmail, "p***@example.com");
    for (const secret of [b.body.email, b.body.password, b.id]) assert.equal(logs.includes(secret), false, `the logs leaked ${secret}`);
    assert.equal(new RegExp(`\\b${b.code}\\b`).test(logs), false, "the code must not be logged");
  });
});

describe("a wrong code", () => {
  it("answers 400 with a generic message, counts the try and creates nothing", async () => {
    const b = await begin();
    const res = await verify(b.cookie, wrongCodeFor(b.code));
    assert.equal(res.status, 400);
    assert.deepEqual(res.json, { error: "That code isn't right. Check it and try again." });
    assert.equal(res.cookie, null);
    assert.equal(Number((await pendingFor(b.body.email))[0].attempts), 1);
    assert.equal((await userByName(b.body.username)).length, 0);
  });

  it("treats malformed input as a wrong code (counted, never a server error)", async () => {
    for (const code of ["", "12345", "1234567", "abcdef", "١٢٣٤٥٦", 123456, null, undefined, { a: 1 }, ["123456"]]) {
      const b = await begin();
      const res = await verify(b.cookie, code);
      assert.equal(res.status, 400, JSON.stringify(code));
      assert.equal(Number((await pendingFor(b.body.email))[0].attempts), 1, `counted: ${JSON.stringify(code)}`);
      assert.equal((await userByName(b.body.username)).length, 0);
    }
  });

  it("locks after 5 wrong tries: 429, the request is deleted, and the right code is then refused", async () => {
    const b = await begin();
    const wrong = wrongCodeFor(b.code);
    for (let n = 1; n <= 4; n++) assert.equal((await verify(b.cookie, wrong)).status, 400, `try ${n}`);

    const fifth = await verify(b.cookie, wrong);
    assert.equal(fifth.status, 429);
    assert.equal(fifth.json.expired, true);
    assert.equal(clearsSignupCookie(fifth), true);
    assert.equal((await pendingFor(b.body.email)).length, 0, "the request is deleted");

    const right = await verify(b.cookie, b.code);
    assert.equal(right.status, 400);
    assert.equal(right.json.expired, true);
    assert.equal(right.cookie, null);
    assert.equal((await userByName(b.body.username)).length, 0);
  });

  it("still accepts the right code on the 5th try when the first four were wrong", async () => {
    const b = await begin();
    for (let n = 1; n <= 4; n++) assert.equal((await verify(b.cookie, wrongCodeFor(b.code))).status, 400);
    assert.equal((await verify(b.cookie, b.code)).status, 201);
  });

  it("can't be beaten by guessing in parallel: at most 5 tries are ever compared", async () => {
    const b = await begin();
    // Ten simultaneous tries, one of them right. At most five are counted, so
    // the right one only wins if it was among the first five.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => verify(b.cookie, i === 9 ? b.code : wrongCodeFor(b.code)))
    );
    const created = results.filter((r) => r.status === 201).length;
    assert.ok(created <= 1, "never two accounts");
    assert.equal((await userByName(b.body.username)).length, created);
    assert.equal((await pendingFor(b.body.email)).length, 0, "the request is gone either way");
  });

  it("logs signup_code_failed and signup_code_locked with the masked address, never the code or the address", async () => {
    const b = await begin();
    const wrong = wrongCodeFor(b.code);
    for (let n = 1; n <= 5; n++) await verify(b.cookie, wrong);
    const logs = server.logs();
    assert.match(logs, /"event":"signup_code_failed"[^\n]*"maskedEmail":"p\*\*\*@example\.com"/);
    assert.match(logs, /"event":"signup_code_locked"[^\n]*"maskedEmail":"p\*\*\*@example\.com"/);
    assert.equal(logs.includes(b.body.email), false);
    assert.equal(new RegExp(`\\b${wrong}\\b`).test(logs), false, "the guess must not be logged");
  });
});

describe("a request that is missing, unknown or expired", () => {
  const expired = (res: ApiResult) => {
    assert.equal(res.status, 400);
    assert.deepEqual(res.json, { error: "This sign-up has expired. Please start again.", expired: true });
    assert.equal(res.cookie, null);
  };

  it("400s without a cookie, with a malformed cookie and with an id nobody holds", async () => {
    expired(await verify(null, "123456"));
    expired(await verify("signup=nope", "123456"));
    expired(await verify(`signup=${"a".repeat(64)}`, "123456"));
  });

  it("400s once the 10 minutes are over, even with the right code, and deletes the row", async () => {
    const b = await begin();
    await run("UPDATE pending_email_codes SET expires_at = ? WHERE id = ?", [new Date(Date.now() - 1000).toISOString(), b.id]);
    const res = await verify(b.cookie, b.code);
    expired(res);
    assert.equal(clearsSignupCookie(res), true);
    assert.equal((await pendingFor(b.body.email)).length, 0);
    assert.equal((await userByName(b.body.username)).length, 0);
  });

  it("refuses the old code after a resend replaced the request", async () => {
    const b = await begin();
    // The resend cooldown is 60 seconds; move the clock on the stored row instead of waiting.
    await run("UPDATE pending_email_codes SET last_sent_at = ? WHERE id = ?", [new Date(Date.now() - 61_000).toISOString(), b.id]);
    const res = await api("POST", "/api/auth/register/start", { body: b.body, headers: { "x-forwarded-for": nextIp() } });
    assert.equal(res.status, 200);
    const newCookie = `signup=${cookieOf(res)}`;
    assert.notEqual(newCookie, b.cookie);

    expired(await verify(b.cookie, b.code));
    assert.equal((await verify(newCookie, mail.lastCode(b.body.email))).status, 201);
  });

  it("does not take a code from the request body in place of the cookie", async () => {
    const b = await begin();
    const res = await api("POST", "/api/auth/register/verify", {
      body: { code: b.code, pendingId: b.id, id: b.id },
      headers: { "x-forwarded-for": nextIp() }
    });
    expired(res);
    assert.equal((await userByName(b.body.username)).length, 0);
  });
});

describe("things that change between the two steps", () => {
  it("409s when the username was taken in the meantime, and consumes the request", async () => {
    const b = await begin();
    await addMember(`user-${b.body.username}`, b.body.username, null);
    const res = await verify(b.cookie, b.code);
    assert.equal(res.status, 409);
    assert.match(res.json.error, /username/i);
    assert.equal(res.cookie, null, "no session for someone else's account");
    assert.equal((await pendingFor(b.body.email)).length, 0);
    assert.equal((await userByName(b.body.username)).length, 1, "only the member who was already there");
    assert.equal(clearsSignupCookie(res), true);
  });

  it("ends like an expired request, saying nothing about it, when the address was registered meanwhile", async () => {
    const b = await begin();
    await addMember(`user-${b.body.username}-other`, `other${b.body.username}`, b.body.email);
    const res = await verify(b.cookie, b.code);
    assert.equal(res.status, 400);
    assert.deepEqual(res.json, { error: "This sign-up has expired. Please start again.", expired: true });
    assert.equal(res.cookie, null);
    assert.equal((await userByName(b.body.username)).length, 0);
    assert.equal((await pendingFor(b.body.email)).length, 0);
    assert.equal(res.text.includes(b.body.email), false);
  });
});

describe("an address that was already registered", () => {
  it("fails like a wrong guess for any code, and locks the same way as a real request", async () => {
    // owner0001@example.com belongs to ownerperson (see before()).
    const fake = await begin({ email: "owner0001@example.com" });
    const real = await begin();

    const tries = async (b: Begun) => {
      const out: { status: number; body: string }[] = [];
      for (let n = 1; n <= 5; n++) {
        const res = await verify(b.cookie, wrongCodeFor(b.code));
        out.push({ status: res.status, body: JSON.stringify(res.json) });
      }
      return out;
    };
    assert.deepEqual(await tries(fake), await tries(real), "same statuses and bodies, try by try");

    // The code that was never mailed can't succeed: the owner got a notice, not a code.
    const owner = mail.lastMail("owner0001@example.com")!;
    assert.doesNotMatch(owner.text, /\b\d{6}\b/);
    assert.equal(fake.code, null, "no code was ever mailed to the owner");
    assert.equal((await userByName(fake.body.username)).length, 0);
  });

  it("never signs anyone in, whatever code is sent", async () => {
    const fake = await begin({ email: "owner0001@example.com" });
    for (const code of ["000000", "123456", fake.code, undefined]) {
      const res = await verify(fake.cookie, code);
      assert.notEqual(res.status, 201);
      assert.equal(res.cookie, null);
    }
    assert.equal((await query("SELECT COUNT(*) AS n FROM users WHERE lower(email) = 'owner0001@example.com'"))[0].n, 1);
  });
});

describe("the old one-step sign-up", () => {
  it("is gone: POST /api/auth/register answers 404 and creates nothing", async () => {
    const body = fresh();
    const res = await api("POST", "/api/auth/register", { body, headers: { "x-forwarded-for": nextIp() } });
    assert.equal(res.status, 404);
    assert.equal(res.cookie, null);
    assert.equal((await userByName(body.username)).length, 0);
  });
});
