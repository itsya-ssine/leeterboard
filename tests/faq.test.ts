import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FaqPage from "../src/FaqPage.js";
import SiteFooter from "../src/SiteFooter.js";
import { FAQ_PATH, FAQ_UPDATED, POLL_SECONDS, SYNC_MINUTES, isFaqPath } from "../src/faq.js";
import { RETENTION } from "../src/legal.js";
import { RATING_TIERS } from "../src/tiers.js";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("FAQ page routing", () => {
  it("recognises /faq, with a trailing slash or other letter case", () => {
    for (const p of ["/faq", "/faq/", "/FAQ", "/Faq//"]) assert.equal(isFaqPath(p), true, p);
  });

  it("leaves every other path to the app", () => {
    for (const p of ["/", "", "/api/faq", "/faq/extra", "/faqs", "/faq.html", "/u/faq", "/privacy"]) {
      assert.equal(isFaqPath(p), false, p);
    }
  });

  it("is served by vercel.json like the legal pages", () => {
    const routes: { src: string; dest?: string }[] = JSON.parse(read("vercel.json")).routes;
    const route = routes.find((r) => r.dest === "/index.html");
    assert.ok(route, "a route that serves index.html");
    assert.ok(new RegExp(`^${route.src}$`).test(FAQ_PATH), `${route.src} should match ${FAQ_PATH}`);
    assert.ok(new RegExp(`^${route.src}$`).test(`${FAQ_PATH}/`));
  });
});

describe("FAQ page content", () => {
  const html = renderToStaticMarkup(createElement(FaqPage));

  it("renders a title, the updated date and every section in the contents list", () => {
    assert.match(html, /<h1[^>]*>How scoring works<\/h1>/);
    assert.ok(html.includes(`dateTime="${FAQ_UPDATED}"`));
    for (const id of ["overview", "ranking", "progress", "tiers", "badges", "platforms", "syncing", "faq"]) {
      assert.ok(html.includes(`href="#${id}"`), `contents link to #${id}`);
      assert.ok(html.includes(`id="${id}"`), `section #${id}`);
    }
  });

  it("lists every rating tier with the threshold the app uses", () => {
    for (const tier of RATING_TIERS) {
      assert.ok(html.includes(tier.name), tier.name);
      assert.ok(html.includes(tier.min.toLocaleString("en-US")), `${tier.name} from ${tier.min}`);
    }
  });

  it("states the sync and history numbers the code really uses", () => {
    assert.equal(Number(/const AUTO_SYNC_STALE_MS = 1000 \* 60 \* (\d+)/.exec(read("server.ts"))?.[1]), SYNC_MINUTES);
    assert.equal(Number(/const POLL_INTERVAL_MS = (\d+)_000/.exec(read("src/App.tsx"))?.[1]), POLL_SECONDS);
    assert.ok(html.includes(`${SYNC_MINUTES} minutes`));
    assert.ok(html.includes(`${POLL_SECONDS} seconds`));
    assert.ok(html.includes(`${RETENTION.historyDays} days`));
  });

  it("names the badges that achievements.ts awards", () => {
    for (const label of ["First Hard", "First contest", "7-day streak", "Most improved", "First on the board", "Knight", "Guardian"]) {
      assert.ok(html.includes(label), label);
    }
  });

  it("points to the privacy policy, the source and the data download", () => {
    assert.ok(html.includes('href="/privacy"'));
    assert.ok(html.includes("Download my data"));
  });
});

describe("footer", () => {
  it("links to the FAQ on every page that uses it", () => {
    const html = renderToStaticMarkup(createElement(SiteFooter, {}));
    assert.match(html, /href="\/faq"[^>]*>FAQ</);
  });
});
