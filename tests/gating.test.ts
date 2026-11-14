/**
 * The board is for members only: every route that returns member data needs a
 * signed-in session, and the only routes open to visitors are the ones that let
 * them sign in or up (and the feedback form).
 *
 * Two kinds of check: the real server answers visitors with 401 and members with
 * data, and a source-level inventory fails when any route is neither on the
 * short public list below nor protected by requireAuth / requireAdmin.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { client, startServer, type TestServer } from "./helpers.js";
import { makeUser } from "./f2-seed.js";

const PW = "correct-horse-battery-9";
const root = path.resolve(import.meta.dirname, "..");

let tmpDir = "";
let server: TestServer;
let api: ReturnType<typeof client>;
let leetcodeMemberCookie = "";
let plainMemberCookie = "";

const DATA_ROUTES: Array<[method: string, url: string]> = [
  ["GET", "/api/users"],
  ["GET", "/api/trends"],
  ["GET", "/api/trends?platform=codeforces"],
  ["POST", "/api/sync-if-stale"]
];

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-gating-"));
  const dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  const db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");

  await db.initDb();
  await db.client.execute("PRAGMA journal_mode = WAL");
  const hash = await hashPassword(PW);

  await db.insertUser(makeUser("gate_leetcoder"), hash);
  await db.insertUser(
    makeUser("Gate Plain", {
      leetcodeLinked: false,
      leetcodeUsername: "",
      lastUpdated: null,
      trackingStart: "",
      allTimeSolved: 0,
      easySolved: 0,
      mediumSolved: 0,
      hardSolved: 0,
      weeklyProgress: 0,
      monthlyProgress: 0,
      baselineSolved: 0
    }),
    hash,
    { loginUsername: "gate_plain" }
  );
  // The board counts as freshly synced, so sync-if-stale answers at once and
  // these tests never reach out to LeetCode.
  await db.setMeta("lastSyncAll", new Date().toISOString());

  server = await startServer({ TURSO_DATABASE_URL: dbUrl, JWT_SECRET: secret });
  api = client(server);

  const a = await api("POST", "/api/auth/login", { body: { username: "gate_leetcoder", password: PW } });
  const b = await api("POST", "/api/auth/login", { body: { username: "gate_plain", password: PW } });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  leetcodeMemberCookie = a.cookie!;
  plainMemberCookie = b.cookie!;
});

after(async () => {
  await server?.stop();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("visitors", () => {
  for (const [method, url] of DATA_ROUTES) {
    it(`get 401 from ${method} ${url}, and no member data`, async () => {
      const res = await api(method, url);
      assert.equal(res.status, 401);
      assert.equal(res.json.error, "You must be logged in to do that.");
      assert.equal(res.json.code, "session_required", "the frontend keys on this to end the session");
      for (const needle of ["gate_leetcoder", "Gate Plain", "gate_plain", "history", "allTimeSolved"]) {
        assert.equal(res.text.includes(needle), false, `the 401 mentions "${needle}"`);
      }
    });
  }

  it("get 401, not data, with a forged session cookie", async () => {
    const forged = `session=${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from('{"id":"x"}').toString("base64url")}.`;
    for (const [method, url] of DATA_ROUTES) {
      assert.equal((await api(method, url, { cookie: forged })).status, 401, `${method} ${url}`);
    }
  });

  it("can still reach the sign-in and sign-up pages' own endpoints", async () => {
    const session = await api("GET", "/api/auth/session");
    assert.equal(session.status, 200);
    assert.equal(session.json.status, "guest");
  });
});

describe("members", () => {
  it("see the board, with everyone on it", async () => {
    const res = await api("GET", "/api/users", { cookie: leetcodeMemberCookie });
    assert.equal(res.status, 200);
    const names = res.json.users.map((u: { displayName: string }) => u.displayName).sort();
    assert.deepEqual(names, ["Gate Plain", "gate_leetcoder"]);
  });

  it("can read the trends, overall and per platform", async () => {
    assert.equal((await api("GET", "/api/trends", { cookie: leetcodeMemberCookie })).status, 200);
    assert.equal((await api("GET", "/api/trends?platform=codeforces", { cookie: leetcodeMemberCookie })).status, 200);
  });

  it("can trigger a sync check, and a fresh board answers without scraping", async () => {
    const res = await api("POST", "/api/sync-if-stale", { cookie: leetcodeMemberCookie });
    assert.equal(res.status, 200);
    assert.equal(res.json.synced, false);
  });

  it("don't need a LeetCode account to see any of it", async () => {
    for (const [method, url] of DATA_ROUTES) {
      assert.equal((await api(method, url, { cookie: plainMemberCookie })).status, 200, `${method} ${url}`);
    }
  });
});

/* ---------- Source-level inventory ---------- */

// Every route open to someone who is not signed in. Anything else must carry
// requireAuth or requireAdmin. Adding a route here is a decision to make it
// public; review it as one.
const PUBLIC_ROUTES = new Set([
  "GET /api/health",
  "POST /api/auth/login",
  "GET /api/auth/oauth/:provider/start",
  "GET /api/auth/oauth/:provider/callback",
  "GET /api/auth/oauth/pending",
  "POST /api/auth/oauth/complete",
  "POST /api/auth/reset/start",
  "POST /api/auth/reset/verify",
  "POST /api/logout",
  "GET /api/auth/session",
  "POST /api/feedback",
  "POST /api/cron/sync"
]);

interface RouteDef {
  key: string; // "GET /api/users"
  middleware: string; // the text between the path and the handler
}

function routesIn(file: string): { routes: RouteDef[]; declared: number } {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const isRouter = /express\.Router\(\)|Router\(\)/.test(source);
  const re = /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*"([^"]+)"\s*,([\s\S]*?)(?:async\s*)?\(\s*_?req\b/g;
  const prefix = isRouter ? "/api" : "";
  // Only the API: the page shell (`GET /*splat`) serves the static app, no data.
  const routes: RouteDef[] = [...source.matchAll(re)]
    .map((m) => ({ key: `${m[1].toUpperCase()} ${prefix}${m[2]}`, middleware: m[3] }))
    .filter((r) => r.key.split(" ")[1].startsWith("/api"));
  const declared = [...source.matchAll(/^\s*(?:app|router)\.(?:get|post|put|patch|delete)\(\s*"([^"]+)"/gm)].filter((m) =>
    `${prefix}${m[1]}`.startsWith("/api")
  ).length;
  return { routes, declared };
}

describe("route inventory", () => {
  const files = fs.readdirSync(root).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));
  const all = files.map((file) => ({ file, ...routesIn(file) }));

  it("understands every route definition in the source", () => {
    for (const { file, routes, declared } of all) {
      assert.equal(routes.length, declared, `${file}: ${declared} routes declared, ${routes.length} understood`);
    }
    const total = all.reduce((n, f) => n + f.routes.length, 0);
    assert.ok(total >= 25, `expected to find the app's routes, found ${total}`);
  });

  it("leaves only the allow-listed routes open to visitors", () => {
    const open = all.flatMap((f) => f.routes).filter((r) => !/\brequire(Auth|Admin)\b/.test(r.middleware));
    assert.deepEqual(open.map((r) => r.key).sort(), [...PUBLIC_ROUTES].sort());
  });

  it("covers the data routes explicitly", () => {
    const byKey = new Map(all.flatMap((f) => f.routes).map((r) => [r.key, r]));
    for (const key of ["GET /api/users", "GET /api/version", "GET /api/trends", "POST /api/sync-if-stale"]) {
      assert.match(byKey.get(key)?.middleware ?? "", /\brequireAuth\b/, key);
    }
  });

  it("attaches the expected rate limiters to all authentication and OAuth routes", () => {
    const byKey = new Map(all.flatMap((f) => f.routes).map((r) => [r.key, r]));
    const expectedLimiters: Record<string, RegExp> = {
      "GET /api/auth/oauth/:provider/start": /\boauthLimiter\b/,
      "GET /api/auth/oauth/:provider/callback": /\boauthLimiter\b/,
      "GET /api/auth/oauth/pending": /\boauthLimiter\b/,
      "POST /api/auth/oauth/complete": /\boauthLimiter\b/,
      "POST /api/account/oauth/:provider/start": /\baccountLimiter\b/,
      "DELETE /api/account/oauth/:provider": /\baccountLimiter\b/,
      "POST /api/auth/login": /\bloginLimiter\b/,
      "POST /api/auth/reset/start": /\bresetLimiter\b/,
      "POST /api/auth/reset/verify": /\bverifyLimiter\b/
    };
    for (const [routeKey, pattern] of Object.entries(expectedLimiters)) {
      const mw = byKey.get(routeKey)?.middleware ?? "";
      assert.match(mw, pattern, `Expected ${routeKey} to carry rate limiter matching ${pattern}`);
    }
  });
});

// The frontend drops its signed-in state on a 401 that carries code
// "session_required" (src/api.ts). A 401 for any other reason must not carry
// it, or mistyping a password would sign the member out. Kept last: it changes
// a password, which signs out that member's other sessions.
describe("which 401s end the session", () => {
  it("a wrong current password is a 401 without the session code", async () => {
    const res = await api("POST", "/api/account/password", {
      cookie: leetcodeMemberCookie,
      body: { currentPassword: "not-the-password-1", newPassword: "a-brand-new-passphrase-7" }
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, undefined);
    assert.equal(
      (await api("GET", "/api/users", { cookie: leetcodeMemberCookie })).status,
      200,
      "the member is still signed in"
    );
  });

  it("a wrong login password is a 401 without the session code", async () => {
    const res = await api("POST", "/api/auth/login", { body: { username: "gate_plain", password: "nope-nope-nope-1" } });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, undefined);
  });

  it("a session that was signed out by a password change gets the session code", async () => {
    const change = await api("POST", "/api/account/password", {
      cookie: leetcodeMemberCookie,
      body: { currentPassword: PW, newPassword: "a-brand-new-passphrase-7" }
    });
    assert.equal(change.status, 200, change.text);

    const stale = await api("GET", "/api/users", { cookie: leetcodeMemberCookie });
    assert.equal(stale.status, 401);
    assert.equal(stale.json.code, "session_required");
  });
});
