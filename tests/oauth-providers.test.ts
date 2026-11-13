import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertOAuthDevAtBoot,
  decideOAuthDev,
  exchangeAndFetchProfile,
  OAuthError,
  oauthEndpoints,
  type ExchangeConfig
} from "../oauthProviders.js";

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const SECRET = "super-secret-client-secret";
const TOKEN = "gho_access_token_value";
const CODE = "the-authorization-code";
const config: ExchangeConfig = {
  clientId: "client-id",
  clientSecret: SECRET,
  redirectUri: "https://leaderboard-leet.vercel.app/api/auth/oauth/github/callback"
};

type Call = { url: string; init: RequestInit };
type Handler = (call: Call) => Response | Promise<Response>;

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// A scripted fetch: routes are "METHOD url". An unlisted call fails the test.
function scripted(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const key = `${init.method ?? "GET"} ${url}`;
    calls.push({ url, init });
    const handler = routes[key];
    assert.ok(handler, `unexpected call: ${key}`);
    return handler({ url, init });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

const headers = (init: RequestInit) => new Headers(init.headers);

const GITHUB = {
  token: "POST https://github.com/login/oauth/access_token",
  user: "GET https://api.github.com/user",
  emails: "GET https://api.github.com/user/emails"
};
const GOOGLE = {
  token: "POST https://oauth2.googleapis.com/token",
  userinfo: "GET https://openidconnect.googleapis.com/v1/userinfo"
};

const githubRoutes = (over: Record<string, Handler> = {}): Record<string, Handler> => ({
  [GITHUB.token]: () => jsonRes({ access_token: TOKEN, token_type: "bearer", scope: "read:user,user:email" }),
  [GITHUB.user]: () => jsonRes({ id: 583231, login: "octocat", name: "The  Octocat" }),
  [GITHUB.emails]: () =>
    jsonRes([
      { email: "Octo@Example.com", primary: true, verified: true },
      { email: "old@example.com", primary: false, verified: true }
    ]),
  ...over
});

const googleRoutes = (over: Record<string, Handler> = {}): Record<string, Handler> => ({
  [GOOGLE.token]: () => jsonRes({ access_token: TOKEN, id_token: "ignored", token_type: "Bearer" }),
  [GOOGLE.userinfo]: () =>
    jsonRes({ sub: "110169484474386276334", email: "Alice@Example.com", email_verified: true, name: "Alice" }),
  ...over
});

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof OAuthError, `expected an OAuthError, got ${String(err)}`);
    return err.kind;
  }
  assert.fail("expected the exchange to fail");
}

describe("exchangeAndFetchProfile: GitHub", () => {
  it("trades the code and reads id, verified primary email and name", async () => {
    const fake = scripted(githubRoutes());
    const profile = await exchangeAndFetchProfile("github", CODE, VERIFIER, config, { fetch: fake.fetch });
    assert.deepEqual(profile, { providerUserId: "583231", email: "octo@example.com", displayName: "The Octocat" });
    assert.equal(fake.calls.length, 3);
  });

  it("sends the token request with the code, PKCE verifier, redirect_uri and credentials", async () => {
    const fake = scripted(githubRoutes());
    await exchangeAndFetchProfile("github", CODE, VERIFIER, config, { fetch: fake.fetch });
    const token = fake.calls[0];
    assert.equal(token.url, "https://github.com/login/oauth/access_token");
    assert.equal(headers(token.init).get("accept"), "application/json");
    assert.equal(headers(token.init).get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(String(token.init.body)), {
      client_id: "client-id",
      client_secret: SECRET,
      code: CODE,
      redirect_uri: config.redirectUri,
      code_verifier: VERIFIER
    });
  });

  it("calls the API with the Bearer token and a User-Agent, and never sends the secret there", async () => {
    const fake = scripted(githubRoutes());
    await exchangeAndFetchProfile("github", CODE, VERIFIER, config, { fetch: fake.fetch });
    for (const call of fake.calls.slice(1)) {
      assert.equal(headers(call.init).get("authorization"), `Bearer ${TOKEN}`);
      assert.ok(headers(call.init).get("user-agent"), "GitHub refuses API calls without a User-Agent");
      assert.equal(call.init.body, undefined);
      assert.doesNotMatch(JSON.stringify([call.url, [...headers(call.init).entries()]]), new RegExp(SECRET));
    }
  });

  it("falls back to the login for the suggested name", async () => {
    const fake = scripted(githubRoutes({ [GITHUB.user]: () => jsonRes({ id: 7, login: "octocat", name: null }) }));
    const profile = await exchangeAndFetchProfile("github", CODE, VERIFIER, config, { fetch: fake.fetch });
    assert.equal(profile.displayName, "octocat");
  });

  it("refuses an account whose primary address is not verified, or that has no primary one", async () => {
    for (const list of [
      [{ email: "a@example.com", primary: true, verified: false }],
      [{ email: "a@example.com", primary: false, verified: true }],
      []
    ]) {
      const fake = scripted(githubRoutes({ [GITHUB.emails]: () => jsonRes(list) }));
      assert.equal(await kindOf(exchangeAndFetchProfile("github", CODE, VERIFIER, config, { fetch: fake.fetch })), "unverified_email");
    }
  });

  it("fails when GitHub answers 200 with an error body (bad or reused code)", async () => {
    const fake = scripted({
      [GITHUB.token]: () => jsonRes({ error: "bad_verification_code", error_description: "FAKE-PROVIDER-ERROR-TEXT" })
    });
    assert.equal(await kindOf(exchangeAndFetchProfile("github", CODE, VERIFIER, config, { fetch: fake.fetch })), "failed");
    assert.equal(fake.calls.length, 1, "no profile call without a token");
  });

  it("fails on a bad token shape, a bad user id, non-2xx and non-JSON answers", async () => {
    const cases: Record<string, Record<string, Handler>> = {
      "token not a string": { [GITHUB.token]: () => jsonRes({ access_token: 123 }) },
      "token with a line break": { [GITHUB.token]: () => jsonRes({ access_token: "abc\r\nX-Evil: 1" }) },
      "token endpoint 500": { [GITHUB.token]: () => jsonRes({}, 500) },
      "token endpoint answers HTML": { [GITHUB.token]: () => new Response("<html>", { status: 200 }) },
      "token endpoint answers form text": { [GITHUB.token]: () => new Response("access_token=x&token_type=bearer") },
      "user id missing": { [GITHUB.user]: () => jsonRes({ login: "x" }) },
      "user id a string": { [GITHUB.user]: () => jsonRes({ id: "583231", login: "x" }) },
      "user id zero": { [GITHUB.user]: () => jsonRes({ id: 0 }) },
      "user id not an integer": { [GITHUB.user]: () => jsonRes({ id: 1.5 }) },
      "user is a list": { [GITHUB.user]: () => jsonRes([{ id: 1 }]) },
      "user 401": { [GITHUB.user]: () => jsonRes({ message: "Bad credentials" }, 401) },
      "emails 404 (scope missing)": { [GITHUB.emails]: () => jsonRes({ message: "Not Found" }, 404) },
      "emails not JSON": { [GITHUB.emails]: () => new Response("nope") }
    };
    for (const [name, over] of Object.entries(cases)) {
      const fake = scripted(githubRoutes(over));
      assert.equal(await kindOf(exchangeAndFetchProfile("github", CODE, VERIFIER, config, { fetch: fake.fetch })), "failed", name);
    }
  });
});

describe("exchangeAndFetchProfile: Google", () => {
  const googleConfig = { ...config, redirectUri: "https://leaderboard-leet.vercel.app/api/auth/oauth/google/callback" };

  it("trades the code and reads sub, verified email and name", async () => {
    const fake = scripted(googleRoutes());
    const profile = await exchangeAndFetchProfile("google", CODE, VERIFIER, googleConfig, { fetch: fake.fetch });
    assert.deepEqual(profile, { providerUserId: "110169484474386276334", email: "alice@example.com", displayName: "Alice" });
    assert.equal(fake.calls.length, 2);
  });

  it("sends a form-encoded token request with the code, PKCE verifier and redirect_uri", async () => {
    const fake = scripted(googleRoutes());
    await exchangeAndFetchProfile("google", CODE, VERIFIER, googleConfig, { fetch: fake.fetch });
    const token = fake.calls[0];
    assert.equal(headers(token.init).get("content-type"), "application/x-www-form-urlencoded");
    const body = new URLSearchParams(String(token.init.body));
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("code"), CODE);
    assert.equal(body.get("code_verifier"), VERIFIER);
    assert.equal(body.get("redirect_uri"), googleConfig.redirectUri);
    assert.equal(body.get("client_id"), "client-id");
    assert.equal(body.get("client_secret"), SECRET);
  });

  it("reads the profile from userinfo with the Bearer token, ignoring the id_token", async () => {
    const fake = scripted(googleRoutes());
    await exchangeAndFetchProfile("google", CODE, VERIFIER, googleConfig, { fetch: fake.fetch });
    assert.equal(headers(fake.calls[1].init).get("authorization"), `Bearer ${TOKEN}`);
    assert.doesNotMatch(JSON.stringify(fake.calls[1]), /ignored/);
  });

  it("refuses an unverified address as unverified_email, but a garbage answer as failed", async () => {
    for (const email_verified of [false, "true", undefined]) {
      const fake = scripted(googleRoutes({ [GOOGLE.userinfo]: () => jsonRes({ sub: "1", email: "a@example.com", email_verified }) }));
      assert.equal(
        await kindOf(exchangeAndFetchProfile("google", CODE, VERIFIER, googleConfig, { fetch: fake.fetch })),
        "unverified_email",
        String(email_verified)
      );
    }
    for (const body of [{}, { email: "a@example.com", email_verified: true }, [], "text"]) {
      const fake = scripted(googleRoutes({ [GOOGLE.userinfo]: () => jsonRes(body) }));
      assert.equal(await kindOf(exchangeAndFetchProfile("google", CODE, VERIFIER, googleConfig, { fetch: fake.fetch })), "failed", JSON.stringify(body));
    }
  });

  it("fails when Google refuses the code or the token", async () => {
    const refused = scripted(googleRoutes({ [GOOGLE.token]: () => jsonRes({ error: "invalid_grant" }, 400) }));
    assert.equal(await kindOf(exchangeAndFetchProfile("google", CODE, VERIFIER, googleConfig, { fetch: refused.fetch })), "failed");
    assert.equal(refused.calls.length, 1);
    const noToken = scripted(googleRoutes({ [GOOGLE.token]: () => jsonRes({ id_token: "only an id token" }) }));
    assert.equal(await kindOf(exchangeAndFetchProfile("google", CODE, VERIFIER, googleConfig, { fetch: noToken.fetch })), "failed");
    const denied = scripted(googleRoutes({ [GOOGLE.userinfo]: () => jsonRes({ error: "invalid_token" }, 401) }));
    assert.equal(await kindOf(exchangeAndFetchProfile("google", CODE, VERIFIER, googleConfig, { fetch: denied.fetch })), "failed");
  });
});

describe("exchangeAndFetchProfile: safety rules", () => {
  it("refuses a malformed code or verifier before any network call", async () => {
    const fake = scripted({});
    for (const code of ["", " ", "a b", "line\nbreak", "é", "x".repeat(2049), undefined, null, 5, ["c"]]) {
      assert.equal(await kindOf(exchangeAndFetchProfile("github", code as never, VERIFIER, config, { fetch: fake.fetch })), "failed");
    }
    for (const verifier of ["", "short", "x".repeat(129), "has space ".repeat(5), undefined, null]) {
      assert.equal(await kindOf(exchangeAndFetchProfile("google", CODE, verifier as never, config, { fetch: fake.fetch })), "failed");
    }
    assert.equal(fake.calls.length, 0);
  });

  it("times out as unavailable, and never retries", async () => {
    let attempts = 0;
    const hanging = ((_: unknown, init: RequestInit) => {
      attempts++;
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    }) as unknown as typeof fetch;
    const started = Date.now();
    assert.equal(await kindOf(exchangeAndFetchProfile("github", CODE, VERIFIER, config, { fetch: hanging, timeoutMs: 30 })), "unavailable");
    assert.ok(Date.now() - started < 1000, "the timeout must apply");
    assert.equal(attempts, 1);
  });

  it("times out when the answer starts but the body never finishes", async () => {
    const stalling = ((_: unknown, init: RequestInit) =>
      Promise.resolve({
        status: 200,
        body: null,
        text: () =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
          })
      })) as unknown as typeof fetch;
    assert.equal(await kindOf(exchangeAndFetchProfile("github", CODE, VERIFIER, config, { fetch: stalling, timeoutMs: 30 })), "unavailable");
  });

  it("treats a network failure as unavailable", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    assert.equal(await kindOf(exchangeAndFetchProfile("google", CODE, VERIFIER, config, { fetch: down })), "unavailable");
  });

  it("does not follow redirects: a 3xx is a failure and nothing else is contacted", async () => {
    const fake = scripted({
      [GITHUB.token]: () => new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } })
    });
    assert.equal(await kindOf(exchangeAndFetchProfile("github", CODE, VERIFIER, config, { fetch: fake.fetch })), "failed");
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].init.redirect, "manual");
  });

  it("sets redirect: manual and an abort signal on every call", async () => {
    const fake = scripted(githubRoutes());
    await exchangeAndFetchProfile("github", CODE, VERIFIER, config, { fetch: fake.fetch });
    for (const call of fake.calls) {
      assert.equal(call.init.redirect, "manual");
      assert.ok(call.init.signal instanceof AbortSignal);
    }
  });

  it("refuses an oversized answer", async () => {
    const huge = scripted(githubRoutes({ [GITHUB.token]: () => new Response(`{"access_token":"${"a".repeat(300_000)}"}`) }));
    assert.equal(await kindOf(exchangeAndFetchProfile("github", CODE, VERIFIER, config, { fetch: huge.fetch })), "failed");
  });

  it("never copies provider text, the token, the secret or the code into the error, and logs nothing", async () => {
    const logged: string[] = [];
    const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    for (const name of Object.keys(originals) as (keyof typeof originals)[]) {
      console[name] = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
    }
    try {
      const fake = scripted(
        githubRoutes({
          [GITHUB.emails]: () => jsonRes({ message: `leak ${TOKEN} ${SECRET} ${CODE} FAKE-PROVIDER-ERROR-TEXT` }, 403)
        })
      );
      let caught: unknown;
      try {
        await exchangeAndFetchProfile("github", CODE, VERIFIER, config, { fetch: fake.fetch });
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof OAuthError);
      const everything = [caught.message, caught.name, String(caught.stack ?? "").split("\n")[0], JSON.stringify(caught), String(caught)].join("\n");
      for (const secret of [TOKEN, SECRET, CODE, VERIFIER, "FAKE-PROVIDER-ERROR-TEXT", "leak"]) {
        assert.equal(everything.includes(secret), false, `error leaked ${secret}`);
      }
      assert.deepEqual(logged, []);
    } finally {
      Object.assign(console, originals);
    }
  });

  it("uses a fixed message per kind", () => {
    assert.match(new OAuthError("failed").message, /could not be used/);
    assert.match(new OAuthError("unavailable").message, /did not answer in time/);
    assert.match(new OAuthError("unverified_email").message, /no verified email/);
  });
});

describe("oauthEndpoints and the development override", () => {
  it("uses the real provider hosts by default", () => {
    assert.deepEqual(oauthEndpoints("github"), {
      token: "https://github.com/login/oauth/access_token",
      user: "https://api.github.com/user",
      emails: "https://api.github.com/user/emails"
    });
    assert.deepEqual(oauthEndpoints("google"), {
      token: "https://oauth2.googleapis.com/token",
      user: "https://openidconnect.googleapis.com/v1/userinfo",
      emails: null
    });
  });

  it("reads every endpoint from the override base, and contacts no real host", async () => {
    assert.deepEqual(oauthEndpoints("github", "http://127.0.0.1:4010/"), {
      token: "http://127.0.0.1:4010/github/login/oauth/access_token",
      user: "http://127.0.0.1:4010/github/user",
      emails: "http://127.0.0.1:4010/github/user/emails"
    });
    assert.deepEqual(oauthEndpoints("google", "http://127.0.0.1:4010"), {
      token: "http://127.0.0.1:4010/google/token",
      user: "http://127.0.0.1:4010/google/userinfo",
      emails: null
    });

    const base = "http://127.0.0.1:4010";
    const github = scripted({
      "POST http://127.0.0.1:4010/github/login/oauth/access_token": githubRoutes()[GITHUB.token],
      "GET http://127.0.0.1:4010/github/user": githubRoutes()[GITHUB.user],
      "GET http://127.0.0.1:4010/github/user/emails": githubRoutes()[GITHUB.emails]
    });
    const profile = await exchangeAndFetchProfile("github", CODE, VERIFIER, { ...config, devBaseUrl: base }, { fetch: github.fetch });
    assert.equal(profile.providerUserId, "583231");
    assert.ok(github.calls.every((c) => c.url.startsWith(base)));

    const google = scripted({
      "POST http://127.0.0.1:4010/google/token": googleRoutes()[GOOGLE.token],
      "GET http://127.0.0.1:4010/google/userinfo": googleRoutes()[GOOGLE.userinfo]
    });
    await exchangeAndFetchProfile("google", CODE, VERIFIER, { ...config, devBaseUrl: base }, { fetch: google.fetch });
    assert.ok(google.calls.every((c) => c.url.startsWith(base)));
  });
});

describe("decideOAuthDev", () => {
  it("does nothing when the override is unset or blank", () => {
    for (const env of [{}, { OAUTH_DEV_PROVIDER_URL: "" }, { OAUTH_DEV_PROVIDER_URL: "   " }, { NODE_ENV: "production", OAUTH_DEV_PROVIDER_URL: "" }]) {
      assert.deepEqual(decideOAuthDev(env), { devBaseUrl: null, warnings: [], fatal: null });
    }
  });

  it("is FATAL in production, however it is detected, and gives no base URL", () => {
    for (const env of [
      { NODE_ENV: "production", OAUTH_DEV_PROVIDER_URL: "http://localhost:4010" },
      { VERCEL: "1", OAUTH_DEV_PROVIDER_URL: "http://localhost:4010" },
      { NODE_ENV: "production", OAUTH_DEV_PROVIDER_URL: "https://evil.example" }
    ]) {
      const decision = decideOAuthDev(env);
      assert.equal(decision.devBaseUrl, null);
      assert.match(decision.fatal ?? "", /for development and tests only/);
      assert.match(decision.fatal ?? "", /Refusing to start in production/);
    }
  });

  it("accepts a loopback address outside production, with a warning, and trims trailing slashes", () => {
    for (const [value, base] of [
      ["http://localhost:4010", "http://localhost:4010"],
      ["http://127.0.0.1:4010/", "http://127.0.0.1:4010"],
      ["http://[::1]:4010", "http://[::1]:4010"],
      ["  http://localhost:4010/fake//  ", "http://localhost:4010/fake"]
    ]) {
      const decision = decideOAuthDev({ OAUTH_DEV_PROVIDER_URL: value });
      assert.equal(decision.fatal, null, value);
      assert.equal(decision.devBaseUrl, base, value);
      assert.match(decision.warnings.join(" "), /not by GitHub or Google/);
    }
    assert.equal(decideOAuthDev({ NODE_ENV: "development", OAUTH_DEV_PROVIDER_URL: "http://localhost:1" }).fatal, null);
  });

  it("refuses anything that is not a plain loopback http(s) address", () => {
    for (const value of [
      "not a url",
      "ftp://localhost",
      "javascript:alert(1)",
      "https://github.com", // the override must never be able to point at another host
      "http://example.com",
      "http://localhost.evil.example",
      "http://127.0.0.1.evil.example",
      "http://user:pass@localhost:4010",
      "http://localhost:4010?x=1",
      "http://localhost:4010#frag"
    ]) {
      const decision = decideOAuthDev({ OAUTH_DEV_PROVIDER_URL: value });
      assert.ok(decision.fatal, `expected ${value} to be refused`);
      assert.equal(decision.devBaseUrl, null);
    }
  });
});

describe("assertOAuthDevAtBoot", () => {
  it("calls onFatal in production and prints the reason", () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args.map(String).join(" "));
    try {
      let message = "";
      assert.throws(
        () =>
          assertOAuthDevAtBoot({ NODE_ENV: "production", OAUTH_DEV_PROVIDER_URL: "http://localhost:4010" }, (m) => {
            message = m;
            throw new Error("exit");
          }),
        /exit/
      );
      assert.match(message, /Refusing to start in production/);
    } finally {
      console.error = original;
    }
  });

  it("prints a warning (and does not stop) when the override is active in development", () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
    try {
      const decision = assertOAuthDevAtBoot({ OAUTH_DEV_PROVIDER_URL: "http://localhost:4010" }, () => assert.fail("must not stop"));
      assert.equal(decision.devBaseUrl, "http://localhost:4010");
      assert.match(warnings.join("\n"), /\[OAuth\] Using OAUTH_DEV_PROVIDER_URL/);
    } finally {
      console.warn = original;
    }
  });

  it("is silent when the override is unset", () => {
    const original = { warn: console.warn, error: console.error };
    let printed = 0;
    console.warn = console.error = () => void printed++;
    try {
      assertOAuthDevAtBoot({ NODE_ENV: "production" }, () => assert.fail("must not stop"));
      assert.equal(printed, 0);
    } finally {
      Object.assign(console, original);
    }
  });
});
