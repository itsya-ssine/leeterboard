import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeProgressFromHistory,
  computeWeeklyProgressFromHistory,
  daysIntoWeek,
  baselineOf
} from "../server/domain/progress.js";
import type { HistoryRecord, User } from "../shared/types.js";

function makeRecord(date: string, solvedCount: number): HistoryRecord {
  return {
    date,
    solvedCount,
    easy: 0,
    medium: 0,
    hard: 0,
    weeklyProgress: 0
  };
}

describe("domain: progress calculations", () => {
  it("returns null when history is empty or missing", () => {
    assert.equal(computeProgressFromHistory([], 100, 7), null);
    assert.equal(computeProgressFromHistory(null as any, 100, 7), null);
    assert.equal(computeWeeklyProgressFromHistory([], 100), null);
  });

  it("never goes negative when live total drops (monotonic guard against solve revocation)", () => {
    // 7 days ago user had 100 solves, but now user has 95 solves
    const history = [makeRecord("2026-11-06", 100)];
    const now = Date.parse("2026-11-13T12:00:00Z");
    const progress = computeProgressFromHistory(history, 95, 7, now);
    assert.equal(progress, 0);
  });

  it("calculates exact progress over a standard window", () => {
    // 7 days ago: 100, now: 115
    const history = [
      makeRecord("2026-11-06", 100),
      makeRecord("2026-11-07", 102),
      makeRecord("2026-11-12", 110)
    ];
    const now = Date.parse("2026-11-13T12:00:00Z");
    const progress = computeProgressFromHistory(history, 115, 7, now);
    // Target is end of today (2026-11-13T23:59:59.999Z) - 7 days = 2026-11-06T23:59:59.999Z
    // 2026-11-06 had 100, current total 115 -> 15 solved
    assert.equal(progress, 15);
  });

  it("interpolates linearly across history snapshot gaps", () => {
    // User had 100 on Nov 01 and 120 on Nov 11 (gap between Nov 01 and Nov 11)
    const history = [
      makeRecord("2026-11-01", 100),
      makeRecord("2026-11-11", 120)
    ];
    // Window: 7 days before Nov 13 = Nov 06.
    // Nov 06 is halfway between Nov 01 (100) and Nov 11 (120) -> baseline ≈ 110
    const now = Date.parse("2026-11-13T23:59:59.999Z");
    const progress = computeProgressFromHistory(history, 125, 7, now);
    // Nov 06 baseline is 110. Current total is 125 -> progress = 125 - 110 = 15.
    assert.equal(progress, 15);
  });

  it("measures progress from joined baseline when user joined inside the window", () => {
    // Member joined 3 days ago with 50 solved
    const history = [
      makeRecord("2026-11-11", 52),
      makeRecord("2026-11-12", 55)
    ];
    const now = Date.parse("2026-11-13T12:00:00Z");
    const joined = { date: "2026-11-10", solved: 50 };
    // 7-day window reaches back before joined date
    const progress = computeProgressFromHistory(history, 60, 7, now, joined);
    // Baseline is 50 (at joined date), current is 60 -> progress is 10
    assert.equal(progress, 10);
  });

  it("computes daysIntoWeek correctly (Monday=1, Sunday=7) in UTC", () => {
    // 2026-11-09 was a Monday
    assert.equal(daysIntoWeek(Date.parse("2026-11-09T00:00:00Z")), 1);
    assert.equal(daysIntoWeek(Date.parse("2026-11-09T12:00:00Z")), 1);
    assert.equal(daysIntoWeek(Date.parse("2026-11-09T23:59:59Z")), 1);

    // 2026-11-11 was Wednesday -> 3
    assert.equal(daysIntoWeek(Date.parse("2026-11-11T14:30:00Z")), 3);

    // 2026-11-15 was Sunday -> 7
    assert.equal(daysIntoWeek(Date.parse("2026-11-15T23:59:59Z")), 7);
  });

  it("resets weekly progress on Monday 00:00 UTC", () => {
    // Sunday 2026-11-08: 200 solved.
    // Monday 2026-11-09 00:01 UTC: still 200 solved.
    const history = [
      makeRecord("2026-11-08", 200)
    ];
    const mondayMorning = Date.parse("2026-11-09T00:01:00Z");
    const weeklyProgress = computeWeeklyProgressFromHistory(history, 200, mondayMorning);
    assert.equal(weeklyProgress, 0);

    // Solve 2 on Monday afternoon
    const mondayAfternoon = Date.parse("2026-11-09T15:00:00Z");
    const updatedWeekly = computeWeeklyProgressFromHistory(history, 202, mondayAfternoon);
    assert.equal(updatedWeekly, 2);
  });

  it("handles leap year dates seamlessly", () => {
    // 2024 was a leap year (2024-02-29 exists)
    const history = [
      makeRecord("2024-02-28", 50),
      makeRecord("2024-02-29", 54),
      makeRecord("2024-03-01", 58)
    ];
    const now = Date.parse("2024-03-02T12:00:00Z");
    const progress = computeProgressFromHistory(history, 60, 2, now);
    assert.equal(progress, 6); // from 2024-02-29 (54) to 60 -> 6
  });

  it("correctly extracts baseline from user record with baselineOf", () => {
    const user: Partial<User> = {
      trackingStart: "2026-10-01",
      baselineSolved: 142
    };
    const base = baselineOf(user as User);
    assert.deepEqual(base, { date: "2026-10-01", solved: 142 });
  });
});
