import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startServer, type TestServer } from "./helpers.js";

describe("GET /api/health (CQ-08 / PRO-07)", () => {
  let server: TestServer;

  before(async () => {
    server = await startServer();
  });

  after(async () => {
    await server?.stop();
  });

  it("returns 200 with system status and no-store caching headers without authentication", async () => {
    const res = await fetch(`${server.url}/api/health`);
    assert.equal(res.status, 200);

    const cc = res.headers.get("cache-control") || "";
    assert.ok(cc.includes("no-store"), `Expected Cache-Control: no-store, got "${cc}"`);

    const body = (await res.json()) as {
      ok: boolean;
      uptime: number;
      timestamp: string;
      lastSyncAll: string | null;
    };

    assert.equal(body.ok, true);
    assert.ok(typeof body.uptime === "number" && body.uptime >= 0);
    assert.ok(typeof body.timestamp === "string" && Number.isFinite(Date.parse(body.timestamp)));
    assert.ok("lastSyncAll" in body);
  });
});
