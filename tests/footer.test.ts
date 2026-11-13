import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SiteFooter from "../src/SiteFooter.js";
import { LEGAL } from "../src/legal.js";

const render = (props: Parameters<typeof SiteFooter>[0] = {}) => renderToStaticMarkup(createElement(SiteFooter, props));
const read = (file: string) => fs.readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

describe("site footer", () => {
  it("links Privacy, Terms, Contact and GitHub", () => {
    const html = render();
    assert.match(html, /href="\/privacy"[^>]*>Privacy</);
    assert.match(html, /href="\/terms"[^>]*>Terms</);
    assert.ok(html.includes(`href="mailto:${LEGAL.contactEmail}"`));
    assert.ok(html.includes(`href="${LEGAL.sourceUrl}"`));
  });

  it("leaves the Status link out until a status page is configured", () => {
    assert.doesNotMatch(render({ statusUrl: "" }), />Status</);
    const html = render({ statusUrl: "https://status.example.com" });
    assert.match(html, /href="https:\/\/status\.example\.com"[^>]*>Status/);
  });

  it("opens external links safely, and the legal links in a new tab only when asked", () => {
    const html = render({ statusUrl: "https://status.example.com" });
    const externals = html.match(/<a [^>]*target="_blank"[^>]*>/g) ?? [];
    assert.equal(externals.length, 2); // GitHub, Status
    for (const a of externals) assert.match(a, /rel="noopener noreferrer"/);
    assert.doesNotMatch(html.match(/<a [^>]*href="\/privacy"[^>]*>/)![0], /target=/);
    assert.match(render({ newTab: true }).match(/<a [^>]*href="\/privacy"[^>]*>/)![0], /target="_blank"/);
  });

  it("shows a custom lead in place of the copyright line", () => {
    assert.ok(render({ lead: "Made by someone" }).includes("Made by someone"));
    assert.match(render(), new RegExp(`© \\d{4} ${LEGAL.serviceName}`));
  });
});

// "A footer on every page": the three page shells must keep rendering it.
describe("footer coverage", () => {
  for (const file of ["src/App.tsx", "src/Landing.tsx", "src/LegalPages.tsx"]) {
    it(`${file} renders the shared footer`, () => {
      const src = read(file);
      assert.match(src, /import SiteFooter from/);
      assert.match(src, /<SiteFooter/);
    });
  }
});
