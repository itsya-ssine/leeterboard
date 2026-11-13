/** Session-only user data must survive ordinary account updates without leaking across accounts. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { mergeSessionUser } from "../src/authApi.js";
import type { User } from "../src/types.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const member = (over: Partial<User> = {}): User => ({
  id: "u1",
  loginUsername: "alice",
  displayName: "Alice",
  ...over
}) as User;

describe("keeping the member's own private session data", () => {
  it("keeps email and sign-in methods when an update omits them", () => {
    const previous = member({
      email: "alice@example.com",
      emailVerified: true,
      signInMethods: { password: false, providers: ["github"] }
    });
    const next = mergeSessionUser(previous, member({ displayName: "Alice B." }));
    assert.equal(next.email, "alice@example.com");
    assert.equal(next.emailVerified, true);
    assert.deepEqual(next.signInMethods, { password: false, providers: ["github"] });
  });

  it("uses new session values when the session response includes them", () => {
    const previous = member({ email: "old@example.com", emailVerified: true });
    const next = mergeSessionUser(previous, member({ email: "new@example.com", emailVerified: true }));
    assert.equal(next.email, "new@example.com");
  });

  it("never carries private session data to another member or a fresh record", () => {
    const previous = member({ email: "alice@example.com", signInMethods: { password: true, providers: [] } });
    const other = mergeSessionUser(previous, member({ id: "u2" }));
    assert.equal("email" in other, false);
    assert.equal("signInMethods" in other, false);
    assert.equal("email" in mergeSessionUser(null, member()), false);
  });

  it("does not mutate either user record", () => {
    const previous = member({ email: "alice@example.com" });
    const next = member({ displayName: "Alice B." });
    mergeSessionUser(previous, next);
    assert.equal("email" in next, false);
  });
});

describe("AuthContext OAuth migration", () => {
  const context = read("src/AuthContext.tsx");

  it("exposes OAuth methods without the removed email-code methods", () => {
    assert.match(context, /startOAuthSignIn/);
    assert.match(context, /startOAuthLink/);
    assert.match(context, /unlinkOAuth/);
    assert.doesNotMatch(context, /startEmailChange|verifyEmailChange|requestEmailCode|submitEmailCode/);
  });

  it("keeps session expiry handling and merges ordinary account updates", () => {
    assert.match(context, /installSessionExpiryHandler/);
    assert.match(context, /setSessionEnded\(true\)/);
    assert.match(context, /mergeSessionUser\(prev, data\)/);
  });
});
