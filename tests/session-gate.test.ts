import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { gateView } from "../src/sessionGate.js";

describe("session gate", () => {
  it("shows a spinner while the session is being checked, never the sign-in form", () => {
    assert.equal(gateView("loading"), "loading");
  });

  it("shows only the sign-in screen without a session", () => {
    assert.equal(gateView("guest"), "auth");
  });

  it("shows the app with a session", () => {
    assert.equal(gateView("authenticated"), "app");
  });
});

describe("where the app is mounted", () => {
  // The app is what loads members and trends, polls the server and triggers
  // syncs. It must only exist inside the session gate, so those requests
  // start with a session and stop when it ends.
  const main = fs.readFileSync(path.resolve(import.meta.dirname, "../src/main.tsx"), "utf8");

  it("renders <App /> inside <SessionGate>", () => {
    const gate = main.indexOf("<SessionGate>");
    const app = main.indexOf("<App />");
    const close = main.indexOf("</SessionGate>");
    assert.ok(gate !== -1 && app > gate && close > app, "<App /> must be a child of <SessionGate>");
  });
});
