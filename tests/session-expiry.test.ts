import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { installSessionExpiryHandler, SESSION_REQUIRED_CODE } from "../src/api.js";

const BASE = "http://localhost:3000/";
const root = path.resolve(import.meta.dirname, "..");

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function setup(respond: (url: string) => Response, epoch = { n: 1 }) {
  const calls: number[] = [];
  const host = { fetch: (async (input: RequestInfo | URL) => respond(String(input))) as typeof fetch };
  const original = host.fetch;
  const remove = installSessionExpiryHandler(() => epoch.n, (e) => calls.push(e), host, BASE);
  return { host, original, remove, calls, epoch };
}

describe("session expiry handler", () => {
  it("fires on a session-required 401 from the API", async () => {
    const t = setup(() => json(401, { error: "You must be logged in to do that.", code: SESSION_REQUIRED_CODE }));
    const res = await t.host.fetch("/api/users");
    assert.equal(res.status, 401);
    assert.deepEqual(t.calls, [1]);
    assert.equal((await res.json()).code, SESSION_REQUIRED_CODE, "the caller can still read the response body");
  });

  it("does not fire for a 401 without the code (wrong password, bad login)", async () => {
    const t = setup(() => json(401, { error: "Current password is incorrect." }));
    await t.host.fetch("/api/account/password", { method: "POST" });
    await t.host.fetch("/api/auth/login", { method: "POST" });
    assert.deepEqual(t.calls, []);
  });

  it("does not fire for other statuses or non-JSON bodies", async () => {
    const t = setup((url) =>
      url.includes("boom") ? new Response("<html>bad gateway</html>", { status: 401 }) : json(403, { code: SESSION_REQUIRED_CODE })
    );
    await t.host.fetch("/api/admin/sync-status");
    await t.host.fetch("/api/boom");
    assert.deepEqual(t.calls, []);
  });

  it("ignores requests that are not to this app's API", async () => {
    const t = setup(() => json(401, { code: SESSION_REQUIRED_CODE }));
    await t.host.fetch("https://example.com/api/users");
    await t.host.fetch("/assets/app.js");
    assert.deepEqual(t.calls, []);
  });

  it("reports the epoch the request started in, not the one it finished in", async () => {
    const epoch = { n: 1 };
    const t = setup(() => {
      epoch.n = 2; // the member signed out and in again while the request was running
      return json(401, { code: SESSION_REQUIRED_CODE });
    }, epoch);
    await t.host.fetch("/api/trends");
    assert.deepEqual(t.calls, [1]);
  });

  it("puts the original fetch back when removed", () => {
    const t = setup(() => json(200, {}));
    assert.notEqual(t.host.fetch, t.original);
    t.remove();
    assert.equal(t.host.fetch, t.original);
  });
});

describe("the code the server sends", () => {
  it("is the same string on both sides", () => {
    const auth = fs.readFileSync(path.join(root, "auth.ts"), "utf8");
    assert.equal(/SESSION_REQUIRED_CODE = "([^"]+)"/.exec(auth)?.[1], SESSION_REQUIRED_CODE);
  });
});
