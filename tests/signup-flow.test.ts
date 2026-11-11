/**
 * The two-step sign-up form (email sign-up step 13): the decisions behind the
 * code step (src/signupFlow.ts), the shared code-entry component rendered to
 * static markup, and what LoginModal wires together. No browser: the component
 * is rendered with react-dom/server, and LoginModal (which draws into a portal)
 * is checked by reading its source, like the other form tests.
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
      maskedEmail: "a***@example.com",
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

describe("LoginModal", () => {
  const modal = read("src/LoginModal.tsx");
  const entrySrc = read("src/CodeEntry.tsx");
  const ctx = read("src/AuthContext.tsx");

  it("no longer uses the one-step register", () => {
    assert.doesNotMatch(modal, /\bregister\b\s*[,(}]/);
    assert.doesNotMatch(ctx, /\bregister:|const register\b/);
    assert.match(modal, /startRegistration/);
    assert.match(modal, /verifyRegistration/);
  });

  it("asks for username, email, password, then the optional display name, in that order", () => {
    const ids = [...modal.matchAll(/id="(signup-[a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids, ["signup-username", "signup-email", "signup-password", "signup-display"]);
  });

  it("the email field is an email field with the right hints", () => {
    const field = /<input\s+id="signup-email"[\s\S]*?\/>/.exec(modal)![0];
    assert.match(field, /type="email"/);
    assert.match(field, /autoComplete="email"/);
    assert.match(field, /inputMode="email"/);
    assert.match(field, /maxLength=\{254\}/);
  });

  it("checks the form (username, email, password) before asking the server", () => {
    assert.match(modal, /checkSignup\(username, password, email\)/);
  });

  it("explains what the email is for, and that it stays private", () => {
    assert.match(modal, /6-digit code/);
    assert.match(modal, /forget your password/);
    assert.match(modal, /never shown to other\s+members/);
  });

  it("on success goes to the account page with the existing prompt, then closes", () => {
    assert.match(modal, /window\.location\.hash = "#\/account"/);
    assert.match(modal, /toast\("success", `Account created\. \$\{AFTER_SIGNUP_PROMPT\}`\)/);
    assert.match(modal, /finish\(\)/);
    assert.match(modal, /const finish = \(\) => \{\s*setPassword\(""\);/, "the password leaves state when the dialog closes");
  });

  it("goes back to the details when the request is gone, and keeps what was typed", () => {
    assert.match(modal, /classifyCodeError\(err\)/);
    assert.match(modal, /failure\.action === "restart"[\s\S]*?setStep\("details"\)/);
    const restart = /failure\.action === "restart"[\s\S]*?\n      \}/.exec(modal)![0];
    assert.doesNotMatch(restart, /setUsername|setEmail|setPassword|setDisplayName/, "nothing the person typed is wiped");
  });

  it("has Resend (asks for a new code with the same details), 'Use a different email', and clears the code step when leaving", () => {
    assert.match(modal, /onResend=\{handleResend\}/);
    assert.match(modal, /backLabel="Use a different email"/);
    assert.match(modal, /const useDifferentEmail = \(\) => \{\s*setStep\("details"\);\s*setChallenge\(null\);/);
    assert.match(modal, /const switchTab[\s\S]*?setStep\("details"\)[\s\S]*?setChallenge\(null\)/);
  });

  it("starts from a clean form each time the dialog opens, code step included", () => {
    const open = /useEffect\(\(\) => \{\s*if \(open\) \{[\s\S]*?\n    \}\n  \}, \[open\]\)/.exec(modal)![0];
    for (const reset of ['setEmail("")', 'setStep("details")', "setChallenge(null)", 'setPassword("")']) assert.ok(open.includes(reset), reset);
  });

  it("never stores the password, the email or the code outside memory, and never logs them", () => {
    for (const src of [modal, entrySrc, read("src/signupFlow.ts")]) {
      assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie/);
      assert.doesNotMatch(src, /console\.(log|info|debug|warn|error)/);
    }
  });

  it("focuses the code field and re-selects it after a failure", () => {
    assert.match(entrySrc, /inputRef\.current\?\.focus\(\)/);
    assert.match(entrySrc, /inputRef\.current\?\.select\(\)/);
    assert.match(entrySrc, /useEffect\(\(\) => \{\s*if \(error\)/);
  });
});
