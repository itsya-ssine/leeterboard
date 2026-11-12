// Preloaded into the TEST server process only (NODE_OPTIONS=--import <this file>).
//
// Stands in for GitHub and Google's server-to-server endpoints, the same way
// fake-mail.mjs stands in for Resend. The server under test therefore runs in
// production mode with the REAL oauthProviders.ts code, calling the REAL URLs;
// only the network is faked. (The development override OAUTH_DEV_PROVIDER_URL is
// refused in production, so black-box tests must not use it.)
//
// It fakes exactly these calls and sends every other request to the real fetch:
//
//   POST https://github.com/login/oauth/access_token
//   GET  https://api.github.com/user
//   GET  https://api.github.com/user/emails
//   POST https://oauth2.googleapis.com/token
//   GET  https://openidconnect.googleapis.com/v1/userinfo
//
// A test "approves" a sign-in by writing a code file (makeFakeOAuth().issueCode
// in f2-seed.ts), then drives the server's /callback with that code:
//
//   <dir>/codes/<provider>-<code>.json   {profile, options}   waiting to be exchanged
//   <dir>/codes/<provider>-<code>.used                        already exchanged (codes are single use)
//   <dir>/calls.log                      one line per call: "github token", "google userinfo", ...
//
// options (all optional) make the failure paths testable:
//   unverified  GitHub: primary email not verified / Google: email_verified false
//   noPrimary   GitHub: only a verified NON-primary address (no usable one)
//   badToken    the token endpoint refuses the code
//   down        the token endpoint answers 500 (and the code stays unused)
//   slow        the token endpoint never answers (the caller's timeout fires)
//   challenge   the PKCE challenge the provider was given; the verifier sent at
//               exchange must hash to it, otherwise the exchange is refused
//
// Like the real providers it needs a Bearer token on the API calls, a
// User-Agent on GitHub's, "Accept: application/json" on GitHub's token call
// (otherwise it answers in the old form-encoded style, which must not parse),
// and a form-encoded body on Google's token call.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const realFetch = globalThis.fetch;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Distinctive on purpose: tests assert it never shows up in an error, a log or a redirect.
const PROVIDER_TEXT = "FAKE-PROVIDER-ERROR-TEXT";

const SAFE = /^[A-Za-z0-9_-]{1,80}$/;

function headerOf(init, name) {
  const h = init?.headers;
  if (!h) return null;
  if (typeof h.get === "function") return h.get(name);
  for (const [k, v] of Object.entries(h)) if (k.toLowerCase() === name.toLowerCase()) return String(v);
  return null;
}

const record = (dir, line) => fs.appendFileSync(path.join(dir, "calls.log"), `${line}\n`);

// Resolves never; rejects like fetch does when the caller aborts.
function hang(init) {
  return new Promise((_, reject) => {
    const fail = () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
    const signal = init?.signal;
    if (signal?.aborted) return fail();
    signal?.addEventListener("abort", fail, { once: true });
  });
}

const codeFile = (dir, provider, code, ext) => path.join(dir, "codes", `${provider}-${code}.${ext}`);

function readEntry(dir, provider, code, ext) {
  if (typeof code !== "string" || !SAFE.test(code)) return null;
  const file = codeFile(dir, provider, code, ext);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

const badCode = (provider) =>
  provider === "github"
    ? json(200, { error: "bad_verification_code", error_description: PROVIDER_TEXT })
    : json(400, { error: "invalid_grant", error_description: PROVIDER_TEXT });

// The shared part of both token endpoints. Returns a Response or the access token.
async function redeem(dir, provider, code, verifier, init) {
  const entry = readEntry(dir, provider, code, "json");
  if (!entry) return badCode(provider); // unknown, expired or already used
  const { options = {} } = entry;
  if (options.slow) return hang(init);
  if (options.down) return json(500, { message: PROVIDER_TEXT });
  // From here the code is spent, whatever the answer (providers invalidate it).
  fs.renameSync(codeFile(dir, provider, code, "json"), codeFile(dir, provider, code, "used"));
  if (options.badToken) return badCode(provider);
  if (options.challenge) {
    const expected = crypto.createHash("sha256").update(String(verifier)).digest("base64url");
    if (expected !== options.challenge) return badCode(provider);
  }
  return `fake-${provider}-token-${code}`;
}

// The profile the Bearer token stands for, or a Response for a refused call.
function whoIs(dir, provider, init) {
  const auth = headerOf(init, "authorization") ?? "";
  const match = /^Bearer (fake-(github|google)-token-([A-Za-z0-9_-]{1,80}))$/.exec(auth);
  if (!match || match[2] !== provider) {
    return json(401, { message: "Bad credentials", error: { message: PROVIDER_TEXT } });
  }
  const entry = readEntry(dir, provider, match[3], "used");
  return entry ?? json(401, { message: "Bad credentials" });
}

async function githubToken(dir, init) {
  record(dir, "github token");
  let body;
  try {
    body = JSON.parse(String(init?.body ?? ""));
  } catch {
    return json(400, { error: "bad_request" });
  }
  for (const key of ["client_id", "client_secret", "code", "redirect_uri", "code_verifier"]) {
    if (typeof body[key] !== "string" || body[key] === "") {
      return json(200, { error: "incorrect_client_credentials", error_description: PROVIDER_TEXT });
    }
  }
  const token = await redeem(dir, "github", body.code, body.code_verifier, init);
  if (typeof token !== "string") return token;
  if (!/application\/json/i.test(headerOf(init, "accept") ?? "")) {
    // Without "Accept: application/json" GitHub answers form-encoded text.
    return new Response(`access_token=${token}&token_type=bearer`, {
      status: 200,
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });
  }
  return json(200, { access_token: token, token_type: "bearer", scope: "read:user,user:email" });
}

function githubApi(dir, init, kind) {
  record(dir, `github ${kind}`);
  if (!headerOf(init, "user-agent")) {
    return json(403, { message: "Request forbidden by administrative rules. Please make sure your request has a User-Agent header." });
  }
  const who = whoIs(dir, "github", init);
  if (who instanceof Response) return who;
  const { profile, options = {} } = who;
  const login = profile.login ?? `user${profile.id}`;
  if (kind === "user") {
    return json(200, { login, id: Number(profile.id), name: profile.name ?? null, email: null });
  }
  const noreply = { email: `${profile.id}+${login}@users.noreply.github.com`, primary: false, verified: true, visibility: null };
  if (options.noPrimary) {
    return json(200, [{ email: profile.email, primary: false, verified: true, visibility: "private" }, noreply]);
  }
  return json(200, [
    { email: profile.email, primary: true, verified: !options.unverified, visibility: "private" },
    noreply
  ]);
}

async function googleToken(dir, init) {
  record(dir, "google token");
  if (!/application\/x-www-form-urlencoded/i.test(headerOf(init, "content-type") ?? "")) {
    return json(400, { error: "invalid_request", error_description: PROVIDER_TEXT });
  }
  const body = new URLSearchParams(String(init?.body ?? ""));
  if (body.get("grant_type") !== "authorization_code") return json(400, { error: "unsupported_grant_type" });
  for (const key of ["client_id", "client_secret", "code", "redirect_uri", "code_verifier"]) {
    if (!body.get(key)) return json(400, { error: "invalid_request", error_description: PROVIDER_TEXT });
  }
  const token = await redeem(dir, "google", body.get("code"), body.get("code_verifier"), init);
  if (typeof token !== "string") return token;
  return json(200, { access_token: token, expires_in: 3599, token_type: "Bearer", scope: "openid email profile" });
}

function googleUserinfo(dir, init) {
  record(dir, "google userinfo");
  const who = whoIs(dir, "google", init);
  if (who instanceof Response) return who;
  const { profile, options = {} } = who;
  return json(200, {
    sub: String(profile.id),
    email: profile.email,
    email_verified: !options.unverified,
    name: profile.name,
    picture: "https://lh3.googleusercontent.com/fake"
  });
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : (input?.url ?? String(input));
  const dir = process.env.FAKE_OAUTH_DIR;
  if (dir) {
    const method = String(init?.method ?? "GET").toUpperCase();
    if (method === "POST" && url === "https://github.com/login/oauth/access_token") return githubToken(dir, init);
    if (method === "GET" && url === "https://api.github.com/user") return githubApi(dir, init, "user");
    if (method === "GET" && url === "https://api.github.com/user/emails") return githubApi(dir, init, "emails");
    if (method === "POST" && url === "https://oauth2.googleapis.com/token") return googleToken(dir, init);
    if (method === "GET" && url === "https://openidconnect.googleapis.com/v1/userinfo") return googleUserinfo(dir, init);
  }
  return realFetch(input, init);
};
