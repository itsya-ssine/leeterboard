import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

// Black-box test harness: starts the real server (server.ts) on a free port
// with a throwaway SQLite database, so the tests exercise the same
// middleware, limiters and routes that production runs — no mocks.

export interface TestServer {
  url: string;
  dbUrl: string;
  secret: string;
  logs: () => string;
  stop: () => Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

export async function startServer(extraEnv: Record<string, string> = {}): Promise<TestServer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-test-"));
  const dbUrl = `file:${path.join(dir, "test.db")}`;
  const secret = extraEnv.JWT_SECRET ?? crypto.randomBytes(48).toString("hex");
  const port = await freePort();
  const root = path.resolve(import.meta.dirname, "..");

  let output = "";
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      JWT_SECRET: secret,
      TURSO_DATABASE_URL: dbUrl,
      TURSO_AUTH_TOKEN: "",
      ADMIN_LEETCODE_USERNAMES: "test_admin",
      VERCEL: "",
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout?.on("data", (d) => (output += d));
  child.stderr?.on("data", (d) => (output += d));

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${output}`);
    try {
      const res = await fetch(`${url}/api/auth/session`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server did not start in time:\n${output}`);
    await new Promise((r) => setTimeout(r, 300));
  }

  return {
    url,
    dbUrl,
    secret,
    logs: () => output,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise((r) => child.once("exit", r));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

export interface ApiResult {
  status: number;
  headers: Headers;
  text: string;
  json: any;
  cookie: string | null; // the session cookie set by the response, as "session=..."
}

export function client(server: TestServer) {
  const api = async function (
    method: string,
    route: string,
    opts: { body?: unknown; rawBody?: string; cookie?: string | null; headers?: Record<string, string> } = {}
  ): Promise<ApiResult> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    let body: string | undefined;
    if (opts.rawBody !== undefined) body = opts.rawBody;
    else if (opts.body !== undefined) body = JSON.stringify(opts.body);
    if (body !== undefined && !("content-type" in headers)) headers["content-type"] = "application/json";
    if (opts.cookie) headers.cookie = opts.cookie;

    const res = await fetch(server.url + route, { method, headers, body });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    const setCookie = res.headers.get("set-cookie");
    const cookie = setCookie?.match(/(?:^|,\s*)((?:__Host-)?session=[^;]+)/)?.[1] ?? null;
    return { status: res.status, headers: res.headers, text, json, cookie };
  };
  // The server's address, for the helpers below that must not follow redirects.
  return Object.assign(api, { baseUrl: server.url });
}

// What signUpViaOAuth and signInViaOAuth need from tests/f2-seed.ts makeFakeOAuth().
interface OAuthApprover {
  issueCode(provider: "github" | "google", profile: { id: string | number; email: string; name?: string }): string;
}

// Every call comes from its own client IP (x-forwarded-for; production trusts one
// proxy), because the OAuth routes are limited per IP. Pass `ip` to spend one on purpose.
let oauthIpSeq = 0;
let oauthIdSeq = 0;
const nextOAuthIp = () => `10.88.${Math.floor(++oauthIpSeq / 250)}.${(oauthIpSeq % 250) + 1}`;

// start -> the (fake) provider approves -> callback, the way a browser does it.
async function oauthRoundTrip(
  api: ReturnType<typeof client>,
  fake: OAuthApprover,
  input: { provider: "github" | "google"; providerUserId: string; email: string; displayName?: string; ip: string }
) {
  const headers = { "x-forwarded-for": input.ip };
  const start = await fetch(`${api.baseUrl}/api/auth/oauth/${input.provider}/start`, { redirect: "manual", headers });
  const state = new URL(start.headers.get("location") ?? "").searchParams.get("state");
  const stateCookie = start.headers
    .getSetCookie()
    .find((c) => c.startsWith("oauth_state=") || c.startsWith("__Secure-oauth_state="))
    ?.split(";")[0];
  if (!state || !stateCookie) throw new Error(`oauth start gave no state (status ${start.status})`);
  const code = fake.issueCode(input.provider, { id: input.providerUserId, email: input.email, name: input.displayName });
  const cb = await fetch(`${api.baseUrl}/api/auth/oauth/${input.provider}/callback?code=${code}&state=${state}`, {
    redirect: "manual",
    headers: { ...headers, cookie: stateCookie }
  });
  const set = cb.headers.getSetCookie();
  const pick = (name: string) =>
    set.find((c) => c.startsWith(`${name}=`) || c.startsWith(`__Host-${name}=`) || c.startsWith(`__Secure-${name}=`))?.split(";")[0] ?? null;
  return { status: cb.status, location: cb.headers.get("location") ?? "", signupCookie: pick("oauth_signup"), sessionCookie: pick("session") };
}

/**
 * Signs a new member up through the real flow (provider step, then choosing a
 * username) and returns what POST /api/auth/oauth/complete answered, with the
 * session cookie in `cookie`. The server under test must have been started with
 * the fake provider and the OAuth variables (tests/f2-seed.ts OAUTH_TEST_ENV).
 * Throws if the provider step does not lead to the username screen.
 */
export async function signUpViaOAuth(
  api: ReturnType<typeof client>,
  fake: OAuthApprover,
  input: {
    username: string;
    provider?: "github" | "google";
    email?: string;
    displayName?: string;
    providerUserId?: string;
    ip?: string;
  }
): Promise<ApiResult> {
  const ip = input.ip ?? nextOAuthIp();
  const email = input.email ?? `${input.username.toLowerCase().replace(/[^a-z0-9]/g, "")}@example.com`;
  const step = await oauthRoundTrip(api, fake, {
    provider: input.provider ?? "github",
    providerUserId: input.providerUserId ?? `9${String(++oauthIdSeq).padStart(8, "0")}`,
    email,
    ip
  });
  if (!step.signupCookie || step.location !== "/#/signup/username") {
    throw new Error(`signUpViaOAuth: the provider step ended at ${step.location} for ${email}`);
  }
  return api("POST", "/api/auth/oauth/complete", {
    body: { username: input.username, displayName: input.displayName },
    cookie: step.signupCookie,
    headers: { "x-forwarded-for": ip }
  });
}

/** Signs an existing member in with their provider identity. Returns where the browser was sent and the session cookie. */
export async function signInViaOAuth(
  api: ReturnType<typeof client>,
  fake: OAuthApprover,
  input: { provider?: "github" | "google"; providerUserId: string; email: string; ip?: string }
) {
  const step = await oauthRoundTrip(api, fake, {
    provider: input.provider ?? "github",
    providerUserId: input.providerUserId,
    email: input.email,
    ip: input.ip ?? nextOAuthIp()
  });
  return { status: step.status, location: step.location, cookie: step.sessionCookie };
}

/** Only the provider step of a sign-in: where the browser was sent, and any sign-up or session cookie set. */
export async function approveViaOAuth(
  api: ReturnType<typeof client>,
  fake: OAuthApprover,
  input: { provider?: "github" | "google"; providerUserId?: string; email: string; ip?: string }
) {
  return oauthRoundTrip(api, fake, {
    provider: input.provider ?? "github",
    providerUserId: input.providerUserId ?? `8${String(++oauthIdSeq).padStart(8, "0")}`,
    email: input.email,
    ip: input.ip ?? nextOAuthIp()
  });
}
