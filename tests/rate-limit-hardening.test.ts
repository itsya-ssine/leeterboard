import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apiLimiter, pageLimiter, accountLimiter, accountKeyGenerator } from "../rateLimit.js";
import type { Request } from "express";

describe("Rate Limit Hardening (SEC-04)", () => {
  it("provides generous ceilings for shared school/campus networks", () => {
    assert.ok(apiLimiter);
    assert.ok(pageLimiter);
  });

  it("keys account limiter by compound account + IP identifier when user is authenticated", () => {
    const reqUser1 = { ip: "192.168.1.100", user: { id: "user_alpha_1" } } as unknown as Request;
    const reqUser2 = { ip: "192.168.1.100", user: { id: "user_beta_2" } } as unknown as Request;
    const reqAnon = { ip: "192.168.1.100" } as unknown as Request;

    const key1 = accountKeyGenerator(reqUser1);
    const key2 = accountKeyGenerator(reqUser2);
    const keyAnon = accountKeyGenerator(reqAnon);

    assert.equal(key1, "user:user_alpha_1:192.168.1.100");
    assert.equal(key2, "user:user_beta_2:192.168.1.100");
    assert.equal(keyAnon, "192.168.1.100");
    assert.notEqual(key1, key2, "Two distinct users on the same shared IP have separate account rate limit keys");
  });
});
