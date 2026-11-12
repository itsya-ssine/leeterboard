import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  completeOAuthSignup,
  fetchPendingOAuthSignup,
  startOAuthLink,
  unlinkOAuth,
  mergeSessionUser
} from "../src/authApi.js";
import type { User } from "../src/types.js";

interface Call {
  url: string;
  method: string;
  body: unknown;
}

const realFetch = globalThis.fetch;
let calls: Call[] = [];
let reply: () => Response = () => Response.json({});

beforeEach(() => {
  calls = [];
  reply = () => Response.json({});
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body))
    });
    return reply();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("OAuth auth API", () => {
  it("reads the pending sign-up with GET and no request body", async () => {
    reply = () => Response.json({ provider: "github", maskedEmail: "a***@example.com", suggestedDisplayName: "Alice" });
    const pending = await fetchPendingOAuthSignup();
    assert.deepEqual(pending, {
      provider: "github",
      maskedEmail: "a***@example.com",
      suggestedDisplayName: "Alice"
    });
    assert.deepEqual(calls, [{ url: "/api/auth/oauth/pending", method: "GET", body: undefined }]);
  });

  it("completes sign-up with a username and includes only a non-empty display name", async () => {
    await completeOAuthSignup("alice_1", "  Alice  ");
    await completeOAuthSignup("bob_2", "   ");
    assert.deepEqual(calls.map(({ url, method, body }) => [url, method, body]), [
      ["/api/auth/oauth/complete", "POST", { username: "alice_1", displayName: "Alice" }],
      ["/api/auth/oauth/complete", "POST", { username: "bob_2" }]
    ]);
  });

  it("starts provider linking with an optional current password", async () => {
    reply = () => Response.json({ url: "https://github.com/login/oauth/authorize?state=opaque" });
    const started = await startOAuthLink("github", "current-password");
    assert.match(started.url, /^https:\/\/github\.com\//);
    await startOAuthLink("google");
    assert.deepEqual(calls.map(({ url, method, body }) => [url, method, body]), [
      ["/api/account/oauth/github/start", "POST", { currentPassword: "current-password" }],
      ["/api/account/oauth/google/start", "POST", {}]
    ]);
  });

  it("unlinks a provider with DELETE and no body", async () => {
    await unlinkOAuth("google");
    assert.deepEqual(calls, [{ url: "/api/account/oauth/google", method: "DELETE", body: undefined }]);
  });
});


describe("session user merging", () => {
  const member = (over: Partial<User> = {}) => ({
    id: "u1",
    loginUsername: "alice",
    displayName: "Alice",
    ...over
  }) as User;

  it("preserves private email and sign-in methods across ordinary member updates", () => {
    const previous = member({
      email: "alice@example.com",
      emailVerified: true,
      signInMethods: { password: false, providers: ["github"] }
    });
    const next = mergeSessionUser(previous, member({ bio: "Hello" }));
    assert.equal(next.email, "alice@example.com");
    assert.equal(next.emailVerified, true);
    assert.deepEqual(next.signInMethods, { password: false, providers: ["github"] });
  });

  it("does not carry session-only data to a different member", () => {
    const next = mergeSessionUser(member({ email: "alice@example.com", signInMethods: { password: true, providers: [] } }), member({ id: "u2" }));
    assert.equal("email" in next, false);
    assert.equal("signInMethods" in next, false);
  });
});
