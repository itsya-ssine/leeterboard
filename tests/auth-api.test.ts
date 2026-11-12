/**
 * The browser side of e-mail sign-up (email sign-up step 12): the requests
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
  requestResetCode,
  requestSignupCode,
  submitEmailCode,
  submitResetCode,
  submitSignupCode
} from "../src/authApi.js";
import {
  checkCode,
  checkEmailInput,
  checkNewPassword,
  checkSignup,
  EMAIL_CODE_LENGTH,
  normalizeCode,
  RESEND_WAIT_SECONDS
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
  it("sign-up step 1 posts the username, password, address and display name to /register/start", async () => {
    reply = () => Response.json({ expiresInMinutes: 10, maskedEmail: "a***@example.com" });
    const res = await requestSignupCode("alice_1", "correct-horse-9", "a@example.com", "Alice");
    assert.deepEqual(res, { expiresInMinutes: 10, maskedEmail: "a***@example.com" });
    assert.deepEqual(calls, [
      {
        url: "/api/auth/register/start",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { username: "alice_1", password: "correct-horse-9", email: "a@example.com", displayName: "Alice" }
      }
    ]);
  });

  it("leaves the display name out when there is none", async () => {
    await requestSignupCode("alice_1", "correct-horse-9", "a@example.com");
    assert.equal("displayName" in (calls[0].body as object), false);
  });

  it("sign-up step 2 posts only the code to /register/verify", async () => {
    await submitSignupCode("123456");
    assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [["POST", "/api/auth/register/verify", { code: "123456" }]]);
  });

  it("the e-mail change posts { email, currentPassword } and then { code }", async () => {
    await requestEmailCode("new@example.com", "my-password-1");
    await submitEmailCode("654321");
    assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [
      ["POST", "/api/account/email/start", { email: "new@example.com", currentPassword: "my-password-1" }],
      ["POST", "/api/account/email/verify", { code: "654321" }]
    ]);
  });

  it("forgot password posts { email, newPassword } and then { code }", async () => {
    reply = () => Response.json({ message: "If that address has an account, we sent a code.", expiresInMinutes: 10 });
    const res = await requestResetCode("a@example.com", "a-new-password-42");
    assert.equal(res.message, "If that address has an account, we sent a code.");
    await submitResetCode("111222");
    assert.deepEqual(calls.map((c) => [c.method, c.url, c.body]), [
      ["POST", "/api/auth/reset/email/start", { email: "a@example.com", newPassword: "a-new-password-42" }],
      ["POST", "/api/auth/reset/email/verify", { code: "111222" }]
    ]);
  });

  it("never puts the code, the password or the address in a URL", async () => {
    await requestSignupCode("alice_1", "correct-horse-9", "a@example.com");
    await submitSignupCode("123456");
    await requestEmailCode("a@example.com", "my-password-1");
    await submitEmailCode("123456");
    await requestResetCode("a@example.com", "a-new-password-42");
    await submitResetCode("123456");
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
    const err = await caught(() => requestSignupCode("alice_1", "correct-horse-9", "a@example.com"));
    assert.equal(err.message, "That username is taken.");
    assert.equal(err.status, 409);
    assert.equal(err.expired, false);
  });

  it("a wrong code is a 400 that is not expired, so the form lets the person try again", async () => {
    fail(400, { error: "That code isn't right. Check it and try again." });
    const err = await caught(() => submitSignupCode("000000"));
    assert.equal(err.expired, false);
    assert.equal(err.status, 400);
  });

  it("an expired or locked request is `expired`, so the form goes back to the first step", async () => {
    fail(400, { error: "This sign-up has expired. Please start again.", expired: true });
    assert.equal((await caught(() => submitSignupCode("000000"))).expired, true);
    fail(429, { error: "Too many wrong codes. Please start again.", expired: true });
    const locked = await caught(() => submitResetCode("000000"));
    assert.equal(locked.expired, true);
    assert.equal(locked.status, 429);
  });

  it("the resend wait is a 429 that is NOT expired (the sign-up is still open)", async () => {
    fail(429, { error: "Wait a minute before asking for another code." });
    const err = await caught(() => requestSignupCode("alice_1", "correct-horse-9", "a@example.com"));
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
    const err = await caught(() => submitSignupCode("123456"));
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

  it("checkSignup checks the address when it is given, and still checks the rest", () => {
    assert.equal(checkSignup("jsmith_99", "correct-horse-9", "j@example.com"), null);
    assert.match(checkSignup("jsmith_99", "correct-horse-9", "nope")!, /valid email/i);
    assert.match(checkSignup("jsmith_99", "correct-horse-9", "")!, /required/i);
    assert.match(checkSignup("ab", "correct-horse-9", "j@example.com")!, /3 to 30/, "the username is checked first");
    assert.match(checkSignup("jsmith_99", "short", "j@example.com")!, /at least 8/);
    assert.equal(checkSignup("jsmith_99", "correct-horse-9"), null, "no address given: the old two-argument call still works");
  });

  it("checkNewPassword has the server's length limits and no username to compare to", () => {
    assert.equal(checkNewPassword("a-brand-new-password-42"), null);
    assert.match(checkNewPassword("short")!, /at least 8/);
    assert.match(checkNewPassword("x".repeat(129))!, /at most 128/);
    assert.equal(checkNewPassword("x".repeat(128)), null);
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

  it("exposes the six new calls and builds them from authApi", () => {
    for (const name of ["startRegistration", "verifyRegistration", "startEmailChange", "verifyEmailChange", "startPasswordReset", "verifyPasswordReset"]) {
      assert.match(ctx, new RegExp(`\\b${name}\\b`), name);
    }
    assert.match(ctx, /from "\.\/authApi\.js"/);
  });

  it("signs in after a verified sign-up and after a verified reset, and re-reads the session after an e-mail change", () => {
    assert.match(ctx, /verifyRegistration = useCallback\(async \(code: string\) => \{\s*const data = await submitSignupCode\(code\);\s*setUser\(data\);[\s\S]*?setStatus\("authenticated"\)/);
    assert.match(ctx, /verifyPasswordReset = useCallback\(async \(code: string\) => \{\s*const data = await submitResetCode\(code\);\s*setUser\(data\);[\s\S]*?setStatus\("authenticated"\)/);
    assert.match(ctx, /verifyEmailChange[\s\S]*?await refreshSession\(\)/);
  });

  it("does not sign anyone in when a start step succeeds", () => {
    for (const name of ["startRegistration", "startPasswordReset", "startEmailChange"]) {
      const from = ctx.indexOf(`const ${name} = useCallback(`);
      assert.ok(from >= 0, name);
      const body = ctx.slice(from, ctx.indexOf("\n\n  const ", from));
      assert.doesNotMatch(body, /setStatus|setUser/, name);
    }
  });

  it("keeps the member's own address across every account update", () => {
    const direct = ctx.match(/setUser\(data\)/g)?.length ?? 0;
    // Only the three fresh sign-ins (login, verified sign-up, verified reset) replace the user outright.
    assert.equal(direct, 3);
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
