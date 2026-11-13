import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { canDisconnectOAuthProvider, visibleOAuthProviders } from "../src/signup.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("account sign-in provider visibility", () => {
  it("shows enabled providers in a stable order", () => {
    assert.deepEqual(visibleOAuthProviders(["google", "github"]), ["github", "google"]);
    assert.deepEqual(visibleOAuthProviders(["google"]), ["google"]);
    assert.deepEqual(visibleOAuthProviders([]), []);
  });

  it("keeps an already-linked provider visible even if it is no longer enabled", () => {
    assert.deepEqual(visibleOAuthProviders(["google"], ["github"]), ["github", "google"]);
  });
});

describe("the last sign-in method rule", () => {
  it("does not allow disconnecting the only connected provider when there is no password", () => {
    assert.equal(canDisconnectOAuthProvider({ password: false, providers: ["github"] }, "github"), false);
  });

  it("allows disconnecting a provider when a password or another provider remains", () => {
    assert.equal(canDisconnectOAuthProvider({ password: true, providers: ["github"] }, "github"), true);
    assert.equal(canDisconnectOAuthProvider({ password: false, providers: ["github", "google"] }, "github"), true);
  });

  it("does not offer disconnect for a provider that is not connected", () => {
    assert.equal(canDisconnectOAuthProvider({ password: false, providers: ["github"] }, "google"), false);
  });
});

describe("OAuth UI source checks", () => {
  it("uses the last-method helper in Account settings", () => {
    const account = read("src/AccountPage.tsx");
    assert.match(account, /canDisconnectOAuthProvider\(signInMethods, provider\)/);
  });

  it("does not call any removed email-code or password-reset route from LoginModal", () => {
    const modal = read("src/LoginModal.tsx");
    assert.doesNotMatch(modal, /\/api\/(?:auth\/register(?:\/start|\/verify)?|auth\/reset\/email|account\/email)(?:["'`]|\/)/);
    assert.doesNotMatch(modal, /requestSignupCode|submitSignupCode|requestResetCode|submitResetCode|requestEmailCode|submitEmailCode|CodeEntry/);
  });
});
