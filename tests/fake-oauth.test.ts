/**
 * The fake GitHub / Google (tests/fake-oauth.mjs) that later steps rely on. If it
 * were wrong, every sign-in test would be proving nothing, so it is tested too:
 * the REAL oauthProviders.ts runs against it, calling the real provider URLs.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { OAuthError } from "../oauthProviders.js";
import { makeFakeOAuth, makeFakeLeetCode, mergeEnv } from "./f2-seed.js";

const fake = makeFakeOAuth();
let providers: typeof import("../oauthProviders.js");

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const config = { clientId: "id", clientSecret: "secret", redirectUri: "https://example.test/cb" };

before(async () => {
  process.env.FAKE_OAUTH_DIR = fake.dir;
  await import("./fake-oauth.mjs"); // replaces globalThis.fetch in THIS process
  providers = await import("../oauthProviders.js");
});
after(() => fake.cleanup());

const exchange = (provider: "github" | "google", code: string, verifier = VERIFIER, timeoutMs?: number) =>
  providers.exchangeAndFetchProfile(provider, code, verifier, config, { timeoutMs });

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof OAuthError);
    assert.doesNotMatch(err.message, /FAKE-PROVIDER-ERROR-TEXT/);
    return err.kind;
  }
  assert.fail("expected a failure");
}

describe("fake-oauth.mjs with the real oauthProviders code", () => {
  it("answers a GitHub sign-in with the id, the verified primary email and the name", async () => {
    const code = fake.issueCode("github", { id: 583231, login: "octocat", name: "The Octocat", email: "Octo@Example.com" });
    assert.deepEqual(await exchange("github", code), {
      providerUserId: "583231",
      email: "octo@example.com",
      displayName: "The Octocat"
    });
  });

  it("answers a Google sign-in with the sub, the verified email and the name", async () => {
    const code = fake.issueCode("google", { id: "110169484474386276334", email: "alice@example.com", name: "Alice" });
    assert.deepEqual(await exchange("google", code), {
      providerUserId: "110169484474386276334",
      email: "alice@example.com",
      displayName: "Alice"
    });
  });

  it("records every call it answered, in order", async () => {
    const before = fake.calls().length;
    await exchange("github", fake.issueCode("github", { id: 1, email: "a@example.com" }));
    await exchange("google", fake.issueCode("google", { id: "2", email: "b@example.com" }));
    const mine = fake.calls().slice(before);
    assert.equal(mine.length, 5);
    assert.equal(mine[0], "github token");
    assert.deepEqual([...mine.slice(1, 3)].sort(), ["github emails", "github user"]);
    assert.deepEqual(mine.slice(3), ["google token", "google userinfo"]);
  });

  it("makes a code single use, like the real providers", async () => {
    const code = fake.issueCode("github", { id: 3, email: "c@example.com" });
    await exchange("github", code);
    assert.equal(await kindOf(exchange("github", code)), "failed");
    assert.equal(await kindOf(exchange("github", "never-issued")), "failed");
  });

  it("does not let a GitHub code be used at Google, or the other way round", async () => {
    assert.equal(await kindOf(exchange("google", fake.issueCode("github", { id: 4, email: "d@example.com" }))), "failed");
    assert.equal(await kindOf(exchange("github", fake.issueCode("google", { id: "5", email: "e@example.com" }))), "failed");
  });

  it("flags an unverified GitHub address, and a GitHub account with only a non-primary one", async () => {
    assert.equal(await kindOf(exchange("github", fake.issueCode("github", { id: 6, email: "f@example.com" }, { unverified: true }))), "unverified_email");
    assert.equal(await kindOf(exchange("github", fake.issueCode("github", { id: 7, email: "g@example.com" }, { noPrimary: true }))), "unverified_email");
  });

  it("flags an unverified Google address", async () => {
    assert.equal(await kindOf(exchange("google", fake.issueCode("google", { id: "8", email: "h@example.com" }, { unverified: true }))), "unverified_email");
  });

  it("refuses a code when asked to (badToken)", async () => {
    assert.equal(await kindOf(exchange("github", fake.issueCode("github", { id: 9, email: "i@example.com" }, { badToken: true }))), "failed");
    assert.equal(await kindOf(exchange("google", fake.issueCode("google", { id: "9", email: "i@example.com" }, { badToken: true }))), "failed");
  });

  it("answers 500 while down, without spending the code", async () => {
    const code = fake.issueCode("github", { id: 10, email: "j@example.com" }, { down: true });
    assert.equal(await kindOf(exchange("github", code)), "failed");
    assert.equal(await kindOf(exchange("github", code)), "failed", "still down, the same way");
  });

  it("never answers while slow, so the caller's timeout fires", async () => {
    const started = Date.now();
    assert.equal(await kindOf(exchange("github", fake.issueCode("github", { id: 11, email: "k@example.com" }, { slow: true }), VERIFIER, 40)), "unavailable");
    assert.equal(await kindOf(exchange("google", fake.issueCode("google", { id: "11", email: "k@example.com" }, { slow: true }), VERIFIER, 40)), "unavailable");
    assert.ok(Date.now() - started < 2000);
  });

  it("checks the PKCE verifier against the challenge it was given", async () => {
    const ok = fake.issueCode("github", { id: 12, email: "l@example.com" }, { challenge: CHALLENGE });
    assert.equal((await exchange("github", ok)).providerUserId, "12");
    const wrong = fake.issueCode("google", { id: "12", email: "l@example.com" }, { challenge: CHALLENGE });
    assert.equal(await kindOf(exchange("google", wrong, "a-different-verifier-of-the-right-length-0123456789")), "failed");
  });
});

describe("fake-oauth.mjs behaves like the real APIs where it matters", () => {
  it("refuses GitHub API calls without a token, with a wrong token, or without a User-Agent", async () => {
    const code = fake.issueCode("github", { id: 20, email: "m@example.com" });
    await exchange("github", code);
    const token = `fake-github-token-${code}`;
    assert.equal((await fetch("https://api.github.com/user", { headers: { "User-Agent": "t" } })).status, 401);
    assert.equal((await fetch("https://api.github.com/user", { headers: { Authorization: "Bearer nope", "User-Agent": "t" } })).status, 401);
    assert.equal((await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}` } })).status, 403);
    assert.equal((await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, "User-Agent": "t" } })).status, 200);
  });

  it("does not accept a Google token at GitHub's API", async () => {
    const code = fake.issueCode("google", { id: "21", email: "n@example.com" });
    await exchange("google", code);
    const res = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer fake-google-token-${code}`, "User-Agent": "t" }
    });
    assert.equal(res.status, 401);
  });

  it("answers GitHub's token call in form-encoded text without 'Accept: application/json'", async () => {
    const code = fake.issueCode("github", { id: 22, email: "o@example.com" });
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: "i", client_secret: "s", code, redirect_uri: "https://x.test", code_verifier: VERIFIER })
    });
    assert.match(await res.text(), /^access_token=fake-github-token-/);
  });

  it("requires every parameter and the right content type at the token endpoints", async () => {
    const github = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: "i", client_secret: "s", code: "c", redirect_uri: "https://x.test" }) // no code_verifier
    });
    assert.equal(((await github.json()) as { error: string }).error, "incorrect_client_credentials");

    const wrongType = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "c" })
    });
    assert.equal(wrongType.status, 400);
    const missing = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: "c" }).toString()
    });
    assert.equal(missing.status, 400);
  });

  it("does not let a code name escape the folder", async () => {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "../../etc/passwd",
        client_id: "i",
        client_secret: "s",
        redirect_uri: "https://x.test",
        code_verifier: VERIFIER
      }).toString()
    });
    assert.equal(res.status, 400);
  });
});

describe("test helpers", () => {
  it("mergeEnv joins this fake with another so both preloads run", () => {
    const lc = makeFakeLeetCode();
    try {
      const merged = mergeEnv(lc.env, fake.env);
      assert.match(merged.NODE_OPTIONS, /fake-leetcode\.mjs/);
      assert.match(merged.NODE_OPTIONS, /fake-oauth\.mjs/);
      assert.equal(merged.FAKE_OAUTH_DIR, fake.dir);
      assert.equal(merged.FAKE_LEETCODE_DIR, lc.dir);
    } finally {
      lc.cleanup();
    }
  });
});
