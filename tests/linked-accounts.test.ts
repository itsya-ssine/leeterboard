import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { hasNothingLinked, leetcodeMembers, rowAccountFor } from "../src/linkedAccounts.js";
import { makeUser } from "./f2-seed.js";

// makeUser leaves leetcodeLinked to the database; here it has to be explicit.
const linked = (name: string, over: Record<string, unknown> = {}) => makeUser(name, { leetcodeLinked: true, ...over });
const plain = (name: string, platforms?: Record<string, unknown>) =>
  makeUser(name, {
    leetcodeLinked: false,
    leetcodeUsername: "",
    allTimeSolved: 0,
    lastUpdated: null,
    ...(platforms ? { platforms } : {})
  });
const cf = { platform: "codeforces", handle: "tourist", solved: 12, rating: 1500, rankTitle: "pupil", lastUpdated: "2026-11-01T00:00:00Z", hidden: false };

describe("the account page's rows", () => {
  it("shows LeetCode from the member itself", () => {
    const user = linked("row_lc", { contestRating: 1700, hideLeetcodeStats: true });
    const row = rowAccountFor(user, "leetcode")!;
    assert.equal(row.handle, "row_lc");
    assert.equal(row.solved, 100);
    assert.equal(row.rating, 1700);
    assert.equal(row.hidden, true);
  });

  it("has no LeetCode row for a member who never linked it", () => {
    assert.equal(rowAccountFor(plain("row_none"), "leetcode"), undefined);
  });

  it("takes Codeforces and CodinGame from `platforms`", () => {
    const user = plain("row_cf", { codeforces: cf });
    assert.equal(rowAccountFor(user, "codeforces")!.handle, "tourist");
    assert.equal(rowAccountFor(user, "codingame"), undefined);
  });
});

describe("the LeetCode board", () => {
  it("is only the members who linked LeetCode, in the order given", () => {
    const a = linked("lb_a");
    const b = plain("lb_b", { codeforces: cf });
    const c = linked("lb_c");
    assert.deepEqual(leetcodeMembers([a, b, c]).map((u) => u.displayName), ["lb_a", "lb_c"]);
  });

  it("is empty when nobody linked it", () => {
    assert.deepEqual(leetcodeMembers([plain("lb_d"), plain("lb_e")]), []);
  });
});

describe("a member with nothing linked", () => {
  it("is someone with no LeetCode, Codeforces or CodinGame", () => {
    assert.equal(hasNothingLinked(plain("nl_a")), true);
    assert.equal(hasNothingLinked(plain("nl_b", {})), true);
  });

  it("is not someone with any one of them", () => {
    assert.equal(hasNothingLinked(linked("nl_c")), false);
    assert.equal(hasNothingLinked(plain("nl_d", { codeforces: cf })), false);
    assert.equal(hasNothingLinked(plain("nl_e", { codingame: { ...cf, platform: "codingame" } })), false);
  });
});

describe("the app without a session", () => {
  const read = (file: string) => fs.readFileSync(path.resolve(import.meta.dirname, "../src", file), "utf8");
  const app = read("App.tsx");

  it("has no login modal, Log in button or logged-out state left in the navbar", () => {
    assert.equal(app.includes("LoginModal"), false);
    assert.equal(app.includes("open-login-btn"), false);
    assert.equal(app.includes("setIsLoginOpen"), false);
    assert.equal(/authStatus/.test(app), false);
  });

  it("keeps the admin page closed to non-admins", () => {
    assert.match(app, /currentUser\?\.isAdmin \? \(\s*<AdminDashboard/);
    assert.match(app, /id="admin-forbidden"/);
  });

  it("keeps the account page's own signed-out guard", () => {
    assert.match(read("AccountPage.tsx"), /id="account-signed-out"/);
  });

  it("keeps hash routing for every page", () => {
    for (const route of ["#/admin", "#/compare", "#/u/", "#/account", "#/codeforces", "#/codingame", "#/stats"]) {
      assert.ok(app.includes(`"${route}`), route);
    }
  });
});
