import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeAvatar, AVATAR_HOSTS } from "../avatar.js";

describe("Avatar URL Validation (SEC-09)", () => {
  it("allows avatars on official LeetCode assets CDN", () => {
    const url = "https://assets.leetcode.com/users/test/avatar_123.png";
    assert.equal(safeAvatar(url), url);
  });

  it("resolves and allows root-relative LeetCode URLs", () => {
    assert.equal(safeAvatar("/static/images/default_avatar.png"), "https://leetcode.com/static/images/default_avatar.png");
  });

  it("allows Codeforces userpic CDN", () => {
    const cf = "https://userpic.codeforces.org/no-title.jpg";
    assert.equal(safeAvatar(cf), cf);
  });

  it("handles protocol-relative URLs on allowed hosts", () => {
    assert.equal(safeAvatar("//userpic.codeforces.org/avatar.jpg"), "https://userpic.codeforces.org/avatar.jpg");
  });

  it("rejects unauthorized third-party hosts", () => {
    assert.equal(safeAvatar("https://evil-tracking.com/avatar.png"), null);
    assert.equal(safeAvatar("https://attacker.site/image.jpg"), null);
  });

  it("rejects insecure plain HTTP URLs", () => {
    assert.equal(safeAvatar("http://assets.leetcode.com/avatar.png"), null);
  });

  it("rejects javascript: and invalid schemes", () => {
    assert.equal(safeAvatar("javascript:alert(1)"), null);
    assert.equal(safeAvatar("data:image/svg+xml,<svg></svg>"), null);
  });

  it("rejects empty or null inputs", () => {
    assert.equal(safeAvatar(null), null);
    assert.equal(safeAvatar(undefined), null);
    assert.equal(safeAvatar(""), null);
    assert.equal(safeAvatar("   "), null);
  });
});
