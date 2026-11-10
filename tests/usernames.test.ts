import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkUsername, isReservedUsername, parseUsername } from "../usernames.js";

const error = (value: unknown) => {
  const check = checkUsername(value);
  assert.equal(check.ok, false, `expected ${JSON.stringify(value)} to be rejected`);
  return check.ok ? "" : check.error;
};

describe("parseUsername", () => {
  it("accepts letters, numbers and underscores, and lowercases the result", () => {
    assert.equal(parseUsername("Alice_99"), "alice_99");
    assert.equal(parseUsername("bob"), "bob");
    assert.equal(parseUsername("X_Y_Z"), "x_y_z");
    assert.equal(parseUsername("123"), "123");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(parseUsername("  carol  "), "carol");
    assert.equal(parseUsername("\tdave\n"), "dave");
  });

  it("accepts exactly 3 and exactly 30 characters", () => {
    assert.equal(parseUsername("abc"), "abc");
    assert.equal(parseUsername("a".repeat(30)), "a".repeat(30));
  });

  it("returns null for anything it rejects", () => {
    for (const bad of [undefined, null, 42, {}, [], true, "", "   ", "ab", "a".repeat(31), "has space", "dash-ed", "dot.ted"]) {
      assert.equal(parseUsername(bad), null, JSON.stringify(bad));
    }
  });
});

describe("checkUsername messages", () => {
  it("asks for a name when there is none", () => {
    assert.equal(error(undefined), "Username is required.");
    assert.equal(error(""), "Username is required.");
    assert.equal(error("   "), "Username is required.");
    assert.equal(error(123), "Username is required.");
  });

  it("states the length limits", () => {
    assert.equal(error("ab"), "Username must be 3 to 30 characters.");
    assert.equal(error("a".repeat(31)), "Username must be 3 to 30 characters.");
  });

  it("measures length after trimming, not before", () => {
    assert.equal(error("  ab  "), "Username must be 3 to 30 characters.");
    assert.equal(parseUsername(`  ${"a".repeat(30)}  `), "a".repeat(30));
  });

  it("rejects anything outside A-Z, a-z, 0-9 and _", () => {
    const message = "Username can only use letters, numbers and underscores.";
    for (const bad of [
      "has space",
      "dash-ed",
      "dot.ted",
      "at@sign",
      "slash/es",
      "quote'd",
      "<script>",
      "semi;colon",
      "caf\u00e9", // é
      "\u0430lice", // Cyrillic "а" that looks like a Latin "a"
      "\u00fcser", // ü
      "smile\u{1F600}", // emoji
      "tab\there",
      "line\nbreak",
      "nul\u0000byte",
      "\u200balice", // zero-width space is not trimmed by String.trim()
      "alice\u200b"
    ]) {
      assert.equal(error(bad), message, JSON.stringify(bad));
    }
  });

  it("does not let a trailing newline through (JavaScript's $ is strict)", () => {
    assert.equal(parseUsername("alice\n"), "alice"); // trimmed away, so fine
    assert.equal(error("ali\nce"), "Username can only use letters, numbers and underscores.");
  });

  it("needs at least one letter or number", () => {
    assert.equal(error("___"), "Username must include at least one letter or number.");
    assert.equal(error("_".repeat(30)), "Username must include at least one letter or number.");
    assert.equal(parseUsername("__a"), "__a");
    assert.equal(parseUsername("_1_"), "_1_");
  });

  it("refuses names that would pass for the site or its staff, in any letter case", () => {
    for (const bad of ["admin", "Admin", "ADMIN", " root ", "Support", "leeterboard", "LeetCode", "null", "undefined"]) {
      assert.equal(error(bad), "That username isn't available.", bad);
    }
    // Close, but not the same word.
    assert.equal(parseUsername("admin1"), "admin1");
    assert.equal(parseUsername("my_admin"), "my_admin");
    assert.equal(parseUsername("administrators"), "administrators");
  });
});

describe("isReservedUsername", () => {
  it("is case-insensitive", () => {
    assert.equal(isReservedUsername("Moderator"), true);
    assert.equal(isReservedUsername("alice"), false);
  });
});
