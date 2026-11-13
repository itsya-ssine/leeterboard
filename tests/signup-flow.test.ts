/**
 * The account email-change code step (src/signupFlow.ts), the shared code-entry
 * component rendered to static markup, and the OAuth LoginModal wiring. No
 * browser: the component is rendered with react-dom/server, and LoginModal is
 * checked by reading its source, like the other form tests.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CodeEntry from "../src/CodeEntry.js";
import { AuthError } from "../src/authApi.js";
import { classifyCodeError, codeSentMessage, resendLabel, secondsLeft } from "../src/signupFlow.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");

describe("what a failed verify means", () => {
  it("a wrong code keeps the person on the code step", () => {
    const f = classifyCodeError(new AuthError("That code isn't right. Check it and try again.", false, 400));
    assert.deepEqual(f, { message: "That code isn't right. Check it and try again.", action: "retry" });
  });

  it("an expired or used request sends them back to the first step, with the server's words", () => {
    const f = classifyCodeError(new AuthError("This sign-up has expired. Please start again.", true, 400));
    assert.deepEqual(f, { message: "This sign-up has expired. Please start again.", action: "restart" });
  });

  it("too many wrong codes (429, expired) sends them back to the first step", () => {
    const f = classifyCodeError(new AuthError("Too many wrong codes. Please start again.", true, 429));
    assert.equal(f.action, "restart");
    assert.equal(f.message, "Too many wrong codes. Please start again.");
  });

  it("a username taken in the meantime (409) sends them back too: the request is used up", () => {
    const f = classifyCodeError(new AuthError("That username was just taken. Please start again with another one.", false, 409));
    assert.equal(f.action, "restart");
    assert.match(f.message, /username/);
  });

  it("a rate limit that is not an expiry, or a lost connection, keeps the request open", () => {
    assert.equal(classifyCodeError(new AuthError("Too many attempts. Try again later.", false, 429)).action, "retry");
    assert.equal(classifyCodeError(new AuthError("Couldn't reach the server. Check your connection and try again.")).action, "retry");
    assert.equal(classifyCodeError(new AuthError("Something went wrong. Please try again.", false, 500)).action, "retry");
  });

  it("anything that isn't an AuthError gives the generic message and keeps the request open", () => {
    assert.deepEqual(classifyCodeError(new TypeError("boom")), { message: "Something went wrong. Please try again.", action: "retry" });
    assert.equal(classifyCodeError(undefined).action, "retry");
  });
});

describe("the resend countdown", () => {
  it("starts at the full wait, counts down, and stops at 0", () => {
    const t0 = 1_000_000;
    assert.equal(secondsLeft(t0, t0), 60);
    assert.equal(secondsLeft(t0, t0 + 1000), 59);
    assert.equal(secondsLeft(t0, t0 + 59_200), 1, "a part of a second still counts as a second");
    assert.equal(secondsLeft(t0, t0 + 60_000), 0);
    assert.equal(secondsLeft(t0, t0 + 3_600_000), 0);
  });

  it("never shows more than the wait or less than 0, even if the clock moved back", () => {
    assert.equal(secondsLeft(5_000_000, 1_000_000), 60);
    assert.equal(secondsLeft(0, 10 ** 12), 0);
  });

  it("takes another wait when told to", () => {
    assert.equal(secondsLeft(0, 0, 30), 30);
    assert.equal(secondsLeft(0, 10_000, 30), 20);
  });

  it("labels the button with the countdown, then plainly", () => {
    assert.equal(resendLabel(42), "Resend code in 42s");
    assert.equal(resendLabel(0), "Resend code");
  });

  it("says where the code went", () => {
    assert.equal(codeSentMessage("a***@example.com"), "We sent a 6-digit code to a***@example.com.");
  });

});

const entry = (over: Partial<React.ComponentProps<typeof CodeEntry>> = {}) =>
  renderToStaticMarkup(
    React.createElement(CodeEntry, {
      message: codeSentMessage("a***@example.com"),
      expiresInMinutes: 10,
      sentAt: Date.now(),
      busy: false,
      error: null,
      backLabel: "Use a different email",
      onSubmit: () => {},
      onResend: () => {},
      onBack: () => {},
      ...over
    })
  );

describe("the code step, rendered", () => {
  it("tells the person where the code went and how long it lives", () => {
    const html = entry();
    assert.match(html, /We sent a 6-digit code to a\*\*\*@example\.com\./);
    assert.match(html, /works for 10 minutes/);
  });

  it("has one code field: numeric keypad, one-time-code autofill, labelled", () => {
    const html = entry();
    assert.equal((html.match(/<input/g) ?? []).length, 1);
    assert.match(html, /autoComplete="one-time-code"|autocomplete="one-time-code"/i);
    assert.match(html, /inputMode="numeric"|inputmode="numeric"/i);
    assert.match(html, /<label for="email-code"[^>]*>6-digit code<\/label>/);
    assert.match(html, /id="email-code"/);
    assert.doesNotMatch(html, /type="password"/);
  });

  it("disables Resend with a visible countdown while the wait lasts, and enables it after", () => {
    assert.match(entry({ sentAt: Date.now() }), /<button[^>]*disabled=""[^>]*>Resend code in 60s<\/button>/);
    const later = entry({ sentAt: Date.now() - 61_000 });
    assert.match(later, /<button[^>]*>Resend code<\/button>/);
    assert.doesNotMatch(later, /<button[^>]*disabled=""[^>]*>Resend code<\/button>/);
  });

  it("offers Verify and the way back to the first step", () => {
    const html = entry({ submitLabel: "Verify and create account" });
    assert.match(html, /<button[^>]*type="submit"[^>]*>Verify and create account<\/button>/);
    assert.match(html, /<button[^>]*type="button"[^>]*>Use a different email<\/button>/);
  });

  it("announces an error with role=alert and ties it to the field", () => {
    const html = entry({ error: "That code isn't right. Check it and try again." });
    assert.match(html, /role="alert"/);
    assert.match(html, /That code isn&#x27;t right\. Check it and try again\./);
    assert.match(html, /aria-invalid="true"/);
    assert.match(html, /aria-describedby="email-code-error"/);
    assert.match(html, /id="email-code-error"/);
  });

  it("has no alert when nothing went wrong", () => {
    const html = entry();
    assert.doesNotMatch(html, /role="alert"/);
    assert.doesNotMatch(html, /aria-invalid/);
  });

  it("shows a confirmation as a polite status, and drops it when there is an error", () => {
    assert.match(entry({ notice: "A new code was sent." }), /role="status"[^>]*>[\s\S]*A new code was sent\./);
    assert.doesNotMatch(entry({ notice: "A new code was sent.", error: "x" }), /role="status"/);
  });

  it("locks the form while a request is running", () => {
    const html = entry({ busy: true, busyLabel: "Creating account…" });
    assert.match(html, /<input[^>]*disabled=""/);
    assert.match(html, /Creating account…/);
    assert.match(html, /<button[^>]*type="button"[^>]*disabled=""[^>]*>Use a different email<\/button>/);
  });

  it("does not put the countdown in a live region (it would be read out every second)", () => {
    const html = entry();
    const resend = /<button[^>]*>Resend code in 60s<\/button>/.exec(html)![0];
    assert.doesNotMatch(resend, /aria-live/);
  });
});

describe("LoginModal OAuth flow", () => {
  const modal = read("src/LoginModal.tsx");
  const ctx = read("src/AuthContext.tsx");

  it("uses the username/password form for existing members", () => {
    assert.match(modal, /handleLogin/);
    assert.match(modal, /login\(username\.trim\(\), password\)/);
    assert.match(modal, /Forgot your password\? If you connected GitHub or Google/);
  });

  it("shows only configured providers and has no email-code sign-up UI", () => {
    assert.match(modal, /oauthProviders\.length > 0/);
    assert.match(modal, /Continue with/);
    assert.match(modal, /Sign-up is temporarily unavailable/);
    assert.doesNotMatch(modal, /CodeEntry|startRegistration|verifyRegistration|startPasswordReset|verifyPasswordReset/);
    assert.doesNotMatch(ctx, /startRegistration|verifyRegistration|startPasswordReset|verifyPasswordReset/);
  });

  it("loads the pending provider identity before showing the username form", () => {
    assert.match(modal, /fetchPendingOAuthSignup\(\)/);
    assert.match(modal, /pending\.maskedEmail/);
    assert.match(modal, /checkSignupUsername\(username\)/);
    assert.match(modal, /completeOAuthSignup\(username\.trim\(\), displayName\.trim\(\) \|\| undefined\)/);
  });

  it("uses friendly callback errors and removes the query from the URL", () => {
    assert.match(modal, /oauthErrorMessage\(code\)/);
    assert.match(modal, /replaceState/);
    assert.match(modal, /role="alert"/);
  });
});
