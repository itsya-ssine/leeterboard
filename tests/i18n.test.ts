import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TRANSLATIONS, type Locale } from "../src/i18n.js";

describe("i18n configuration and translations", () => {
  const locales: Locale[] = ["en", "fr", "ar"];
  const expectedKeys = Object.keys(TRANSLATIONS.en) as (keyof typeof TRANSLATIONS.en)[];

  it("defines translations for en, fr, and ar", () => {
    for (const loc of locales) {
      assert.ok(TRANSLATIONS[loc], `Missing translations for locale ${loc}`);
    }
  });

  it("has non-empty string values for all keys across all supported locales", () => {
    for (const loc of locales) {
      for (const key of expectedKeys) {
        const val = TRANSLATIONS[loc][key];
        assert.equal(typeof val, "string", `Key ${key} in ${loc} must be a string`);
        assert.ok(val.length > 0, `Key ${key} in ${loc} must not be empty`);
      }
    }
  });

  it("contains Arabic RTL translations", () => {
    assert.equal(TRANSLATIONS.ar.leaderboard, "لوحة الصدارة");
    assert.equal(TRANSLATIONS.ar.stats, "الإحصائيات");
  });

  it("contains French translations", () => {
    assert.equal(TRANSLATIONS.fr.leaderboard, "Classement");
    assert.equal(TRANSLATIONS.fr.stats, "Statistiques");
  });
});
