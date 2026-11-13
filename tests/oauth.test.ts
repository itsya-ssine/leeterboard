import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  buildAuthorizeUrl,
  checkEmailDomain,
  cleanSuggestedName,
  generatePkce,
  isOAuthErrorCode,
  isOAuthProvider,
  newStateId,
  OAUTH_ERROR_CODES,
  OAUTH_PROVIDERS,
  parseGoogleUserinfo,
  pickGithubEmail,
  readOAuthConfig,
  stateMatches
} from "../oauth.js";

describe("providers and error codes", () => {
  it("knows exactly github and google", () => {
    assert.deepEqual([...OAUTH_PROVIDERS], ["github", "google"]);
    assert.equal(isOAuthProvider("github"), true);
    assert.equal(isOAuthProvider("google"), true);
    for (const bad of ["GitHub", "facebook", "", " github", undefined, null, 1, {}, ["github"]]) {
      assert.equal(isOAuthProvider(bad), false, `expected ${JSON.stringify(bad)} to be refused`);
    }
  });

  it("has a fixed allow-list of error codes", () => {
    assert.deepEqual(
      [...OAUTH_ERROR_CODES],
      [
        "cancelled",
        "failed",
        "unverified_email",
        "email_in_use",
        "domain_not_allowed",
        "expired",
        "unavailable",
        "admin_refused",
        "already_linked"
      ]
    );
    for (const code of OAUTH_ERROR_CODES) assert.equal(isOAuthErrorCode(code), true);
    for (const bad of ["", "access_denied", "<script>", "FAILED", "failed ", undefined, null, 7, ["failed"]]) {
      assert.equal(isOAuthErrorCode(bad), false, `expected ${JSON.stringify(bad)} to be refused`);
    }
  });
});

describe("generatePkce", () => {
  it("makes a URL-safe verifier of the minimum RFC length", () => {
    const { verifier } = generatePkce();
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  });

  it("derives the challenge as base64url(SHA-256(verifier))", () => {
    const { verifier, challenge } = generatePkce();
    const expected = createHash("sha256").update(verifier).digest("base64url");
    assert.equal(challenge, expected);
    assert.match(challenge, /^[A-Za-z0-9_-]{43}$/); // no padding, no "+" or "/"
    assert.notEqual(challenge, verifier);
  });

  it("matches the RFC 7636 appendix B example construction", () => {
    // The RFC's own verifier and challenge, to prove the S256 transform is the standard one.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    assert.equal(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("gives a different pair every time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(generatePkce().verifier);
    assert.equal(seen.size, 50);
  });
});

describe("newStateId and stateMatches", () => {
  it("makes 128-bit lowercase hex ids that never repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const id = newStateId();
      assert.match(id, /^[0-9a-f]{32}$/);
      seen.add(id);
    }
    assert.equal(seen.size, 50);
  });

  it("accepts the same id in cookie and query", () => {
    const id = newStateId();
    assert.equal(stateMatches(id, id), true);
    assert.equal(stateMatches(id, String(id)), true);
  });

  it("refuses two different well-formed ids", () => {
    assert.equal(stateMatches(newStateId(), newStateId()), false);
    const id = newStateId();
    const flipped = (id[0] === "a" ? "b" : "a") + id.slice(1);
    assert.equal(stateMatches(id, flipped), false);
  });

  it("returns false (never throws) on malformed input", () => {
    const id = newStateId();
    const bad: unknown[] = [
      undefined,
      null,
      "",
      "abc",
      id.slice(1), // too short
      id + "0", // too long
      id.toUpperCase(), // not the canonical lowercase form
      "g".repeat(32), // right length, not hex
      `${id.slice(0, 31)}\n`, // control character
      "é".repeat(32), // multi-byte characters: byte length would differ
      [id], // repeated query parameter
      { toString: () => id },
      42
    ];
    for (const value of bad) {
      assert.equal(stateMatches(value, id), false, `cookie ${JSON.stringify(value)}`);
      assert.equal(stateMatches(id, value), false, `query ${JSON.stringify(value)}`);
    }
    assert.equal(stateMatches(undefined, undefined), false);
    assert.equal(stateMatches("", ""), false);
  });
});

describe("readOAuthConfig", () => {
  const prod = { NODE_ENV: "production", PUBLIC_URL: "https://leaderboard-leet.vercel.app" };

  it("enables nothing when nothing is set, and that is not a problem", () => {
    const config = readOAuthConfig({});
    assert.deepEqual(config.enabled, []);
    assert.deepEqual(config.providers, {});
    assert.deepEqual(config.problems, []);
    assert.equal(config.publicUrl, null);
    assert.equal(config.redirectUri("github"), null);
  });

  it("enables a provider only when BOTH id and secret are set", () => {
    const both = readOAuthConfig({ ...prod, GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret" });
    assert.deepEqual(both.enabled, ["github"]);
    assert.deepEqual(both.providers.github, { clientId: "id", clientSecret: "secret" });
    assert.equal(both.providers.google, undefined);
    assert.deepEqual(both.problems, []);

    const onlyId = readOAuthConfig({ ...prod, GITHUB_CLIENT_ID: "id" });
    assert.deepEqual(onlyId.enabled, []);
    assert.equal(onlyId.problems.length, 1);
    assert.match(onlyId.problems[0], /GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set together/);

    const onlySecret = readOAuthConfig({ ...prod, GOOGLE_CLIENT_SECRET: "secret" });
    assert.deepEqual(onlySecret.enabled, []);
    assert.match(onlySecret.problems[0], /GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together/);
  });

  it("treats blank values as unset", () => {
    const config = readOAuthConfig({ ...prod, GITHUB_CLIENT_ID: "  ", GITHUB_CLIENT_SECRET: "" });
    assert.deepEqual(config.enabled, []);
    assert.deepEqual(config.problems, []);
  });

  it("enables both providers in a stable order", () => {
    const config = readOAuthConfig({
      ...prod,
      GOOGLE_CLIENT_ID: "g-id",
      GOOGLE_CLIENT_SECRET: "g-secret",
      GITHUB_CLIENT_ID: "h-id",
      GITHUB_CLIENT_SECRET: "h-secret"
    });
    assert.deepEqual(config.enabled, ["github", "google"]);
  });

  it("builds the fixed redirect_uri from PUBLIC_URL", () => {
    const config = readOAuthConfig({ ...prod, GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret" });
    assert.equal(config.publicUrl, "https://leaderboard-leet.vercel.app");
    assert.equal(config.redirectUri("github"), "https://leaderboard-leet.vercel.app/api/auth/oauth/github/callback");
    assert.equal(config.redirectUri("google"), "https://leaderboard-leet.vercel.app/api/auth/oauth/google/callback");
  });

  it("accepts http://localhost outside production, but not in production", () => {
    const dev = readOAuthConfig({
      PUBLIC_URL: "http://localhost:3000",
      GITHUB_CLIENT_ID: "id",
      GITHUB_CLIENT_SECRET: "secret"
    });
    assert.deepEqual(dev.enabled, ["github"]);
    assert.equal(dev.redirectUri("github"), "http://localhost:3000/api/auth/oauth/github/callback");

    const live = readOAuthConfig({
      NODE_ENV: "production",
      PUBLIC_URL: "http://example.com",
      GITHUB_CLIENT_ID: "id",
      GITHUB_CLIENT_SECRET: "secret"
    });
    assert.equal(live.publicUrl, null);
    assert.deepEqual(live.enabled, []);
    assert.match(live.problems[0], /https:\/\/ in production/);
  });

  it("refuses a PUBLIC_URL with a path, trailing slash, query, fragment or credentials", () => {
    const bad = [
      "https://example.com/",
      "https://example.com/app",
      "https://example.com?x=1",
      "https://example.com#top",
      "https://user:pass@example.com",
      "https://EXAMPLE.com",
      "https://example.com:443"
    ];
    for (const url of bad) {
      const config = readOAuthConfig({
        NODE_ENV: "production",
        PUBLIC_URL: url,
        GITHUB_CLIENT_ID: "id",
        GITHUB_CLIENT_SECRET: "secret"
      });
      assert.equal(config.publicUrl, null, `expected ${url} to be refused`);
      assert.deepEqual(config.enabled, [], `expected ${url} to switch providers off`);
      assert.equal(config.redirectUri("github"), null);
      assert.equal(config.problems.length, 1, `${url}: ${JSON.stringify(config.problems)}`);
    }
  });

  it("refuses non-URLs and non-http schemes without throwing", () => {
    for (const url of ["not a url", "javascript:alert(1)", "ftp://example.com", "//example.com"]) {
      const config = readOAuthConfig({ PUBLIC_URL: url, GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret" });
      assert.equal(config.publicUrl, null, url);
      assert.deepEqual(config.enabled, [], url);
    }
  });

  it("switches a provider off, and says why, when PUBLIC_URL is missing", () => {
    const config = readOAuthConfig({ NODE_ENV: "production", GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret" });
    assert.deepEqual(config.enabled, []);
    assert.match(config.problems.join(" "), /PUBLIC_URL is required for github/);
  });

  it("never puts a secret in the problems", () => {
    const config = readOAuthConfig({
      NODE_ENV: "production",
      PUBLIC_URL: "http://example.com/x",
      GITHUB_CLIENT_ID: "very-secret-id",
      GITHUB_CLIENT_SECRET: "very-secret-value",
      GOOGLE_CLIENT_ID: "only-an-id"
    });
    const text = config.problems.join("\n");
    assert.doesNotMatch(text, /very-secret/);
    assert.doesNotMatch(text, /only-an-id/);
  });
});

describe("buildAuthorizeUrl", () => {
  const params = {
    state: "0123456789abcdef0123456789abcdef",
    challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    redirectUri: "https://leaderboard-leet.vercel.app/api/auth/oauth/github/callback",
    clientId: "client id&with=odd chars"
  };

  it("builds the GitHub URL", () => {
    const url = new URL(buildAuthorizeUrl("github", params));
    assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
    assert.equal(url.searchParams.get("client_id"), params.clientId);
    assert.equal(url.searchParams.get("redirect_uri"), params.redirectUri);
    assert.equal(url.searchParams.get("state"), params.state);
    assert.equal(url.searchParams.get("scope"), "read:user user:email");
    assert.equal(url.searchParams.get("code_challenge"), params.challenge);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  });

  it("builds the Google URL", () => {
    const url = new URL(buildAuthorizeUrl("google", params));
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("client_id"), params.clientId);
    assert.equal(url.searchParams.get("redirect_uri"), params.redirectUri);
    assert.equal(url.searchParams.get("state"), params.state);
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("scope"), "openid email profile");
    assert.equal(url.searchParams.get("prompt"), "select_account");
    assert.equal(url.searchParams.get("code_challenge"), params.challenge);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  });

  it("escapes values instead of letting them add parameters", () => {
    const built = buildAuthorizeUrl("github", { ...params, clientId: "a&state=evil" });
    const url = new URL(built);
    assert.equal(url.searchParams.get("client_id"), "a&state=evil");
    assert.equal(url.searchParams.get("state"), params.state);
    assert.equal(url.searchParams.getAll("state").length, 1);
  });

  it("never includes a client secret or a verifier", () => {
    for (const provider of OAUTH_PROVIDERS) {
      const built = buildAuthorizeUrl(provider, params);
      assert.doesNotMatch(built, /secret|verifier/i);
    }
  });
});

describe("pickGithubEmail", () => {
  it("picks the primary AND verified address, lowercase", () => {
    const list = [
      { email: "old@example.com", primary: false, verified: true },
      { email: "Main@Example.COM", primary: true, verified: true },
      { email: "other@example.com", primary: false, verified: false }
    ];
    assert.equal(pickGithubEmail(list), "main@example.com");
  });

  it("refuses a primary address that is not verified", () => {
    assert.equal(pickGithubEmail([{ email: "a@example.com", primary: true, verified: false }]), null);
  });

  it("refuses a verified address that is not primary", () => {
    assert.equal(pickGithubEmail([{ email: "a@example.com", primary: false, verified: true }]), null);
  });

  it("does not accept look-alike truthy values", () => {
    assert.equal(pickGithubEmail([{ email: "a@example.com", primary: "true", verified: 1 }]), null);
    assert.equal(pickGithubEmail([{ email: "a@example.com", primary: true, verified: "true" }]), null);
  });

  it("skips entries that are not usable addresses and keeps looking", () => {
    const list = [
      { email: "no spaces allowed@example.com", primary: true, verified: true },
      { email: "ok@example.com", primary: true, verified: true }
    ];
    assert.equal(pickGithubEmail(list), "ok@example.com");
    assert.equal(pickGithubEmail([{ email: "bad\r\nBcc: x@y.com", primary: true, verified: true }]), null);
    assert.equal(pickGithubEmail([{ email: "ünï@example.com", primary: true, verified: true }]), null);
    assert.equal(pickGithubEmail([{ email: 42, primary: true, verified: true }]), null);
  });

  it("returns null for anything that is not a list of objects", () => {
    for (const value of [undefined, null, "a@example.com", 7, {}, [], [null], ["a@example.com"], [[]]]) {
      assert.equal(pickGithubEmail(value), null, JSON.stringify(value));
    }
    // GitHub's error body is an object, not a list.
    assert.equal(pickGithubEmail({ message: "Bad credentials" }), null);
  });
});

describe("parseGoogleUserinfo", () => {
  const good = { sub: "110169484474386276334", email: "Alice@Example.com", email_verified: true, name: "Alice  Smith" };

  it("reads a verified profile", () => {
    assert.deepEqual(parseGoogleUserinfo(good), {
      providerUserId: "110169484474386276334",
      email: "alice@example.com",
      displayName: "Alice Smith"
    });
  });

  it("works without a name", () => {
    const { name: _name, ...noName } = good;
    assert.equal(parseGoogleUserinfo(noName)?.displayName, null);
  });

  it("requires email_verified to be exactly true", () => {
    for (const value of [false, "true", 1, null, undefined]) {
      assert.equal(parseGoogleUserinfo({ ...good, email_verified: value }), null, JSON.stringify(value));
    }
    const { email_verified: _ev, ...missing } = good;
    assert.equal(parseGoogleUserinfo(missing), null);
  });

  it("requires a usable sub", () => {
    for (const sub of [undefined, null, "", 123, "a b", "x".repeat(256), "bad/sub", "line\nbreak", ["1"]]) {
      assert.equal(parseGoogleUserinfo({ ...good, sub }), null, JSON.stringify(sub));
    }
    assert.equal(parseGoogleUserinfo({ ...good, sub: "x".repeat(255) })?.providerUserId, "x".repeat(255));
  });

  it("requires a usable email", () => {
    for (const email of [undefined, null, "", "not an email", "a@b", "a@@b.com", 5]) {
      assert.equal(parseGoogleUserinfo({ ...good, email }), null, JSON.stringify(email));
    }
  });

  it("returns null for anything that is not an object", () => {
    for (const value of [undefined, null, "", "sub", 3, [], [good]]) {
      assert.equal(parseGoogleUserinfo(value), null, JSON.stringify(value));
    }
  });
});

describe("cleanSuggestedName", () => {
  it("collapses whitespace, drops control characters and trims", () => {
    assert.equal(cleanSuggestedName("  Alice \t  Smith\n"), "Alice Smith");
    assert.equal(cleanSuggestedName("Al\u0000ice\u007f"), "Alice");
  });

  it("cuts at 40 characters", () => {
    const name = cleanSuggestedName("a".repeat(100));
    assert.equal(name, "a".repeat(40));
    assert.equal(cleanSuggestedName(`${"a".repeat(39)} ${"b".repeat(10)}`), "a".repeat(39));
  });

  it("returns null when nothing is left or the value is not text", () => {
    for (const value of ["", "   ", "\n\t", "\u0000", undefined, null, 5, {}]) {
      assert.equal(cleanSuggestedName(value), null, JSON.stringify(value));
    }
  });
});

describe("checkEmailDomain", () => {
  it("allows any domain when the list is empty", () => {
    assert.equal(checkEmailDomain("a@example.com", []), true);
    assert.equal(checkEmailDomain("a@anything.at.all", []), true);
  });

  it("requires an exact domain match when a list is set", () => {
    const list = ["school.edu", "uni.ma"];
    assert.equal(checkEmailDomain("a@school.edu", list), true);
    assert.equal(checkEmailDomain("a@UNI.MA", list), true);
    assert.equal(checkEmailDomain("a@mail.school.edu", list), false); // subdomains are not included
    assert.equal(checkEmailDomain("a@school.edu.evil.com", list), false);
    assert.equal(checkEmailDomain("a@evilschool.edu", list), false);
    assert.equal(checkEmailDomain("a@gmail.com", list), false);
  });

  it("uses the last @ and refuses addresses without a domain when a list is set", () => {
    const list = ["school.edu"];
    assert.equal(checkEmailDomain("a@evil.com@school.edu", list), true); // the domain is what follows the last @
    assert.equal(checkEmailDomain("school.edu", list), false);
    assert.equal(checkEmailDomain("a@", list), false);
    assert.equal(checkEmailDomain("@school.edu", list), false);
    assert.equal(checkEmailDomain("", list), false);
  });
});
