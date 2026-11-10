/**
 * The fake Resend (tests/fake-mail.mjs) that later steps rely on. If it were
 * wrong, every sign-up test would be proving nothing, so it is tested too: the
 * REAL resend provider runs against it.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { makeFakeMail, mergeEnv, makeFakeLeetCode } from "./f2-seed.js";

const fake = makeFakeMail();
let mailer: typeof import("../mailer.js");

before(async () => {
  process.env.FAKE_MAIL_DIR = fake.dir;
  await import("./fake-mail.mjs"); // replaces globalThis.fetch in THIS process
  mailer = await import("../mailer.js");
});
after(() => fake.cleanup());

const resend = () =>
  mailer.createMailer({ provider: "resend", apiKey: "re_test", from: "Leeterboard <no-reply@leeterboard.test>" });

describe("fake-mail.mjs with the real resend provider", () => {
  it("keeps what was sent, and finds the newest mail and its code per recipient", async () => {
    await resend().send({ to: "Alice@Example.com", subject: "Code", text: "Your code is 111111." });
    await resend().send({ to: "bob@example.com", subject: "Code", text: "Your code is 222222." });
    await resend().send({ to: "alice@example.com", subject: "Code again", text: "Your code is 333333." });

    assert.equal(fake.mails().length, 3);
    assert.equal(fake.mails("alice@example.com").length, 2);
    assert.equal(fake.lastMail("ALICE@example.com")?.subject, "Code again");
    assert.equal(fake.lastCode("alice@example.com"), "333333");
    assert.equal(fake.lastCode("bob@example.com"), "222222");
    assert.equal(fake.lastCode("nobody@example.com"), null);
    assert.equal(fake.lastMail("nobody@example.com"), null);
    assert.equal(fake.lastMail("bob@example.com")?.from, "Leeterboard <no-reply@leeterboard.test>");
  });

  it("answers a provider outage with 500 while _down is set, and recovers", async () => {
    const before = fake.mails().length;
    fake.setDown(true);
    const err = await resend().send({ to: "a@example.com", subject: "S", text: "t" }).then(() => null, (e) => e);
    assert.equal(err?.kind, "rejected");
    assert.equal(err?.status, 500);
    assert.equal(fake.mails().length, before, "an outage must not record a mail");
    fake.setDown(false);
    await resend().send({ to: "a@example.com", subject: "S", text: "t" });
    assert.equal(fake.mails().length, before + 1);
  });

  it("answers 422 while _reject is set (an unverified sender domain)", async () => {
    fake.setRejecting(true);
    const err = await resend().send({ to: "a@example.com", subject: "S", text: "t" }).then(() => null, (e) => e);
    assert.equal(err?.status, 422);
    fake.setRejecting(false);
  });

  it("answers 401 without a Bearer key, like the real API", async () => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "a@example.com", to: ["b@example.com"], subject: "S", text: "t" })
    });
    assert.equal(res.status, 401);
  });
});

describe("test helpers", () => {
  it("mergeEnv joins the NODE_OPTIONS of two fakes so both preloads run", () => {
    const lc = makeFakeLeetCode();
    try {
      const merged = mergeEnv(lc.env, fake.env);
      const options = merged.NODE_OPTIONS.split(" --import ").length - 1 + (merged.NODE_OPTIONS.startsWith("--import") ? 1 : 0);
      assert.equal(options, 2);
      assert.match(merged.NODE_OPTIONS, /fake-leetcode\.mjs/);
      assert.match(merged.NODE_OPTIONS, /fake-mail\.mjs/);
      assert.equal(merged.FAKE_MAIL_DIR, fake.dir);
      assert.equal(merged.FAKE_LEETCODE_DIR, lc.dir);
    } finally {
      lc.cleanup();
    }
  });
});
