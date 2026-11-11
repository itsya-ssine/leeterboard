/**
 * Per-address limit on verification mails (email sign-up step 8): 3 code
 * requests an hour per e-mail address, however many IPs ask, counted before
 * anything is sent and identically for a registered address, keyed on a keyed
 * hash so the address never reaches the rate_limits table.
 *
 * Black-box against the real server in production mode and a fake Resend.
 * Every request comes from its own client IP so the per-IP limit (10 an hour)
 * is never the thing under test.
 */
import { createClient } from "@libsql/client";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { emailLimitKey } from "../emailCodes.js";
import { makeFakeMail } from "./f2-seed.js";
import { client, startServer, type ApiResult, type TestServer } from "./helpers.js";

const NO_MAIL = { EMAIL_PROVIDER: "", EMAIL_API_KEY: "", EMAIL_FROM: "", EMAIL_OUTBOX_DIR: "", ALLOWED_EMAIL_DOMAINS: "" };
const LIMIT_MESSAGE = "Too many codes were requested for this address. Please try again later.";

let server: TestServer;
let api: ReturnType<typeof client>;
const mail = makeFakeMail();

let ipSeq = 0;
const nextIp = () => `10.40.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
let uniq = 0;
const fresh = () => {
  const n = String(++uniq).padStart(4, "0");
  return { username: `member${n}`, email: `person${n}@example.com`, password: "correct-horse-9" };
};

const query = async (sql: string, args: (string | number)[] = []) => {
  const c = createClient({ url: server.dbUrl });
  try {
    return (await c.execute({ sql, args })).rows.map((r) => ({ ...r }));
  } finally {
    c.close();
  }
};
const run = async (sql: string, args: (string | number)[] = []) => {
  const c = createClient({ url: server.dbUrl });
  try {
    await c.execute({ sql, args });
  } finally {
    c.close();
  }
};

const start = (body: Record<string, unknown>) =>
  api("POST", "/api/auth/register/start", { body, headers: { "x-forwarded-for": nextIp() } });

// The 60-second resend wait is a separate rule; move the stored clock past it
// so these tests can ask again at once.
const skipResendWait = (email: string) =>
  run("UPDATE pending_email_codes SET last_sent_at = ? WHERE email = ?", [new Date(Date.now() - 61_000).toISOString(), email.toLowerCase()]);

const shape = (res: ApiResult) => ({ status: res.status, json: res.json });

before(async () => {
  server = await startServer({ ...NO_MAIL, ...mail.env });
  process.env.JWT_SECRET = server.secret;
  api = client(server);
  await run(
    `INSERT INTO users (id, display_name, login_username, password_hash, email, email_verified_at)
     VALUES ('user-owner', 'owner', 'ownerperson', 'scrypt$x', 'owner0001@example.com', '2026-01-01T00:00:00.000Z')`
  );
});

after(async () => {
  await server.stop();
  mail.cleanup();
});

describe("emailLimitKey", () => {
  it("is a 64-digit hex string that does not contain the address", () => {
    const key = emailLimitKey("Someone@Example.com");
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.equal(key.includes("someone"), false);
  });

  it("is the same for every spelling of an address and different for different addresses", () => {
    assert.equal(emailLimitKey("Someone@Example.com"), emailLimitKey("  someone@example.COM "));
    assert.notEqual(emailLimitKey("someone@example.com"), emailLimitKey("someone2@example.com"));
  });

  it("depends on the server secret, so a copy of the table can't be used to test guesses", () => {
    const before = emailLimitKey("someone@example.com");
    const secret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "z".repeat(48);
    try {
      assert.notEqual(emailLimitKey("someone@example.com"), before);
    } finally {
      process.env.JWT_SECRET = secret;
    }
  });

  it("refuses an empty address", () => {
    assert.throws(() => emailLimitKey(""), TypeError);
  });
});

describe("3 code requests an hour per address", () => {
  it("lets three through, from three different IPs and with three different usernames, and 429s the fourth without mailing", async () => {
    const { email, password } = fresh();
    for (let n = 1; n <= 3; n++) {
      const res = await start({ username: `multi_${uniq}_${n}`, password, email });
      assert.equal(res.status, 200, `request ${n}`);
      await skipResendWait(email);
    }
    assert.equal(mail.mails(email).length, 3);

    const before = (await query("SELECT * FROM pending_email_codes WHERE email = ?", [email]))[0];
    const fourth = await start({ username: `multi_${uniq}_4`, password, email });
    assert.equal(fourth.status, 429);
    assert.deepEqual(fourth.json, { error: LIMIT_MESSAGE });
    assert.equal(fourth.headers.get("set-cookie"), null, "no cookie for a request that was refused");
    assert.equal(mail.mails(email).length, 3, "no fourth mail");
    assert.deepEqual((await query("SELECT * FROM pending_email_codes WHERE email = ?", [email]))[0], before, "the open request is untouched");
  });

  it("counts every spelling of the address as the same one", async () => {
    const { email, password } = fresh();
    const spellings = [email, email.toUpperCase(), ` ${email[0].toUpperCase()}${email.slice(1)} `];
    for (const [n, spelled] of spellings.entries()) {
      assert.equal((await start({ username: `case_${uniq}_${n}`, password, email: spelled })).status, 200);
      await skipResendWait(email);
    }
    const res = await start({ username: `case_${uniq}_x`, password, email: email.toUpperCase() });
    assert.equal(res.status, 429);
    assert.equal(res.json.error, LIMIT_MESSAGE);
  });

  it("does not hold up a different address", async () => {
    const a = fresh();
    for (let n = 1; n <= 3; n++) {
      await start({ username: `${a.username}_${n}`, password: a.password, email: a.email });
      await skipResendWait(a.email);
    }
    assert.equal((await start({ ...a, username: `${a.username}_x` })).status, 429);
    const b = fresh();
    assert.equal((await start(b)).status, 200);
  });

  it("answers a registered address exactly like a new one, at every step and at the limit", async () => {
    const fake = { ...fresh(), email: "owner0001@example.com" };
    const real = fresh();
    for (let n = 1; n <= 3; n++) {
      const [a, b] = [
        await start({ username: `${fake.username}_${n}`, password: fake.password, email: fake.email }),
        await start({ username: `${real.username}_${n}`, password: real.password, email: real.email })
      ];
      assert.equal(a.status, b.status, `request ${n}`);
      assert.deepEqual(Object.keys(a.json).sort(), Object.keys(b.json).sort());
      await skipResendWait(fake.email);
      await skipResendWait(real.email);
    }
    const [a, b] = [
      await start({ username: `${fake.username}_4`, password: fake.password, email: fake.email }),
      await start({ username: `${real.username}_4`, password: real.password, email: real.email })
    ];
    assert.deepEqual(shape(a), shape(b));
    assert.equal(a.status, 429);
    assert.equal(mail.mails(fake.email).length, 3, "the owner got three notices and no fourth");
    assert.equal(mail.mails(real.email).length, 3);
  });

  it("is not used up by a taken username (nothing was going to be sent)", async () => {
    const { email, password } = fresh();
    for (let n = 1; n <= 5; n++) {
      const res = await start({ username: "ownerperson", password, email });
      assert.equal(res.status, 409);
    }
    assert.equal((await start({ username: `free_${uniq}`, password, email })).status, 200);
  });

  it("logs email_rate_limited with the masked address only", async () => {
    const { email, password } = fresh();
    for (let n = 1; n <= 3; n++) {
      await start({ username: `${email.slice(0, 10)}_${n}`, password, email });
      await skipResendWait(email);
    }
    await start({ username: `${email.slice(0, 10)}_4`, password, email });
    const logs = server.logs();
    assert.match(logs, /"event":"email_rate_limited"[^\n]*"maskedEmail":"p\*\*\*@example\.com"/);
    assert.equal(logs.includes(email), false, "the address must not be logged");
  });
});

describe("what does not use up the three", () => {
  it("an early Resend click (the 60-second wait) costs nothing", async () => {
    const { email, password, username } = fresh();
    assert.equal((await start({ username, password, email })).status, 200);
    // Five impatient clicks, each refused by the resend wait.
    for (let n = 1; n <= 5; n++) {
      const res = await start({ username, password, email });
      assert.equal(res.status, 429);
      assert.equal(res.json.error, "Wait a minute before asking for another code.");
    }
    // Two real requests are still available after the first.
    await skipResendWait(email);
    assert.equal((await start({ username, password, email })).status, 200);
    await skipResendWait(email);
    assert.equal((await start({ username, password, email })).status, 200);
    await skipResendWait(email);
    assert.equal((await start({ username, password, email })).status, 429);
    assert.equal(mail.mails(email).length, 3);
  });

  it("a mail provider outage costs nothing", async () => {
    const { email, password, username } = fresh();
    mail.setDown(true);
    try {
      for (let n = 1; n <= 5; n++) assert.equal((await start({ username, password, email })).status, 503);
    } finally {
      mail.setDown(false);
    }
    for (let n = 1; n <= 3; n++) {
      assert.equal((await start({ username, password, email })).status, 200, `request ${n}`);
      await skipResendWait(email);
    }
    assert.equal((await start({ username, password, email })).status, 429);
  });

  it("an address refused for its domain or shape never reaches the counter", async () => {
    const { password, username } = fresh();
    for (let n = 1; n <= 5; n++) assert.equal((await start({ username, password, email: "no-at-sign" })).status, 400);
    assert.equal((await query("SELECT COUNT(*) AS n FROM rate_limits WHERE key LIKE 'email-signup:%no-at-sign%'"))[0].n, 0);
  });
});

describe("what the counter stores", () => {
  it("is keyed on the hash of the address: no address, local part or domain in the rate_limits table", async () => {
    const { email, password, username } = fresh();
    await start({ username, password, email });
    const rows = await query("SELECT key, hits FROM rate_limits WHERE key LIKE 'email-signup:%'");
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.match(String(row.key), /^email-signup:[0-9a-f]{64}$/);
      assert.equal(String(row.key).includes("example"), false);
    }
    const mine = rows.find((r) => r.key === `email-signup:${emailLimitKey(email)}`);
    assert.ok(mine, "the counter is under the key the server derives");
    assert.equal(Number(mine!.hits), 1);
  });

  it("does not hold the address anywhere else it didn't before: the log and the response stay clean", async () => {
    const { email, password, username } = fresh();
    const res = await start({ username, password, email });
    assert.equal(res.text.includes(email), false);
    assert.equal(server.logs().includes(email), false);
  });
});
