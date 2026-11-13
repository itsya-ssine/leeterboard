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
    // The solved counts LeetCode reports for `username` (default 42 / 20 / 15 / 7).
    setStats(username: string, stats: { all: number; easy: number; medium: number; hard: number }) {
      fs.writeFileSync(path.join(dir, `${username.toLowerCase()}.stats.json`), JSON.stringify(stats));
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

// startServer() takes one env object, and NODE_OPTIONS can only be set once, so
// two fakes (LeetCode and OAuth) join their --import flags here.
export function mergeEnv(...envs: Record<string, string>[]): Record<string, string> {
  const merged: Record<string, string> = Object.assign({}, ...envs);
  const options = envs.map((e) => e.NODE_OPTIONS).filter(Boolean);
  if (options.length > 0) merged.NODE_OPTIONS = options.join(" ");
  return merged;
}

// A throwaway folder standing in for "GitHub and Google" (see fake-oauth.mjs). The
// server under test runs in production mode with the real oauthProviders.ts; this
// fake answers its HTTPS calls. A test approves a sign-in by issuing a code, then
// calls the server's /callback with it.
export interface FakeOAuthProfile {
  /** The provider's stable user id (GitHub's numeric id, Google's "sub"). */
  id: string | number;
  email: string;
  name?: string;
  /** GitHub only. Defaults to "user<id>". */
  login?: string;
}

export interface FakeOAuthOptions {
  unverified?: boolean; // the address is not verified
  noPrimary?: boolean; // GitHub: only a verified non-primary address
  badToken?: boolean; // the token endpoint refuses the code
  down?: boolean; // the token endpoint answers 500
  slow?: boolean; // the token endpoint never answers
  challenge?: string; // PKCE challenge to check the verifier against
}

export function makeFakeOAuth() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-fake-oauth-"));
  fs.mkdirSync(path.join(dir, "codes"));
  return {
    dir,
    // The member "approves" at the provider: returns the authorization code the
    // provider would redirect back with. Single use, like the real thing.
    issueCode(provider: "github" | "google", profile: FakeOAuthProfile, options: FakeOAuthOptions = {}): string {
      const code = `code${crypto.randomBytes(8).toString("hex")}`;
      fs.writeFileSync(path.join(dir, "codes", `${provider}-${code}.json`), JSON.stringify({ profile, options }));
      return code;
    },
    // Every provider call the server made so far, oldest first ("github token", "github user", ...).
    calls: (): string[] => {
      const file = path.join(dir, "calls.log");
      return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
    },
    // Env for startServer(): real provider code, fake network. Join with another
    // fake through mergeEnv() when a test needs both.
    env: {
      FAKE_OAUTH_DIR: dir,
      NODE_OPTIONS: `--import ${pathToFileURL(path.resolve(import.meta.dirname, "fake-oauth.mjs")).href}`
    } as Record<string, string>,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
  };
}

// The variables that switch sign-in with Google and GitHub on for a server under
// test (join with makeFakeOAuth().env through mergeEnv()).
export const OAUTH_TEST_ENV: Record<string, string> = {
  PUBLIC_URL: "https://leeterboard.test",
  GITHUB_CLIENT_ID: "gh-id",
  GITHUB_CLIENT_SECRET: "gh-secret-VALUE",
  GOOGLE_CLIENT_ID: "g-id",
  GOOGLE_CLIENT_SECRET: "g-secret-VALUE",
  OAUTH_DEV_PROVIDER_URL: ""
};
