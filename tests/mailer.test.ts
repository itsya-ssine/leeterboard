/**
 * mailer.ts (email sign-up step 4): the configuration policy, the Resend and
 * outbox providers, and the promises about what never reaches an error or a log.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  assertMailConfigAtBoot,
  createMailer,
  decideMail,
  MailError,
  parseSender,
  RESEND_URL,
  type MailConfig
} from "../mailer.js";

const KEY = "re_super_secret_key_123";
const FROM = "Leeterboard <no-reply@example.com>";
const RESEND_ENV = { NODE_ENV: "production", EMAIL_PROVIDER: "resend", EMAIL_API_KEY: KEY, EMAIL_FROM: FROM };
const RESEND: MailConfig = { provider: "resend", apiKey: KEY, from: FROM };
const MSG = { to: "Alice@Example.com", subject: "Your Leeterboard code", text: "Your code is 123456.\nIt expires in 10 minutes." };

const tmpDirs: string[] = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-mailer-"));
  tmpDirs.push(dir);
  return dir;
};
after(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

// A stand-in for fetch that records calls and answers as told.
function stubFetch(answer: () => Response | Promise<Response> | never) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer();
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const ok = () => new Response('{"id":"abc"}', { status: 200 });

const rejection = async (promise: Promise<unknown>): Promise<MailError> => {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof MailError, `expected a MailError, got ${String(err)}`);
    return err;
  }
  assert.fail("expected the send to be refused");
};

describe("decideMail: what the environment says", () => {
  it("is unconfigured, not fatal, when EMAIL_PROVIDER is missing, and says so loudly in production", () => {
    const d = decideMail({ NODE_ENV: "production" });
    assert.equal(d.config, null);
    assert.equal(d.fatal, null);
    assert.match(d.warnings.join(" "), /NOT configured/);
    assert.match(d.warnings.join(" "), /503/);
  });

  it("points a developer at the outbox provider when nothing is set", () => {
    const d = decideMail({});
    assert.equal(d.config, null);
    assert.match(d.warnings.join(" "), /EMAIL_PROVIDER=outbox/);
  });

  it("accepts resend with a key and a sender, whatever the letter case or spacing of the provider", () => {
    for (const provider of ["resend", " Resend ", "RESEND"]) {
      const d = decideMail({ ...RESEND_ENV, EMAIL_PROVIDER: provider });
      assert.deepEqual(d.config, RESEND);
      assert.equal(d.fatal, null);
      assert.deepEqual(d.warnings, []);
    }
  });

  it("is unconfigured when the key or the sender is missing, naming the variable but never its value", () => {
    const noKey = decideMail({ ...RESEND_ENV, EMAIL_API_KEY: "" });
    assert.equal(noKey.config, null);
    assert.match(noKey.warnings[0], /EMAIL_API_KEY/);

    const noFrom = decideMail({ ...RESEND_ENV, EMAIL_FROM: "" });
    assert.equal(noFrom.config, null);
    assert.match(noFrom.warnings[0], /EMAIL_FROM/);

    const both = decideMail({ NODE_ENV: "production", EMAIL_PROVIDER: "resend" });
    assert.match(both.warnings[0], /EMAIL_API_KEY.*EMAIL_FROM/);

    for (const d of [noKey, noFrom, both]) assert.equal(JSON.stringify(d).includes(KEY), false);
  });

  it("refuses a key or a sender that could inject a header", () => {
    assert.equal(decideMail({ ...RESEND_ENV, EMAIL_API_KEY: "re_abc\r\nBcc:x@y.com" }).config, null);
    assert.equal(decideMail({ ...RESEND_ENV, EMAIL_API_KEY: "re abc" }).config, null);
    assert.equal(decideMail({ ...RESEND_ENV, EMAIL_API_KEY: "re_abc\nBcc:x@y.com" }).config, null);
    assert.equal(decideMail({ ...RESEND_ENV, EMAIL_API_KEY: "re_abc\u0000def" }).config, null);
    assert.equal(decideMail({ ...RESEND_ENV, EMAIL_FROM: "Evil <a@example.com>\r\nBcc: x@y.com" }).config, null);
    assert.equal(decideMail({ ...RESEND_ENV, EMAIL_FROM: "Evil\r\nBcc: x@y.com <a@example.com>" }).config, null);
  });

  it("does not echo an unsupported provider name, in case it is a key pasted in the wrong place", () => {
    const d = decideMail({ NODE_ENV: "production", EMAIL_PROVIDER: "re_pasted_secret_key" });
    assert.equal(d.config, null);
    assert.equal(d.fatal, null);
    assert.equal(JSON.stringify(d).includes("re_pasted_secret_key"), false);
    assert.match(d.warnings[0], /not a supported value/);
  });

  it("allows the outbox provider in development when it has a folder", () => {
    const d = decideMail({ EMAIL_PROVIDER: "outbox", EMAIL_OUTBOX_DIR: "./outbox" });
    assert.deepEqual(d.config, { provider: "outbox", dir: "./outbox", from: null });
    assert.equal(d.fatal, null);
    assert.match(d.warnings.join(" "), /written to \.\/outbox/);
  });

  it("is unconfigured, in development, when the outbox has no folder", () => {
    const d = decideMail({ EMAIL_PROVIDER: "outbox" });
    assert.equal(d.config, null);
    assert.match(d.warnings[0], /EMAIL_OUTBOX_DIR/);
  });

  it("REFUSES to start with the outbox provider in production, however it is detected", () => {
    for (const env of [{ NODE_ENV: "production" }, { VERCEL: "1" }, { NODE_ENV: "production", VERCEL: "1" }]) {
      const d = decideMail({ ...env, EMAIL_PROVIDER: "outbox", EMAIL_OUTBOX_DIR: "./outbox" });
      assert.equal(d.config, null);
      assert.match(String(d.fatal), /outbox.*development and tests only/);
    }
  });
});

describe("parseSender", () => {
  it("accepts a bare address and a name with an address", () => {
    assert.equal(parseSender("no-reply@example.com"), "no-reply@example.com");
    assert.equal(parseSender("  Leeterboard <no-reply@example.com> "), "Leeterboard <no-reply@example.com>");
  });

  it("rejects anything else", () => {
    for (const bad of [undefined, null, "", "   ", "nope", "Name <nope>", "<a@example.com> Name", "A <a@example.com", "a@example.com, b@example.com", 'Evil" <a@example.com>', "N <a@example.com>\nBcc: x@y.com"]) {
      assert.equal(parseSender(bad as string), null, JSON.stringify(bad));
    }
  });
});

describe("assertMailConfigAtBoot", () => {
  it("returns the decision and does not stop the process when e-mail is merely unconfigured", () => {
    const d = assertMailConfigAtBoot({ NODE_ENV: "production" }, () => assert.fail("must not stop"));
    assert.equal(d.config, null);
  });

  it("stops on the outbox in production", () => {
    let stoppedWith = "";
    assertMailConfigAtBoot({ NODE_ENV: "production", EMAIL_PROVIDER: "outbox", EMAIL_OUTBOX_DIR: "x" }, (m) => {
      stoppedWith = m;
      return undefined as never;
    });
    assert.match(stoppedWith, /Refusing to start in production/);
  });
});

describe("the resend provider", () => {
  it("makes exactly one authenticated JSON request to Resend with the message as given", async () => {
    const { fn, calls } = stubFetch(ok);
    await createMailer(RESEND, { fetch: fn }).send(MSG);

    assert.equal(calls.length, 1);
    const { url, init } = calls[0];
    assert.equal(url, RESEND_URL);
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(init.method, "POST");
    const headers = init.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Bearer ${KEY}`);
    assert.equal(headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(String(init.body)), {
      from: FROM,
      to: ["alice@example.com"], // normalised: lowercase
      subject: MSG.subject,
      text: MSG.text
    });
  });

  it("never follows a redirect (it would carry the key to another host) and always has a time limit", async () => {
    const { fn, calls } = stubFetch(ok);
    await createMailer(RESEND, { fetch: fn }).send(MSG);
    assert.equal(calls[0].init.redirect, "error");
    assert.ok(calls[0].init.signal instanceof AbortSignal);
  });

  it("uses the global fetch as it is when sending, so a test can preload a fake", async () => {
    const real = globalThis.fetch;
    const { fn, calls } = stubFetch(ok);
    const mailer = createMailer(RESEND); // created BEFORE the fake exists
    globalThis.fetch = fn;
    try {
      await mailer.send(MSG);
    } finally {
      globalThis.fetch = real;
    }
    assert.equal(calls.length, 1);
  });

  it("turns an error status into a rejected MailError that carries the status and nothing else", async () => {
    for (const status of [401, 403, 422, 429, 500, 503]) {
      const { fn } = stubFetch(() => new Response(`{"message":"bad to alice@example.com code 123456 key ${KEY}"}`, { status }));
      const err = await rejection(createMailer(RESEND, { fetch: fn }).send(MSG));
      assert.equal(err.kind, "rejected");
      assert.equal(err.status, status);
      assert.match(err.message, new RegExp(`HTTP ${status}`));
      for (const secret of ["alice@example.com", "123456", KEY, "Your Leeterboard code"]) {
        assert.equal(err.message.includes(secret), false, `error message leaked ${secret}`);
        assert.equal(String(err.stack).includes(secret), false);
      }
    }
  });

  it("does not retry: a failing send is one request, so no code can be mailed twice", async () => {
    const { fn, calls } = stubFetch(() => new Response("", { status: 500 }));
    await rejection(createMailer(RESEND, { fetch: fn }).send(MSG));
    assert.equal(calls.length, 1);
  });

  it("reports an unreachable provider as a network error without quoting the cause", async () => {
    const { fn } = stubFetch(() => {
      throw new TypeError(`fetch failed: could not send to alice@example.com with ${KEY}`);
    });
    const err = await rejection(createMailer(RESEND, { fetch: fn }).send(MSG));
    assert.equal(err.kind, "network");
    assert.equal(err.message.includes("alice@example.com"), false);
    assert.equal(err.message.includes(KEY), false);
    assert.equal((err as { cause?: unknown }).cause, undefined);
  });

  it("gives up after the time limit and says the message may still arrive", async () => {
    // A fetch that honours the abort signal, like the real one. A real pending
    // request holds a socket, which keeps the event loop alive; AbortSignal.timeout's
    // own timer is unref'd, so this stub must hold the loop open the same way or
    // the process can exit before the timeout fires.
    const waits = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        const hold = setInterval(() => {}, 1000);
        init.signal!.addEventListener("abort", () => {
          clearInterval(hold);
          reject(init.signal!.reason);
        });
      })) as unknown as typeof fetch;
    const started = Date.now();
    const err = await rejection(createMailer(RESEND, { fetch: waits, timeoutMs: 40 }).send(MSG));
    assert.equal(err.kind, "timeout");
    assert.match(err.message, /did not answer in time/);
    assert.ok(Date.now() - started < 2000);
  });
});

describe("what a message may contain", () => {
  const refused = async (over: Partial<typeof MSG>, expectInMessage: RegExp) => {
    const { fn, calls } = stubFetch(ok);
    const err = await rejection(createMailer(RESEND, { fetch: fn }).send({ ...MSG, ...over }));
    assert.equal(err.kind, "invalid");
    assert.match(err.message, expectInMessage);
    assert.equal(calls.length, 0, "nothing may be sent");
    return err;
  };

  it("refuses a recipient that is not an address, or could inject a header, without sending", async () => {
    for (const to of ["", "nope", "a@example.com\r\nBcc: victim@example.net", "a@example.com\nBcc: x@y.com", "a b@example.com", "a@example.com,b@example.com", "<a@example.com>"]) {
      const err = await refused({ to }, /recipient/);
      assert.equal(err.message.includes("victim"), false);
    }
    await rejection(createMailer(RESEND, { fetch: stubFetch(ok).fn }).send({ ...MSG, to: undefined as unknown as string }));
  });

  it("refuses a subject with a line break or control character, or an empty or huge one", async () => {
    await refused({ subject: "Hi\r\nBcc: victim@example.net" }, /subject/);
    await refused({ subject: "Hi\nthere" }, /subject/);
    await refused({ subject: "Hi\u0000" }, /subject/);
    await refused({ subject: "Hi\u2028there" }, /subject/);
    await refused({ subject: "   " }, /subject is empty/);
    await refused({ subject: "x".repeat(201) }, /too long/);
  });

  it("refuses an empty, huge or null-containing text, but allows ordinary line breaks in it", async () => {
    await refused({ text: "" }, /text is empty/);
    await refused({ text: "x".repeat(10_001) }, /too long/);
    await refused({ text: "code\u0000" }, /null character/);
    const { fn, calls } = stubFetch(ok);
    await createMailer(RESEND, { fetch: fn }).send({ ...MSG, text: "line one\r\nline two\n\nline three" });
    assert.equal(calls.length, 1);
  });
});

describe("the outbox provider", () => {
  it("writes one owner-only file per message, in send order, with nothing in the file name", async () => {
    const dir = path.join(tmp(), "nested", "outbox"); // created on demand
    const mailer = createMailer({ provider: "outbox", dir, from: "Dev <dev@example.com>" }, { production: false });
    assert.equal(mailer.provider, "outbox");
    await mailer.send(MSG);
    await mailer.send({ ...MSG, to: "bob@example.com", subject: "Second" });

    const files = fs.readdirSync(dir).sort();
    assert.equal(files.length, 2);
    for (const f of files) {
      assert.match(f, /^\d{13}-\d{6}-[0-9a-f]{8}\.json$/);
      assert.equal(f.includes("alice"), false);
      assert.equal(fs.statSync(path.join(dir, f)).mode & 0o777, 0o600);
    }
    const [first, second] = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
    assert.equal(first.to, "alice@example.com");
    assert.equal(first.subject, MSG.subject);
    assert.equal(first.text, MSG.text);
    assert.equal(first.from, "Dev <dev@example.com>");
    assert.equal(second.to, "bob@example.com");
  });

  it("applies the same message checks as the real provider", async () => {
    const dir = tmp();
    const mailer = createMailer({ provider: "outbox", dir, from: null }, { production: false });
    const err = await rejection(mailer.send({ ...MSG, subject: "x\r\nBcc: y@z.com" }));
    assert.equal(err.kind, "invalid");
    assert.deepEqual(fs.readdirSync(dir), []);
  });

  it("cannot even be created in production", () => {
    assert.throws(() => createMailer({ provider: "outbox", dir: tmp(), from: null }, { production: true }), /cannot be used in production/);
  });
});
