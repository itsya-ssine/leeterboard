/**
 * Guards the security configuration against silent drift.
 *
 *   npm run security:check
 *
 * Fails (exit 1) when:
 *   1. an inline <script> in index.html (or in dist/index.html, if built) has a
 *      hash that is missing from the Content-Security-Policy — the page would
 *      load with its theme script blocked;
 *   2. vercel.json doesn't send exactly the headers securityHeaders.ts defines
 *      for the static frontend — Vercel serves those files without Express.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { INLINE_SCRIPT_HASHES, STATIC_SITE_HEADERS } from "../securityHeaders.js";

const root = path.resolve(import.meta.dirname, "..");
const problems: string[] = [];

function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const re = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    hashes.push("sha256-" + crypto.createHash("sha256").update(m[1]).digest("base64"));
  }
  return hashes;
}

for (const file of ["index.html", "dist/index.html"]) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  for (const hash of inlineScriptHashes(fs.readFileSync(full, "utf8"))) {
    if (!INLINE_SCRIPT_HASHES.includes(hash)) {
      problems.push(`${file}: inline script hash '${hash}' is not in INLINE_SCRIPT_HASHES (securityHeaders.ts).`);
    }
  }
}

const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const headerRoute = (vercel.routes ?? []).find((r: any) => r.headers && r.continue === true);
if (!headerRoute) {
  problems.push("vercel.json: no route with `headers` and `continue: true` for the static frontend.");
} else {
  const actual: Record<string, string> = headerRoute.headers;
  for (const [name, value] of Object.entries(STATIC_SITE_HEADERS)) {
    if (actual[name] !== value) problems.push(`vercel.json: header "${name}" differs from securityHeaders.ts.`);
  }
  for (const name of Object.keys(actual)) {
    if (!(name in STATIC_SITE_HEADERS)) problems.push(`vercel.json: header "${name}" is not defined in securityHeaders.ts.`);
  }
}

if (problems.length) {
  console.error("Security configuration check failed:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}
console.log("Security configuration OK (CSP script hashes and vercel.json headers match).");
