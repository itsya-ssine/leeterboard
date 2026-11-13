/**
 * Starts the real server in production mode and checks what oauthProviders.ts
 * promises at boot (oauth step 3): it refuses to start with the development-only
 * OAUTH_DEV_PROVIDER_URL, and stays quiet without it.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { startServer } from "./helpers.js";
import { makeUser } from "./f2-seed.js";

// What startServer() would inherit from the developer's shell or .env must not decide these tests.
const CLEAN = {
  OAUTH_DEV_PROVIDER_URL: "",
  PUBLIC_URL: "",
  GITHUB_CLIENT_ID: "",
  GITHUB_CLIENT_SECRET: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: ""
};

describe("OAUTH_DEV_PROVIDER_URL at boot (production mode)", () => {
  it("refuses to start with it, even when it points at this machine", async () => {
    await assert.rejects(startServer({ ...CLEAN, OAUTH_DEV_PROVIDER_URL: "http://127.0.0.1:4010" }), (err: Error) => {
      assert.match(err.message, /server exited early/);
      assert.match(err.message, /\[OAuth\] OAUTH_DEV_PROVIDER_URL is for development and tests only/);
      assert.match(err.message, /Refusing to start in production/);
      return true;
    });
  });

  it("refuses an override pointing anywhere else too", async () => {
    await assert.rejects(startServer({ ...CLEAN, OAUTH_DEV_PROVIDER_URL: "https://evil.example" }), (err: Error) => {
      assert.match(err.message, /Refusing to start in production/);
      return true;
    });
  });

  it("starts quietly without it", async () => {
    const server = await startServer({ ...CLEAN });
    try {
      assert.equal(server.logs().includes("[OAuth]"), false);
    } finally {
      await server.stop();
    }
  });
});

describe("production without any OAuth provider enabled", () => {
  it("logs oauth_unconfigured and keeps password login working", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-oauth-boot-"));
    const dbUrl = `file:${path.join(tmpDir, "test.db")}`;
    const secret = crypto.randomBytes(48).toString("hex");

    process.env.TURSO_DATABASE_URL = dbUrl;
    process.env.TURSO_AUTH_TOKEN = "";
    process.env.JWT_SECRET = secret;
    const db = await import("../db.js");
    const { hashPassword } = await import("../auth.js");
    await db.initDb();
    await db.client.execute("PRAGMA journal_mode = WAL");

    const user = makeUser("boot_password_user");
    await db.insertUser(user, await hashPassword("my-password-123"), { loginUsername: "boot_password_user" });

    const server = await startServer({
      ...CLEAN,
      TURSO_DATABASE_URL: dbUrl,
      JWT_SECRET: secret
    });

    try {
      // 1. Password login still works
      const loginRes = await fetch(`${server.url}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "boot_password_user", password: "my-password-123" })
      });
      assert.equal(loginRes.status, 200);

      // 2. Visiting OAuth start redirects to unavailable and logs oauth_unconfigured
      const startRes = await fetch(`${server.url}/api/auth/oauth/github/start`, { redirect: "manual" });
      assert.equal(startRes.status, 302);
      assert.equal(startRes.headers.get("location"), "/#/login?oauth_error=unavailable");

      const logs = server.logs();
      assert.match(logs, /"event":"oauth_unconfigured"/);
    } finally {
      await server.stop();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
