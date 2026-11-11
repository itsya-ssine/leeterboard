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
  return async function api(
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
    const cookie = setCookie?.match(/(?:^|,\s*)(session=[^;]+)/)?.[1] ?? null;
    return { status: res.status, headers: res.headers, text, json, cookie };
  };
}

/**
 * Signs a member up through the real two-step flow and returns what the verify
 * step answered: start, read the 6-digit code from the fake mail outbox
 * (tests/f2-seed.ts makeFakeMail), then verify with the "signup" cookie the
 * start step set. The server under test must have been started with
 * `mail.env`.
 *
 * Every call comes from its own client IP (x-forwarded-for; production trusts
 * one proxy), because sign-up is limited to 10 starts an hour per IP and the
 * verify step to 20 per 15 minutes. Pass `ip` to spend one IP on purpose.
 */
let registerIpSeq = 0;
export async function registerViaApi(
  api: ReturnType<typeof client>,
  mail: { lastCode(to: string): string | null },
  input: { username: string; password: string; email?: string; displayName?: string; ip?: string }
): Promise<ApiResult> {
  const email = input.email ?? `${input.username.toLowerCase().replace(/[^a-z0-9]/g, "")}@example.com`;
  const ip = input.ip ?? `10.88.${Math.floor(++registerIpSeq / 250)}.${(registerIpSeq % 250) + 1}`;
  const headers = { "x-forwarded-for": ip };

  const started = await api("POST", "/api/auth/register/start", {
    body: { username: input.username, password: input.password, email, displayName: input.displayName },
    headers
  });
  if (started.status !== 200) return started;

  const signup = /(?:^|,\s*)signup=([^;]+)/.exec(started.headers.get("set-cookie") ?? "")?.[1];
  const code = mail.lastCode(email);
  if (!signup || !code) throw new Error(`registerViaApi: no signup cookie or no mailed code for ${email}`);
  return api("POST", "/api/auth/register/verify", { body: { code }, cookie: `signup=${signup}`, headers });
}
