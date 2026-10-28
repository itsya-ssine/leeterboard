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
