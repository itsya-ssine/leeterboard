/**
 * Starts the real server in production mode and checks what oauthProviders.ts
 * promises at boot (oauth step 3): it refuses to start with the development-only
 * OAUTH_DEV_PROVIDER_URL, and stays quiet without it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startServer } from "./helpers.js";

// What startServer() would inherit from the developer's shell or .env must not decide these tests.
const CLEAN = { OAUTH_DEV_PROVIDER_URL: "" };

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
