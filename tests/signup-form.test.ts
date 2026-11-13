import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { checkSignupUsername, oauthErrorMessage } from "../src/signup.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");

describe("OAuth username checks", () => {
  it("accepts a valid public username without requiring an email or password", () => {
    assert.equal(checkSignupUsername("jsmith_99"), null);
    assert.equal(checkSignupUsername("  Jsmith  "), null);
  });

  it("explains invalid and reserved usernames", () => {
    assert.match(checkSignupUsername("")!, /required/i);
    assert.match(checkSignupUsername("ab")!, /3 to 30/);
    assert.match(checkSignupUsername("admin")!, /isn't available/);
  });
});

describe("OAuth callback messages", () => {
  it("maps every known callback code to a friendly message", () => {
    const codes = [
      "cancelled", "failed", "unverified_email", "email_in_use", "domain_not_allowed",
      "expired", "unavailable", "admin_refused", "already_linked"
    ];
    for (const code of codes) assert.ok(oauthErrorMessage(code), code);
  });

  it("does not display an unknown or missing query value", () => {
    assert.equal(oauthErrorMessage("<script>alert(1)</script>"), null);
    assert.equal(oauthErrorMessage("toString"), null);
    assert.equal(oauthErrorMessage(null), null);
  });
});

describe("the OAuth auth form", () => {
  const modal = read("src/LoginModal.tsx");
  const ctx = read("src/AuthContext.tsx");
  const api = read("src/authApi.ts");

  it("keeps username/password login and shows only configured provider buttons", () => {
    assert.match(modal, /login\(username\.trim\(\), password\)/);
    assert.match(modal, /oauthProviders\.length > 0/);
    assert.match(modal, /providerButtons\(oauthProviders\)/);
    assert.match(ctx, /oauthProviders: OAuthProvider\[\]/);
  });

  it("uses provider sign-in for new accounts and explains that provider passwords stay private", () => {
    assert.match(modal, /We use Google or GitHub to confirm your email/);
    assert.match(modal, /We never see your password for them/);
    assert.match(modal, /startOAuthSignIn\(provider\)/);
    assert.doesNotMatch(modal, /CodeEntry|startRegistration|verifyRegistration|signup-email|signup-password/);
    assert.doesNotMatch(api, /api\/auth\/register|api\/auth\/reset\/email/);
  });

  it("loads the pending identity and completes sign-up with the chosen username", () => {
    assert.match(modal, /fetchPendingOAuthSignup\(\)/);
    assert.match(modal, /Signed in with/);
    assert.match(modal, /completeOAuthSignup\(username\.trim\(\), displayName\.trim\(\) \|\| undefined\)/);
    assert.match(modal, /This sign-up has expired\. Please start again\./);
    assert.match(modal, /window\.location\.hash = "#\/account"/);
  });

  it("shows the password recovery guidance and removes OAuth error codes from the URL", () => {
    assert.match(modal, /If you connected GitHub or Google, use that button\. Otherwise ask an admin/);
    assert.match(modal, /oauthErrorMessage\(code\)/);
    assert.match(modal, /clearOAuthErrorFromUrl\(\)/);
    assert.match(modal, /role="alert"/);
  });
});
