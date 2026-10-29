/**
 * F1 regression: the ownership proof (the one-time code read back from a
 * LeetCode profile) must only ever be read from LeetCode itself.
 *
 * It gates sign-up, account claiming and password reset, so any third-party
 * "fallback" (an unofficial API wrapper, mirror or cache) would let whoever
 * controls that service attest ownership of any username. If LeetCode doesn't
 * answer, the lookup must fail closed ("unavailable" -> HTTP 503).
 *
 * This is a source-level check on purpose: it needs no network and no server,
 * and it fails the moment someone adds another host to the lookup.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "server.ts"), "utf8");

// Returns the source of a top-level `async function <name>` by brace matching.
function functionSource(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} not found in server.ts`);
  const open = source.indexOf("{", source.indexOf("): Promise<", start));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`could not find the end of ${name}`);
}

describe("ownership proof source (F1)", () => {
  const lookup = functionSource(serverSource, "fetchLeetCodeAbout");

  it("only talks to leetcode.com", () => {
    const hosts = [...lookup.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
    assert.ok(hosts.length > 0, "expected the lookup to call LeetCode");
    for (const host of hosts) {
      assert.ok(
        host === "leetcode.com" || host.endsWith(".leetcode.com"),
        `fetchLeetCodeAbout must not use third-party host "${host}"`
      );
    }
  });

  it("never mentions the Alfa proxy or builds URLs from other hosts", () => {
    assert.doesNotMatch(lookup, /alfa/i);
    // Every fetch must target the literal LeetCode GraphQL URL.
    const fetchCalls = [...lookup.matchAll(/fetch\(\s*([^,)]+)/g)].map((m) => m[1].trim());
    assert.deepEqual(fetchCalls, ['"https://leetcode.com/graphql"']);
  });

  it("fails closed when LeetCode gives no answer", () => {
    assert.match(lookup, /status: "unavailable"/);
  });

  it("logs a security event when the lookup is unavailable", () => {
    const hits = serverSource.match(/logSecurityEvent\("ownership_lookup_unavailable"/g) ?? [];
    assert.equal(hits.length, 2, "both /register and /register/verify should log it");
  });
});
