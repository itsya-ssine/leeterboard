import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { checkSignup, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../src/signup.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");

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

  it("signs up through POST /api/auth/register in one step", () => {
    assert.match(ctx, /"\/api\/auth\/register"/);
    assert.doesNotMatch(ctx, /register\/leetcode|register\/verify/);
    assert.doesNotMatch(modal, /startRegistration|verifyRegistration|challenge/i);
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
