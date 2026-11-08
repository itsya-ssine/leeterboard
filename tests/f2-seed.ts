import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Shared by the F2 (account recovery / admin identity) tests.

export function makeUser(username: string, over: Record<string, unknown> = {}) {
  return {
    id: `user-${crypto.randomUUID()}`,
    displayName: username,
    leetcodeUsername: username,
    avatarUrl: "",
    school: "",
    bio: "",
    githubUrl: "",
    linkedinUrl: "",
    websiteUrl: "",
    allTimeSolved: 100,
    easySolved: 50,
    mediumSolved: 40,
    hardSolved: 10,
    weeklyProgress: 5,
    monthlyProgress: 20,
    rank: 0,
    contestRating: null,
    contestsAttended: 0,
    currentStreak: null,
    longestStreak: null,
    lastUpdated: new Date().toISOString(),
    trackingStart: "2026-01-05",
    baselineSolved: 90,
    history: [],
    ...over
  } as any;
}

// A throwaway directory standing in for "LeetCode profiles" (see fake-leetcode.mjs).
export function makeFakeLeetCode() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-fake-lc-"));
  const platformDir = path.join(dir, "platforms");
  return {
    dir,
    // Makes `username` exist on "LeetCode" with this summary text.
    setAbout(username: string, about: string) {
      fs.writeFileSync(path.join(dir, `${username.toLowerCase()}.txt`), about);
    },
    // Makes `username` stop existing on "LeetCode" (renamed or deleted).
    removeAbout(username: string) {
      fs.rmSync(path.join(dir, `${username.toLowerCase()}.txt`), { force: true });
    },
    // The same for Codeforces / CodinGame: `text` is the profile field the
    // proof code is searched in (Codeforces "organization", CodinGame "tagline").
    setPlatformProfile(platform: "codeforces" | "codingame", handle: string, text: string) {
      fs.mkdirSync(path.join(platformDir, platform), { recursive: true });
      fs.writeFileSync(path.join(platformDir, platform, `${handle.toLowerCase()}.txt`), text);
    },
    removePlatformProfile(platform: "codeforces" | "codingame", handle: string) {
      fs.rmSync(path.join(platformDir, platform, `${handle.toLowerCase()}.txt`), { force: true });
    },
    // Env for startServer(): preloads the fake into the server process.
    env: {
      FAKE_LEETCODE_DIR: dir,
      FAKE_PLATFORM_DIR: platformDir,
      NODE_OPTIONS: `--import ${pathToFileURL(path.resolve(import.meta.dirname, "fake-leetcode.mjs")).href}`
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
  };
}
