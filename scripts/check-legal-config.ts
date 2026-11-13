/**
 * Release check for the legal pages: fails while any LEGAL value in
 * src/legal.ts still holds a REPLACE_ME placeholder.
 *
 *   npm run legal:check
 *
 * Run it before publishing, and before submitting the Google OAuth consent
 * screen, so the Privacy Policy never goes live with a fake contact address.
 */
import { LEGAL, unfilledLegalFields } from "../src/legal.js";

const missing = unfilledLegalFields();
if (missing.length > 0) {
  console.error("Legal pages are not ready to release. Fill these in src/legal.ts:");
  for (const key of missing) console.error(`  - LEGAL.${key}  (currently "${LEGAL[key as keyof typeof LEGAL]}")`);
  process.exit(1);
}
console.log("Legal configuration OK (no placeholders left).");
