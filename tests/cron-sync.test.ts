import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { client, startServer, type TestServer } from "./helpers.js";
import { makeFakeLeetCode, makeUser } from "./f2-seed.js";

const PW = "correct-horse-battery-9";
const CRON_SECRET = "super-secret-cron-key-1234567890";

let tmpDir = "";
let dbUrl = "";
let server: TestServer;
let api: ReturnType<typeof client>;
const fake = makeFakeLeetCode();

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-cronsync-"));
  dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";

  const db = await import("../db.js");
  const { hashPassword } = await import("../auth.js");
  await db.initDb();
  const hash = await hashPassword(PW);

  const user = makeUser("cron_u1");
  await db.insertUser(user, hash);
  fake.setStats("cron_u1", { all: 42, easy: 20, medium: 15, hard: 7 });

  server = await startServer({
    TURSO_DATABASE_URL: dbUrl,
    JWT_SECRET: secret,
    CRON_SECRET,
    ...fake.env
  });
  api = client(server);
});

after(async () => {
  await server?.stop();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("POST /api/cron/sync (SEC-02)", () => {
  it("rejects calls with missing or invalid Authorization header", async () => {
    const noAuth = await api("POST", "/api/cron/sync");
    assert.equal(noAuth.status, 401);

    const badBearer = await api("POST", "/api/cron/sync", {
      headers: { Authorization: "Bearer wrong-secret" }
    });
    assert.equal(badBearer.status, 401);

    const nonBearer = await api("POST", "/api/cron/sync", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" }
    });
    assert.equal(nonBearer.status, 401);
  });

  it("syncs stale members when authorized with CRON_SECRET", async () => {
    const res = await api("POST", "/api/cron/sync", {
      headers: { Authorization: `Bearer ${CRON_SECRET}` }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.synced, true);
  });

  it("returns 202 when a distributed lease is already held", async () => {
    const db = await import("../db.js");
    const holder = await db.acquireLease("sync", 60_000, "external-worker");
    assert.ok(holder, "should acquire lease");

    try {
      const res = await api("POST", "/api/cron/sync", {
        headers: { Authorization: `Bearer ${CRON_SECRET}` }
      });
      assert.equal(res.status, 202);
      assert.equal(res.json.skipped, "already running");
    } finally {
      await db.releaseLease("sync", holder!);
    }
  });

  it("allows lease acquisition again after release", async () => {
    const db = await import("../db.js");
    const res = await api("POST", "/api/cron/sync", {
      headers: { Authorization: `Bearer ${CRON_SECRET}` }
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
  });
});

describe("Database lease primitives (db.acquireLease / db.releaseLease)", () => {
  it("acquires and prevents concurrent lease acquisition until released or expired", async () => {
    const db = await import("../db.js");
    const lease1 = await db.acquireLease("test-task", 500, "worker-1");
    assert.equal(lease1, "worker-1");

    // Second worker cannot acquire while active
    const lease2 = await db.acquireLease("test-task", 500, "worker-2");
    assert.equal(lease2, null);

    // Release lease
    await db.releaseLease("test-task", "worker-1");

    // Now second worker can acquire
    const lease3 = await db.acquireLease("test-task", 500, "worker-2");
    assert.equal(lease3, "worker-2");
    await db.releaseLease("test-task", "worker-2");
  });
});
