/**
 * SEC-03 regression: Central error handling & preventing internal errors from leaking.
 *
 * Asserts that:
 * 1. Every response carries a correlation ID (x-request-id), either client-supplied
 *    or freshly generated.
 * 2. Unhandled server and database errors return HTTP 500 with a generic message and
 *    the correlation requestId.
 * 3. HTTP 500 bodies never expose database driver text, table names, SQL fragments,
 *    file paths, or stack traces.
 * 4. Internal failures are logged server-side as structured JSON with requestId.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { client, startServer, type TestServer } from "./helpers.js";

let server: TestServer;
let api: ReturnType<typeof client>;
let db: typeof import("../db.js");

before(async () => {
  server = await startServer({ ADMIN_USER_IDS: "test_admin" });
  api = client(server);
  process.env.JWT_SECRET = server.secret;
  process.env.TURSO_DATABASE_URL = server.dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";
  db = await import("../db.js");
});

after(async () => {
  await server.stop();
});

describe("SEC-03: Centralized error handling and information disclosure prevention", () => {
  it("attaches an x-request-id to every response", async () => {
    const res = await api("GET", "/api/auth/session");
    const reqId = res.headers.get("x-request-id");
    assert.ok(reqId, "missing x-request-id header");
    assert.match(reqId, /^[0-9a-f-]{36}$/i, "expected UUID format");
  });

  it("respects and echoes a client-supplied x-request-id", async () => {
    const customId = "trace-client-abc-12345";
    const res = await api("GET", "/api/auth/session", {
      headers: { "x-request-id": customId }
    });
    assert.equal(res.headers.get("x-request-id"), customId);
  });

  it("prevents database error details from leaking on 500 failure", async () => {
    // 1. Create a user and log in to get a valid session
    const username = "err_test_user";
    const pw = "Correct-Horse-Battery-42";
    const { hashPassword } = await import("../auth.js");
    const hash = await hashPassword(pw);

    const user = {
      id: "user-" + (await import("node:crypto")).randomUUID(),
      displayName: username,
      loginUsername: username,
      leetcodeUsername: username,
      avatarUrl: "",
      school: "",
      bio: "",
      githubUrl: "",
      linkedinUrl: "",
      websiteUrl: "",
      allTimeSolved: 10,
      easySolved: 5,
      mediumSolved: 5,
      hardSolved: 0,
      weeklyProgress: 2,
      monthlyProgress: 5,
      rank: 1,
      contestRating: null,
      contestsAttended: 0,
      currentStreak: null,
      longestStreak: null,
      lastUpdated: new Date().toISOString(),
      trackingStart: "2026-01-01",
      baselineSolved: 0,
      history: []
    };

    await db.insertUser(user as any, hash);

    const loginRes = await api("POST", "/api/auth/login", {
      body: { username, password: pw }
    });
    assert.equal(loginRes.status, 200);
    const sessionCookie = loginRes.cookie;
    assert.ok(sessionCookie, "session cookie should be present");

    // 2. Corrupt/drop the table to simulate database failure
    await db.client.execute("DROP TABLE users");

    // 3. Call GET /api/users which attempts to query the dropped table
    const traceId = "forced-db-failure-trace-01";
    const failedRes = await api("GET", "/api/users", {
      cookie: sessionCookie,
      headers: { "x-request-id": traceId }
    });

    assert.equal(failedRes.status, 500);
    assert.equal(failedRes.headers.get("x-request-id"), traceId);
    assert.equal(failedRes.json.requestId, traceId);
    assert.equal(failedRes.json.error, "Something went wrong. Please try again.");

    // Assert that NO database or stack information leaked to the client
    const text = failedRes.text.toLowerCase();
    for (const forbidden of [
      "no such table",
      "sqlite",
      "libsql",
      "syntaxerror",
      "at ",
      "node_modules",
      "server.ts",
      "users"
    ]) {
      assert.ok(
        !text.includes(forbidden),
        `Response body must not leak internal detail "${forbidden}": ${failedRes.text}`
      );
    }

    // 4. Verify that the server logged the structured error event
    const serverLogs = server.logs();
    assert.ok(
      serverLogs.includes(traceId),
      "Server logs must record the requestId of the failure"
    );
    assert.ok(
      serverLogs.includes('"level":"error"'),
      "Server logs must record level error for 500"
    );
  });
});
