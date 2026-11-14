import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("SEO and public assets (PRO-03 / PRO-05)", () => {
  it("provides robots.txt that allows crawling while protecting /api/", () => {
    const robots = read("public/robots.txt");
    assert.match(robots, /User-agent:\s*\*/i);
    assert.match(robots, /Allow:\s*\//i);
    assert.match(robots, /Disallow:\s*\/api\//i);
    assert.match(robots, /Sitemap:\s*https:\/\/leaderboard-leet\.vercel\.app\/sitemap\.xml/i);
  });

  it("provides sitemap.xml with canonical site routes", () => {
    const sitemap = read("public/sitemap.xml");
    assert.match(sitemap, /<urlset\s+xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    assert.ok(sitemap.includes("<loc>https://leaderboard-leet.vercel.app/</loc>"));
    assert.ok(sitemap.includes("<loc>https://leaderboard-leet.vercel.app/faq</loc>"));
    assert.ok(sitemap.includes("<loc>https://leaderboard-leet.vercel.app/privacy</loc>"));
    assert.ok(sitemap.includes("<loc>https://leaderboard-leet.vercel.app/terms</loc>"));
  });

  it("provides a valid web manifest with favicon asset", () => {
    const raw = read("public/site.webmanifest");
    const manifest = JSON.parse(raw);
    assert.equal(manifest.name, "Leeterboard");
    assert.equal(manifest.short_name, "Leeterboard");
    assert.equal(manifest.display, "standalone");
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
    assert.equal(manifest.icons[0].src, "/favicon.svg");
  });

  it("index.html references the manifest and svg favicon", () => {
    const html = read("index.html");
    assert.match(html, /<link\s+rel="manifest"\s+href="\/site\.webmanifest"\s*\/?>/);
    assert.match(html, /<link\s+rel="icon"\s+href="\/favicon\.svg"/);
  });
});
