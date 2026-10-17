/**
 * DEVELOPMENT ONLY — adds two fake members to the local database so the board,
 * hall of fame, badges, compare page and sync-health page have something to
 * show without signing up through LeetCode verification.
 *
 *   npx tsx scripts/seed-dev-users.ts            add them (skips any that exist)
 *   npx tsx scripts/seed-dev-users.ts --reset    delete and re-create them
 *
 * It only ever writes to a local SQLite file (the default local.db). It refuses
 * to run if TURSO_DATABASE_URL points anywhere else, or if NODE_ENV=production
 * or VERCEL is set, so a real database can't be filled with fake members by
 * accident. Delete this file when you no longer need it.
 */
import "dotenv/config";
import crypto from "crypto";
import type { HistoryRecord, User } from "../src/types.js";

const PASSWORD = "dev-password-123";
const HISTORY_DAYS = 60; // matches how much history the app keeps
const DAY_MS = 24 * 60 * 60 * 1000;

// Deliberately unlikely names: the app's sync would overwrite these members'
// stats if a real LeetCode account ever had the same username.
interface Seed {
  displayName: string;
  leetcodeUsername: string;
  startTotal: number; // problems solved 60 days ago
  solvesPerDay: (daysAgo: number, rand: () => number) => number;
  contestRating: number | null;
  contestsAttended: number;
  currentStreak: number | null;
  longestStreak: number | null;
  color: string; // avatar background
}

const SEEDS: Seed[] = [
  {
    // Steady: a couple of problems a day, a bit less at weekends.
    displayName: "Dev Alice",
    leetcodeUsername: "lb_dev_alice_x7q",
    startTotal: 420,
    solvesPerDay: (_d, rand) => (rand() < 0.15 ? 0 : 1 + Math.floor(rand() * 3)),
    contestRating: 1862,
    contestsAttended: 9,
    currentStreak: 9,
    longestStreak: 21,
    color: "#0f766e"
  },
  {
    // Slow start, then a burst over the last three weeks — a good "most
    // improved" and a good chart to compare against Alice.
    displayName: "Dev Bob",
    leetcodeUsername: "lb_dev_bob_x7q",
    startTotal: 140,
    solvesPerDay: (d, rand) => (d > 21 ? (rand() < 0.6 ? 0 : 1) : 2 + Math.floor(rand() * 4)),
    contestRating: null,
    contestsAttended: 0,
    currentStreak: 3,
    longestStreak: 8,
    color: "#b45309"
  }
];

// Small deterministic generator, so every run (and every machine) produces the
// same fake history for the same member.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hashString = (s: string) => [...s].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7);

// A tiny inline SVG with the member's initials, so no network is needed.
function avatarFor(name: string, color: string): string {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
    `<rect width="128" height="128" fill="${color}"/>` +
    `<text x="64" y="64" dy=".35em" text-anchor="middle" font-family="sans-serif" font-size="52" fill="#fff">${initials}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function buildUser(seed: Seed, nowMs: number): User {
  const rand = mulberry32(hashString(seed.leetcodeUsername));

  const totals: { date: string; total: number }[] = [];
  let total = seed.startTotal;
  for (let d = HISTORY_DAYS - 1; d >= 0; d--) {
    total += seed.solvesPerDay(d, rand);
    totals.push({ date: new Date(nowMs - d * DAY_MS).toISOString().slice(0, 10), total });
  }

  const split = (n: number) => {
    const easy = Math.round(n * 0.45);
    const hard = Math.round(n * 0.1);
    return { easy, medium: n - easy - hard, hard };
  };
  const totalAgo = (daysAgo: number) => totals[Math.max(0, totals.length - 1 - daysAgo)].total;

  const history: HistoryRecord[] = totals.map(({ date, total: n }, i) => ({
    date,
    solvedCount: n,
    ...split(n),
    weeklyProgress: n - totals[Math.max(0, i - 7)].total
  }));

  const now = totals[totals.length - 1].total;
  const { easy, medium, hard } = split(now);
  return {
    id: `user-${crypto.randomUUID()}`,
    displayName: seed.displayName,
    leetcodeUsername: seed.leetcodeUsername,
    avatarUrl: avatarFor(seed.displayName, seed.color),
    allTimeSolved: now,
    easySolved: easy,
    mediumSolved: medium,
    hardSolved: hard,
    weeklyProgress: now - totalAgo(7),
    monthlyProgress: now - totalAgo(30),
    rank: 0,
    contestRating: seed.contestRating,
    contestsAttended: seed.contestsAttended,
    currentStreak: seed.currentStreak,
    longestStreak: seed.longestStreak,
    lastUpdated: new Date(nowMs).toISOString(),
    trackingStart: totals[0].date,
    baselineSolved: seed.startTotal,
    history
  };
}

async function main() {
  const reset = process.argv.includes("--reset");

  // ---- Safety: only ever touch a local development database ----
  const url = process.env.TURSO_DATABASE_URL || "file:local.db";
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    console.error("Refusing to run: this looks like a production environment.");
    process.exitCode = 1;
    return;
  }
  if (!url.startsWith("file:")) {
    console.error(
      `Refusing to run: TURSO_DATABASE_URL points at a remote database (${url.split("?")[0]}).\n` +
        "This script only writes to a local SQLite file. Unset TURSO_DATABASE_URL (or point it at a file: URL) and try again."
    );
    process.exitCode = 1;
    return;
  }

  // Imported only now, so a refused run never opens the database. auth.ts needs
  // JWT_SECRET, the same variable `npm run dev` needs.
  const db = await import("../db.js");
  let hashPassword: (password: string) => Promise<string>;
  try {
    ({ hashPassword } = await import("../auth.js"));
  } catch (err: any) {
    console.error(`${err.message}\n(The dev server needs this too — put it in your .env file.)`);
    process.exitCode = 1;
    return;
  }

  await db.initDb();
  const passwordHash = await hashPassword(PASSWORD);
  const nowMs = Date.now();

  console.log(`Database: ${url}`);
  for (const seed of SEEDS) {
    const existing = await db.getUserAuthByUsername(seed.leetcodeUsername);
    if (existing && !reset) {
      console.log(`  skipped  ${seed.displayName} (@${seed.leetcodeUsername}) — already exists (use --reset to re-create)`);
      continue;
    }
    if (existing) await db.deleteUserById(existing.user.id);

    const user = buildUser(seed, nowMs);
    await db.insertUser(user, passwordHash);
    await db.recordSyncResult(user.id, { ok: true });
    console.log(`  ${existing ? "re-created" : "added"}    ${seed.displayName} (@${seed.leetcodeUsername}) — ${user.allTimeSolved} solved`);
  }

  console.log(`
Log in with either username and the password: ${PASSWORD}

Notes
  - These aren't real LeetCode accounts. Syncing can't find them, so the Sync
    health page will list them as "Account not found" — their seeded stats are
    left untouched.
  - To try the admin page, add lb_dev_alice_x7q to ADMIN_LEETCODE_USERNAMES in
    your .env and restart the dev server.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
