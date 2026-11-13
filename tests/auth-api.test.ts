/**
 * The browser-side account email settings and shared session helpers: the requests
 * src/authApi.ts sends, how it reads the server's answers, the form checks in
 * src/signup.ts, and how AuthContext keeps the member's own address. No DOM and
 * no React: fetch is stubbed, and the form checks are plain functions.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { checkEmail } from "../emails.js";
import {
  AuthError,
  mergeSessionUser,
  requestEmailCode,
  submitEmailCode
} from "../src/authApi.js";
import {
  checkCode,
  checkEmailInput,
  EMAIL_CODE_LENGTH,
  normalizeCode
} from "../src/signup.js";
import type { User } from "../src/types.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}
const realFetch = globalThis.fetch;
let calls: Call[] = [];
let reply: () => Response | Promise<Response> = () => Response.json({});

beforeEach(() => {
  calls = [];
  reply = () => Response.json({});
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body))
    });
    return reply();
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the requests", () => {
  it("the e-mail change posts { email, currentPassword } and then { code }", async () => {
    await requestEmailCode("new@example.com", "my-password-1");
    await submitEmailCode("654321");
    assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [
      ["POST", "/api/account/email/start", { email: "new@example.com", currentPassword: "my-password-1" }],
      ["POST", "/api/account/email/verify", { code: "654321" }]
    ]);
  });

  it("never puts the code, the password or the address in a URL", async () => {
    await requestEmailCode("a@example.com", "my-password-1");
    await submitEmailCode("123456");
    for (const call of calls) assert.doesNotMatch(call.url, /\?|123456|password|example\.com/, call.url);
  });
});

describe("the errors", () => {
  const fail = (status: number, body: unknown) => {
    reply = () => Response.json(body, { status });
  };
  const caught = async (run: () => Promise<unknown>): Promise<AuthError> => {
    try {
      await run();
    } catch (err) {
      assert.ok(err instanceof AuthError, "an AuthError");
      return err;
    }
    throw new Error("expected a failure");
  };

  it("a refusal carries the server's message, its status, and expired false", async () => {
    fail(409, { error: "That username is taken." });
    const err = await caught(() => requestEmailCode("a@example.com", "my-password-1"));
    assert.equal(err.message, "That username is taken.");
    assert.equal(err.status, 409);
    assert.equal(err.expired, false);
  });

  it("a wrong code is a 400 that is not expired, so the form lets the person try again", async () => {
    fail(400, { error: "That code isn't right. Check it and try again." });
    const err = await caught(() => submitEmailCode("000000"));
    assert.equal(err.expired, false);
    assert.equal(err.status, 400);
  });

  it("an expired or locked e-mail change is marked `expired`", async () => {
    fail(400, { error: "This sign-up has expired. Please start again.", expired: true });
    assert.equal((await caught(() => submitEmailCode("000000"))).expired, true);
    fail(429, { error: "Too many wrong codes. Please start again.", expired: true });
    const locked = await caught(() => submitEmailCode("000000"));
    assert.equal(locked.expired, true);
    assert.equal(locked.status, 429);
  });

  it("a 429 rate limit is not treated as an expired e-mail change", async () => {
    fail(429, { error: "Wait a minute before asking for another code." });
    const err = await caught(() => requestEmailCode("a@example.com", "my-password-1"));
    assert.equal(err.status, 429);
    assert.equal(err.expired, false);
  });

  it("a page that isn't JSON (a proxy error) gives the generic message", async () => {
    reply = () => new Response("<html>Bad gateway</html>", { status: 502 });
    const err = await caught(() => submitEmailCode("123456"));
    assert.equal(err.message, "Something went wrong. Please try again.");
    assert.equal(err.status, 502);
  });

  it("an unreachable server is status 0 with a message about the connection", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("network down");
    }) as typeof fetch;
    const err = await caught(() => submitEmailCode("123456"));
    assert.equal(err.status, 0);
    assert.match(err.message, /reach the server/);
  });
});

const member = (over: Partial<User> = {}): User => ({ id: "u1", loginUsername: "alice", displayName: "Alice", ...over }) as User;

describe("keeping the member's own address", () => {
  it("keeps email and emailVerified when a newer answer for the same member doesn't carry them", () => {
    const prev = member({ email: "a@example.com", emailVerified: true });
    const next = mergeSessionUser(prev, member({ displayName: "Alice B." }));
    assert.equal(next.displayName, "Alice B.");
    assert.equal(next.email, "a@example.com");
    assert.equal(next.emailVerified, true);
  });

  it("keeps 'no address' too (email: null)", () => {
    const next = mergeSessionUser(member({ email: null, emailVerified: false }), member({ bio: "hi" }));
    assert.equal(next.email, null);
    assert.equal(next.emailVerified, false);
  });

  it("takes the new values when the answer carries them (a session read)", () => {
    const next = mergeSessionUser(member({ email: "old@example.com", emailVerified: true }), member({ email: "new@example.com", emailVerified: true }));
    assert.equal(next.email, "new@example.com");
  });

  it("never carries an address over to a different member, or to nobody", () => {
    const other = mergeSessionUser(member({ id: "u1", email: "a@example.com", emailVerified: true }), member({ id: "u2" }));
    assert.equal("email" in other, false);
    assert.equal("emailVerified" in other, false);
    assert.equal("email" in mergeSessionUser(null, member()), false);
  });

  it("does not mutate what it was given", () => {
    const prev = member({ email: "a@example.com", emailVerified: true });
    const next = member();
    mergeSessionUser(prev, next);
    assert.equal("email" in next, false);
  });
});

describe("e-mail checks in the form", () => {
  it("accepts a normal address, with surrounding spaces from a paste", () => {
    for (const email of ["alice@example.com", "  Alice.B+tag@Example.COM ", "a_b-c@sub.school.edu.ma"]) {
      assert.equal(checkEmailInput(email), null, email);
    }
  });

  it("explains what is wrong, with the server's own wording", () => {
    assert.match(checkEmailInput("")!, /required/i);
    assert.match(checkEmailInput("   ")!, /required/i);
    assert.match(checkEmailInput("alice")!, /valid email/i);
    assert.match(checkEmailInput("a@b@c.com")!, /valid email/i);
    assert.match(checkEmailInput("alice@localhost")!, /valid email/i);
    assert.match(checkEmailInput("ali ce@example.com")!, /spaces or line breaks/i);
    assert.match(checkEmailInput("alice@example.com\nBcc: x@example.com")!, /spaces or line breaks/i);
    assert.match(checkEmailInput(`${"a".repeat(250)}@example.com`)!, /too long/i);
    assert.match(checkEmailInput("alicé@example.com")!, /aren't supported/i);
  });

  it("gives the same verdict as the server's check on a table of addresses (it is the same function)", () => {
    for (const email of ["a@b.co", "a@b", "@b.co", "a@.co", "a@b..co", "a..b@c.co", "a b@c.co", "a@1.2.3.4", "x@y.zz", "A@B.CO", `${"a".repeat(65)}@b.co`]) {
      assert.equal(checkEmailInput(email) === null, checkEmail(email).ok, email);
    }
  });

  it("does not know the allowed domains: a domain the server may refuse is fine here", () => {
    assert.equal(checkEmailInput("someone@gmail.com"), null);
  });


});

describe("code checks in the form", () => {
  it("accepts six digits, however they were pasted", () => {
    for (const code of ["123456", "123 456", "123-456", " 123456 ", "1 2 3 4 5 6", "000000"]) {
      assert.equal(checkCode(code), null, code);
      assert.equal(normalizeCode(code).length, EMAIL_CODE_LENGTH);
    }
  });

  it("explains an empty, short, long or non-numeric code", () => {
    assert.match(checkCode("")!, /enter the 6-digit code/i);
    assert.match(checkCode("   ")!, /enter the 6-digit code/i);
    assert.match(checkCode("12345")!, /6 digits/);
    assert.match(checkCode("1234567")!, /6 digits/);
    assert.match(checkCode("12a456")!, /digits only/);
    assert.match(checkCode("abcdef")!, /digits only/);
  });
});

describe("AuthContext", () => {
  const ctx = read("src/AuthContext.tsx");

  it("keeps the account email-change calls until the Account settings UI is migrated", () => {
    for (const name of ["startEmailChange", "verifyEmailChange"]) assert.match(ctx, new RegExp(`\\b${name}\\b`), name);
    assert.doesNotMatch(ctx, /startRegistration|verifyRegistration|startPasswordReset|verifyPasswordReset/);
    assert.match(ctx, /from "\.\/authApi\.js"/);
  });

  it("re-reads the session after an e-mail change", () => {
    assert.match(ctx, /verifyEmailChange[\s\S]*?await refreshSession\(\)/);
  });

  it("keeps the member's own address across every account update", () => {
    const direct = ctx.match(/setUser\(data\)/g)?.length ?? 0;
    // Login and OAuth sign-up replace the user outright. Account updates merge.
    assert.equal(direct, 2);
    assert.match(ctx, /mergeSessionUser\(prev, data\.user\)/);
  });

  it("keeps the 401 / session_required handling untouched", () => {
    assert.match(ctx, /installSessionExpiryHandler/);
    assert.match(ctx, /setSessionEnded\(true\)/);
  });

  it("re-exports AuthError so existing imports keep working", () => {
    assert.match(ctx, /export \{ AuthError \}/);
  });
});
