import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DAY_SECONDS,
  parseSubmissionCalendar,
  streaksFromDays
} from "../server/domain/streaks.js";

describe("domain: streaks calculations", () => {
  it("parses valid submission calendar JSON string into day indexes", () => {
    // 1759449600 / 86400 = 20364
    // 1759536000 / 86400 = 20365
    const raw = JSON.stringify({
      "1759449600": 3,
      "1759536000": 1,
      "1759622400": 0 // 0 count should be ignored
    });
    const days = parseSubmissionCalendar(raw);
    assert.deepEqual(days, [20364, 20365]);
  });

  it("handles malformed or invalid calendar inputs gracefully", () => {
    assert.equal(parseSubmissionCalendar(null), null);
    assert.equal(parseSubmissionCalendar(undefined), null);
    assert.equal(parseSubmissionCalendar(123), null);
    assert.equal(parseSubmissionCalendar("not json"), null);
    assert.equal(parseSubmissionCalendar("[]"), null);
    assert.equal(parseSubmissionCalendar("null"), null);
    assert.equal(parseSubmissionCalendar("{}")?.length, 0);
  });

  it("computes active streak ending today", () => {
    const today = 20000;
    const days = [today - 3, today - 2, today - 1, today];
    const streak = streaksFromDays(days, today);
    assert.equal(streak.current, 4);
    assert.equal(streak.longest, 4);
  });

  it("keeps streak active if user submitted yesterday but hasn't submitted yet today", () => {
    const today = 20000;
    const days = [today - 4, today - 3, today - 2, today - 1]; // active through yesterday
    const streak = streaksFromDays(days, today);
    assert.equal(streak.current, 4);
    assert.equal(streak.longest, 4);
  });

  it("drops current streak to 0 if a full day was missed (last submission was 2 days ago)", () => {
    const today = 20000;
    const days = [today - 5, today - 4, today - 3, today - 2]; // missed yesterday
    const streak = streaksFromDays(days, today);
    assert.equal(streak.current, 0);
    assert.equal(streak.longest, 4); // longest streak preserved
  });

  it("tracks longest streak across historical runs with gaps", () => {
    const today = 20000;
    const days = [
      // Old 5-day streak
      19900, 19901, 19902, 19903, 19904,
      // Gap
      // Current 3-day streak
      today - 2, today - 1, today
    ];
    const streak = streaksFromDays(days, today);
    assert.equal(streak.current, 3);
    assert.equal(streak.longest, 5);
  });

  it("deduplicates multiple submissions on the same day", () => {
    const today = 20000;
    const days = [today - 1, today - 1, today, today, today];
    const streak = streaksFromDays(days, today);
    assert.equal(streak.current, 2);
    assert.equal(streak.longest, 2);
  });

  it("ignores future days beyond todayIdx", () => {
    const today = 20000;
    const days = [today - 1, today, today + 1, today + 2];
    const streak = streaksFromDays(days, today);
    assert.equal(streak.current, 2);
    assert.equal(streak.longest, 2);
  });
});
