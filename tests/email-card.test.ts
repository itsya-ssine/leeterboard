/**
 * The email card on the account page (email sign-up step 15): what it shows
 * about the member's own address (src/signupFlow.ts), and what AccountPage wires
 * together. No browser: the component draws inside the auth context, so it is
 * checked by reading its source, like the other form tests.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { maskEmail } from "../emails.js";
import { emailCardView, isSameEmail } from "../src/signupFlow.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");

describe("what the email card shows", () => {
  it("says there is no email when the member has none", () => {
    assert.deepEqual(emailCardView(null, undefined, maskEmail), { kind: "none" });
    assert.deepEqual(emailCardView(undefined, undefined, maskEmail), { kind: "none" });
    assert.deepEqual(emailCardView("", false, maskEmail), { kind: "none" });
  });

  it("shows only the masked address, as verified", () => {
    const v = emailCardView("alice@example.com", true, maskEmail);
    assert.deepEqual(v, { kind: "verified", masked: "a***@example.com" });
    assert.doesNotMatch(JSON.stringify(v), /alice/);
  });

  it("flags an address that is not verified", () => {
    assert.equal(emailCardView("alice@example.com", false, maskEmail).kind, "unverified");
  });
});

describe("typing the address the member already has", () => {
  it("is recognised in any letter case, with spaces around it", () => {
    assert.equal(isSameEmail("  Alice@Example.com ", "alice@example.com"), true);
    assert.equal(isSameEmail("bob@example.com", "alice@example.com"), false);
    assert.equal(isSameEmail("alice@example.com", null), false);
  });
});

describe("AccountPage email card", () => {
  const page = read("src/AccountPage.tsx");
  const card = page.slice(page.indexOf("function EmailCard"), page.indexOf("const goHome"));

  it("is shown on the account page", () => {
    assert.match(page, /<EmailCard \/>/);
  });

  it("uses the session's own address only through the masked view, never drawing user.email", () => {
    assert.match(card, /emailCardView\(user\.email, user\.emailVerified, maskEmail\)/);
    assert.doesNotMatch(card.replace(/emailCardView\([^)]*\)/, ""), /\{user\.email\}/);
  });

  it("explains the empty state in the plan's words", () => {
    assert.match(card, /No email yet\. Add one to be able to reset your password\./);
  });

  it("asks for the current password, which the server requires, and clears it when done", () => {
    assert.match(card, /startEmailChange\(email\.trim\(\), password\)/);
    assert.match(card, /autoComplete="current-password"/);
    assert.match(card, /setPassword\(""\)/);
  });

  it("verifies through the shared code step and sends back to the form when the request is gone", () => {
    assert.match(card, /<CodeEntry/);
    assert.match(card, /verifyEmailChange\(code\)/);
    assert.match(card, /classifyCodeError\(err\)/);
    assert.match(card, /failure\.action === "restart"/);
  });

  it("is never optional-blocking: nothing forces a member to add an email", () => {
    assert.doesNotMatch(card, /window\.location|onClose|required email/i);
  });
});
