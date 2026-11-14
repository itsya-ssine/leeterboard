import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  LEETCODE_GRAPHQL_URL,
  DEFAULT_LEETCODE_HEADERS,
  getCircuitState,
  resetCircuitState,
  executeLeetCodeGraphQL
} from "../leetcodeClient.js";

describe("Centralized LeetCode Client & Circuit Breaker (SEC-11 / CQ-02)", () => {
  beforeEach(() => {
    resetCircuitState();
  });

  it("targets official leetcode GraphQL URL and default headers", () => {
    assert.equal(LEETCODE_GRAPHQL_URL, "https://leetcode.com/graphql");
    assert.ok(DEFAULT_LEETCODE_HEADERS["Content-Type"]);
    assert.ok(DEFAULT_LEETCODE_HEADERS["User-Agent"]);
    assert.ok(DEFAULT_LEETCODE_HEADERS["Referer"]);
  });

  it("starts in a closed circuit breaker state", () => {
    const state = getCircuitState();
    assert.equal(state.isOpen, false);
    assert.equal(state.failures, 0);
  });

  it("trips circuit breaker after consecutive failures", async () => {
    // Mock global fetch to return 500
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response("Internal Server Error", { status: 500 });

      for (let i = 0; i < 5; i++) {
        const res = await executeLeetCodeGraphQL("query { test }", {});
        assert.equal(res.ok, false);
      }

      const state = getCircuitState();
      assert.equal(state.isOpen, true);
      assert.equal(state.failures, 5);

      // Fast-fails when open without calling fetch
      let fetchCalled = false;
      globalThis.fetch = async () => {
        fetchCalled = true;
        return new Response("ok", { status: 200 });
      };

      const fastFailRes = await executeLeetCodeGraphQL("query { test }", {});
      assert.equal(fastFailRes.ok, false);
      assert.match(fastFailRes.error!, /circuit breaker is OPEN/);
      assert.equal(fetchCalled, false, "fetch should not be called when circuit is open");
    } finally {
      globalThis.fetch = originalFetch;
      resetCircuitState();
    }
  });
});
