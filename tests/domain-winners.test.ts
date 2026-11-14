import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeWeeklyWinners,
  mergeWinnerArchive,
  parseWinnerArchive,
  tallyWinners,
  weekStartOf,
  lastWeekStart,
  addDays,
  type WeeklyWinner
} from "../shared/winners.js";
import type { User } from "../shared/types.js";

function makeUser(
  id: string,
  displayName: string,
  allTimeSolved: number,
  history: Array<{ date: string; solvedCount: number }>,
  trackingStart = "2026-01-01",
  baselineSolved = 0
): User {
  return {
    id,
    displayName,
    loginUsername: displayName.toLowerCase(),
    leetcodeLinked: true,
    leetcodeUsername: displayName.toLowerCase(),
    avatarUrl: "",
    school: "",
    bio: "",
    githubUrl: "",
    linkedinUrl: "",
    websiteUrl: "",
    allTimeSolved,
    easySolved: 0,
    mediumSolved: 0,
    hardSolved: 0,
    weeklyProgress: 0,
    monthlyProgress: 0,
    rank: 1,
    contestRating: null,
    contestsAttended: 0,
    currentStreak: null,
    longestStreak: null,
    lastUpdated: null,
    trackingStart,
    baselineSolved,
    history: history.map((h) => ({
      date: h.date,
      solvedCount: h.solvedCount,
      easy: 0,
      medium: 0,
      hard: 0,
      weeklyProgress: 0
    }))
  };
}

describe("domain: weekly winners and archiving", () => {
  it("calculates correct Monday weekStart in UTC", () => {
    // 2026-11-11 is a Wednesday
    const wednesday = Date.parse("2026-11-11T14:00:00Z");
    assert.equal(weekStartOf(wednesday), "2026-11-09");
    assert.equal(lastWeekStart(wednesday), "2026-11-02");
    assert.equal(addDays("2026-11-09", 7), "2026-11-16");
  });

  it("determines weekly winner based on delta over the finished week", () => {
    // Target week: 2026-11-02 (Mon) to 2026-11-08 (Sun).
    // "Now" is in week 2026-11-09.
    const now = Date.parse("2026-11-11T12:00:00Z");

    const alice = makeUser("u1", "Alice", 100, [
      { date: "2026-11-01", solvedCount: 80 },
      { date: "2026-11-08", solvedCount: 95 } // gained 15
    ]);
    const bob = makeUser("u2", "Bob", 120, [
      { date: "2026-11-01", solvedCount: 90 },
      { date: "2026-11-08", solvedCount: 110 } // gained 20
    ]);

    const winners = computeWeeklyWinners([alice, bob], now, 1);
    assert.equal(winners.length, 1);
    assert.equal(winners[0].weekStart, "2026-11-02");
    assert.equal(winners[0].userId, "u2"); // Bob won
    assert.equal(winners[0].gained, 20);
  });

  it("breaks ties by allTimeSolved then alphabetically by displayName", () => {
    const now = Date.parse("2026-11-11T12:00:00Z");

    // Both gained 10, but Bob has higher allTimeSolved
    const alice = makeUser("u1", "Alice", 100, [
      { date: "2026-11-01", solvedCount: 90 },
      { date: "2026-11-08", solvedCount: 100 }
    ]);
    const bob = makeUser("u2", "Bob", 150, [
      { date: "2026-11-01", solvedCount: 140 },
      { date: "2026-11-08", solvedCount: 150 }
    ]);

    const winners1 = computeWeeklyWinners([alice, bob], now, 1);
    assert.equal(winners1[0].userId, "u2"); // Bob won on allTimeSolved tiebreak

    // If both gained 10 AND have equal allTimeSolved, Alice wins alphabetically
    const bobEqual = makeUser("u2", "Bob", 100, [
      { date: "2026-11-01", solvedCount: 90 },
      { date: "2026-11-08", solvedCount: 100 }
    ]);
    const winners2 = computeWeeklyWinners([alice, bobEqual], now, 1);
    assert.equal(winners2[0].userId, "u1"); // Alice won alphabetically
  });

  it("scores mid-week joiners from their joined baseline", () => {
    const now = Date.parse("2026-11-11T12:00:00Z");
    // Week: 2026-11-02 to 2026-11-08.
    // Charlie joined on 2026-11-04 with baseline 30, and reached 50 by Sunday 2026-11-08
    const charlie = makeUser(
      "u3",
      "Charlie",
      50,
      [{ date: "2026-11-08", solvedCount: 50 }],
      "2026-11-04",
      30
    );

    const winners = computeWeeklyWinners([charlie], now, 1);
    assert.equal(winners.length, 1);
    assert.equal(winners[0].userId, "u3");
    assert.equal(winners[0].gained, 20); // 50 - 30 = 20
  });

  it("yields no winner if nobody had positive progress", () => {
    const now = Date.parse("2026-11-11T12:00:00Z");
    const inactive = makeUser("u1", "Inactive", 50, [
      { date: "2026-11-01", solvedCount: 50 },
      { date: "2026-11-08", solvedCount: 50 }
    ]);
    const winners = computeWeeklyWinners([inactive], now, 1);
    assert.equal(winners.length, 0);
  });

  it("merges stored winner archive without overwriting historical records", () => {
    const stored: WeeklyWinner[] = [
      { weekStart: "2026-10-19", userId: "u1", gained: 15 },
      { weekStart: "2026-10-26", userId: "u2", gained: 18 }
    ];
    // Computed might have different data for 2026-10-26 due to trimmed snapshots, but stored must win
    const computed: WeeklyWinner[] = [
      { weekStart: "2026-10-26", userId: "u3", gained: 5 }, // Stored u2 should win
      { weekStart: "2026-11-02", userId: "u1", gained: 25 }  // New week
    ];

    const merged = mergeWinnerArchive(stored, computed);
    assert.equal(merged.length, 3);
    const wOct26 = merged.find((w) => w.weekStart === "2026-10-26");
    assert.equal(wOct26?.userId, "u2"); // stored record won
    assert.equal(wOct26?.gained, 18);
  });

  it("parses valid winner archive JSON and ignores malformed items", () => {
    const raw = JSON.stringify([
      { weekStart: "2026-11-02", userId: "u1", gained: 20 },
      { weekStart: "bad-date", userId: "u2", gained: 10 },
      null,
      { weekStart: "2026-11-09", userId: "u3" }, // missing gained
      "junk"
    ]);

    const parsed = parseWinnerArchive(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].userId, "u1");
  });

  it("tallies winners by count descending then lastWin date", () => {
    const winners: WeeklyWinner[] = [
      { weekStart: "2026-10-12", userId: "alice", gained: 10 },
      { weekStart: "2026-10-19", userId: "bob", gained: 12 },
      { weekStart: "2026-10-26", userId: "alice", gained: 15 },
      { weekStart: "2026-11-02", userId: "charlie", gained: 20 }
    ];

    const tally = tallyWinners(winners);
    assert.equal(tally[0].userId, "alice"); // 2 wins
    assert.equal(tally[0].wins, 2);
    assert.equal(tally[0].lastWin, "2026-10-26");

    // Bob and Charlie both have 1 win, but Charlie won more recently (2026-11-02 > 2026-10-19)
    assert.equal(tally[1].userId, "charlie");
    assert.equal(tally[2].userId, "bob");
  });
});
