import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { checkSignup, checkSignupUsername, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../src/signup.js";

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

describe("sign-up form checks", () => {
  it("accepts a normal username and password", () => {
    assert.equal(checkSignup("jsmith_99", "correct-horse-9"), null);
    assert.equal(checkSignup("  Jsmith  ", "correct-horse-9"), null, "the name is trimmed");
  });

  it("explains a bad username", () => {
    assert.match(checkSignup("", "correct-horse-9")!, /required/i);
    assert.match(checkSignup("ab", "correct-horse-9")!, /3 to 30/);
    assert.match(checkSignup("a".repeat(31), "correct-horse-9")!, /3 to 30/);
    assert.match(checkSignup("john.smith", "correct-horse-9")!, /letters, numbers and underscores/);
    assert.match(checkSignup("john smith", "correct-horse-9")!, /letters, numbers and underscores/);
    assert.match(checkSignup("admin", "correct-horse-9")!, /isn't available/);
  });

  it("explains a bad password", () => {
    assert.match(checkSignup("jsmith", "short")!, /at least 8/);
    assert.match(checkSignup("jsmith", "x".repeat(PASSWORD_MAX_LENGTH + 1))!, /at most 128/);
    assert.match(checkSignup("jsmith_long", "JSMITH_LONG")!, /same as your username/);
  });

  it("uses the same password limits as the server", () => {
    const auth = read("auth.ts");
    assert.equal(Number(/MIN_PASSWORD_LENGTH = (\d+)/.exec(auth)?.[1]), PASSWORD_MIN_LENGTH);
    assert.equal(Number(/MAX_PASSWORD_LENGTH = (\d+)/.exec(auth)?.[1]), PASSWORD_MAX_LENGTH);
  });
});

describe("the auth form no longer asks for a LeetCode proof", () => {
  const modal = read("src/LoginModal.tsx");
  const ctx = read("src/AuthContext.tsx");
  const api = read("src/authApi.ts");

  it("signs up in two steps (a code by e-mail), never through the removed one-step route or a LeetCode proof", () => {
    assert.match(api, /"\/api\/auth\/register\/start"/);
    assert.match(api, /"\/api\/auth\/register\/verify"/);
    assert.doesNotMatch(ctx + api, /"\/api\/auth\/register"/);
    assert.doesNotMatch(ctx + api, /register\/leetcode/);
    assert.match(ctx, /startRegistration/);
    assert.match(ctx, /verifyRegistration/);
  });

  it("logs in with a plain username", () => {
    assert.match(ctx, /"\/api\/auth\/login", \{ username, password \}/);
    // The hint for older members may mention LeetCode; no field is labelled with it.
    assert.doesNotMatch(modal, />\s*LeetCode username\s*</);
  });

  it("sends a new member to their account page with the prompt", () => {
    assert.match(modal, /window\.location\.hash = "#\/account"/);
    assert.match(modal, /AFTER_SIGNUP_PROMPT/);
  });
});
