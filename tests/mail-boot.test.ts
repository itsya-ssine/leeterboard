/**
 * Starts the real server in production mode and checks what mailer.ts promises
 * at boot (email sign-up step 4): a loud warning when e-mail isn't configured,
 * a refusal to start with the development-only outbox provider, and no secret
 * in the logs when it is configured.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startServer } from "./helpers.js";
import { makeFakeMail } from "./f2-seed.js";

// What startServer() would inherit from the developer's shell or .env must not
// decide these tests.
const CLEAN = { EMAIL_PROVIDER: "", EMAIL_API_KEY: "", EMAIL_FROM: "", EMAIL_OUTBOX_DIR: "" };

describe("e-mail configuration at boot (production mode)", () => {
  it("starts without a provider, but says loudly that sign-up is unavailable", async () => {
    const server = await startServer({ ...CLEAN });
    try {
      assert.match(server.logs(), /\[Mail\] Email is NOT configured \(EMAIL_PROVIDER is not set\)/);
      assert.match(server.logs(), /answer 503/);
    } finally {
      await server.stop();
    }
  });

  it("refuses to start with the outbox provider", async () => {
    await assert.rejects(
      startServer({ ...CLEAN, EMAIL_PROVIDER: "outbox", EMAIL_OUTBOX_DIR: "/tmp/should-never-be-written" }),
      (err: Error) => {
        assert.match(err.message, /server exited early/);
        assert.match(err.message, /\[Mail\] EMAIL_PROVIDER=outbox is for development and tests only/);
        assert.match(err.message, /Refusing to start in production/);
        return true;
      }
    );
  });

  it("starts quietly with resend and the fake network, and never prints the key", async () => {
    const mail = makeFakeMail();
    const server = await startServer({ ...CLEAN, ...mail.env });
    try {
      assert.equal(server.logs().includes("[Mail]"), false, "a configured server has nothing to warn about");
      assert.equal(server.logs().includes(mail.env.EMAIL_API_KEY), false);
    } finally {
      await server.stop();
      mail.cleanup();
    }
  });

  it("warns, naming only the variable, when resend is chosen but the key is missing", async () => {
    const server = await startServer({
      ...CLEAN,
      EMAIL_PROVIDER: "resend",
      EMAIL_FROM: "Leeterboard <no-reply@leeterboard.test>"
    });
    try {
      assert.match(server.logs(), /\[Mail\] Email is NOT configured \(EMAIL_API_KEY is not set\)/);
    } finally {
      await server.stop();
    }
  });
});
