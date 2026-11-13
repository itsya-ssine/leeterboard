import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LegalPage from "../src/LegalPages.js";
import { LEGAL, RETENTION, legalPageFromPath, unfilledLegalFields } from "../src/legal.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("legal page routing", () => {
  it("recognises /privacy and /terms, with a trailing slash or other letter case", () => {
    assert.equal(legalPageFromPath("/privacy"), "privacy");
    assert.equal(legalPageFromPath("/terms"), "terms");
    assert.equal(legalPageFromPath("/privacy/"), "privacy");
    assert.equal(legalPageFromPath("/Terms"), "terms");
  });

  it("leaves every other path to the app", () => {
    for (const p of ["/", "", "/api/users", "/privacy/extra", "/privacy-policy", "/terms.html", "/u/privacy"]) {
      assert.equal(legalPageFromPath(p), null, p);
    }
  });
});

describe("legal pages", () => {
  for (const page of ["privacy", "terms"] as const) {
    it(`${page}: renders, shows the contact address and the effective date`, () => {
      const html = renderToStaticMarkup(createElement(LegalPage, { page }));
      assert.match(html, /<h1[^>]*>/);
      assert.ok(html.includes(`mailto:${LEGAL.contactEmail}`));
      assert.ok(html.includes(`dateTime="${LEGAL.effectiveDate}"`));
    });
  }

  it("privacy: discloses the third parties the code actually calls", () => {
    const html = renderToStaticMarkup(createElement(LegalPage, { page: "privacy" }));
    for (const name of ["Vercel", "Turso", "Google Fonts", "alfa-leetcode-api", "leetcode-stats-api", "Codeforces", "CodinGame"]) {
      assert.ok(html.includes(name), `Privacy Policy should mention ${name}`);
    }
    assert.ok(html.includes("Google API Services User Data Policy"));
  });

  it("privacy: the retention periods match the code", () => {
    const db = read("db.ts");
    assert.equal(Number(/export const HISTORY_LIMIT = (\d+)/.exec(db)?.[1]), RETENTION.historyDays);
    assert.equal(Number(/export const NOTIFICATIONS_KEEP_DAYS = (\d+)/.exec(db)?.[1]), RETENTION.notificationDays);
  });

  it("privacy: names the cookies the server really sets", () => {
    const html = renderToStaticMarkup(createElement(LegalPage, { page: "privacy" }));
    const server = read("server.ts") + read("auth.ts");
    for (const cookie of ["session", "oauth_state", "oauth_signup", "pwreset"]) {
      assert.ok(server.includes(`"${cookie}"`), `${cookie} cookie should exist in the server code`);
      assert.ok(html.includes(cookie), `Privacy Policy should list the ${cookie} cookie`);
    }
  });
});

describe("legal config", () => {
  it("flags placeholders that are still unfilled", () => {
    assert.deepEqual(unfilledLegalFields({ a: "ok", b: "REPLACE_ME@example.com", c: "REPLACE_ME (country)" }), ["b", "c"]);
    assert.deepEqual(unfilledLegalFields({ a: "ok" }), []);
  });
});

describe("deployment", () => {
  it("vercel.json serves /privacy and /terms from index.html, before the catch-all", () => {
    const routes: Array<{ src: string; dest?: string }> = JSON.parse(read("vercel.json")).routes;
    const legal = routes.findIndex((r) => r.dest === "/index.html" && new RegExp(`^${r.src}$`).test("/privacy") && new RegExp(`^${r.src}$`).test("/terms"));
    const catchAll = routes.findIndex((r) => r.src === "/(.*)");
    assert.ok(legal >= 0, "no route sends /privacy and /terms to /index.html");
    assert.ok(legal < catchAll, "the legal route must come before the catch-all");
  });
});
