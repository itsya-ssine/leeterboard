// Preloaded into the TEST server process only (NODE_OPTIONS=--import <this file>).
//
// Answers the LeetCode calls (POST https://leetcode.com/graphql) from files in
// $FAKE_LEETCODE_DIR, so tests can prove "the person really did put the code in
// their LeetCode summary", and link an account, without touching the network:
//
//   <dir>/<username lower-cased>.txt  -> the user exists, summary = file content
//   <dir>/<username lower-cased>.stats.json (optional)
//                                     -> {"all","easy","medium","hard"} solved
//                                        counts (default 42 / 20 / 15 / 7)
//   no .txt file                      -> LeetCode says the user doesn't exist
//
// Which question is being asked is told apart by its query text: the profile
// summary (default), solved counts, contest rating (always "never entered") and
// the submission calendar (always empty).
//
// The profile lookups behind "link / recover with Codeforces or CodinGame" are
// faked the same way, from files in $FAKE_PLATFORM_DIR:
//
//   <dir>/codeforces/<handle lower-cased>.txt  -> the handle exists, its
//                                                 "organization" = file content
//   <dir>/codingame/<handle lower-cased>.txt   -> the handle exists, its
//                                                 "tagline" = file content
//   no such file                               -> the platform says "not found"
//
// An existing handle also has fixed stats, so a first sync after linking works:
// Codeforces: rating 1250 (max 1300, "pupil"), 2 rated contests and 3 solved
// problems rated 800 / 1300 / 1900. CodinGame: 5000 XP, level 12, rank 345.
//
// Every other request goes to the real fetch.
import fs from "node:fs";
import path from "node:path";

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : (input?.url ?? String(input));
  if (url === "https://leetcode.com/graphql" && process.env.FAKE_LEETCODE_DIR) {
    const { variables } = JSON.parse(String(init?.body ?? "{}"));
    const name = String(variables?.username ?? "");
    const file = path.join(process.env.FAKE_LEETCODE_DIR, `${name.toLowerCase()}.txt`);
    const exists = fs.existsSync(file);
    const query = String(JSON.parse(String(init?.body ?? "{}")).query ?? "");
    const reply = (data) =>
      new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });

    if (query.includes("submitStatsGlobal")) {
      const statsFile = path.join(process.env.FAKE_LEETCODE_DIR, `${name.toLowerCase()}.stats.json`);
      const s = fs.existsSync(statsFile)
        ? JSON.parse(fs.readFileSync(statsFile, "utf8"))
        : { all: 42, easy: 20, medium: 15, hard: 7 };
      return reply({
        matchedUser: exists
          ? {
              profile: { userAvatar: "https://assets.leetcode.com/users/fake/avatar.png" },
              submitStatsGlobal: {
                acSubmissionNum: [
                  { difficulty: "All", count: s.all },
                  { difficulty: "Easy", count: s.easy },
                  { difficulty: "Medium", count: s.medium },
                  { difficulty: "Hard", count: s.hard }
                ]
              }
            }
          : null
      });
    }
    if (query.includes("userContestRanking")) return reply({ userContestRanking: null });
    if (query.includes("userProfileCalendar")) {
      return reply({
        matchedUser: exists ? { userCalendar: { activeYears: [], streak: 0, submissionCalendar: "{}" } } : null
      });
    }
    const matchedUser = exists ? { username: name, profile: { aboutMe: fs.readFileSync(file, "utf8") } } : null;
    return reply({ matchedUser });
  }
  const platformDir = process.env.FAKE_PLATFORM_DIR;
  if (platformDir && url.startsWith("https://codeforces.com/api/user.info?")) {
    const handle = new URL(url).searchParams.get("handles") ?? "";
    const file = path.join(platformDir, "codeforces", `${handle.toLowerCase()}.txt`);
    if (!fs.existsSync(file)) {
      return new Response(JSON.stringify({ status: "FAILED", comment: `handles: User with handle ${handle} not found` }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(
      JSON.stringify({
        status: "OK",
        result: [
          {
            handle,
            organization: fs.readFileSync(file, "utf8"),
            rating: 1250,
            maxRating: 1300,
            rank: "pupil"
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  if (platformDir && (url.startsWith("https://codeforces.com/api/user.rating?") || url.startsWith("https://codeforces.com/api/user.status?"))) {
    const method = url.includes("user.rating?") ? "rating" : "status";
    const handle = new URL(url).searchParams.get("handle") ?? "";
    const exists = fs.existsSync(path.join(platformDir, "codeforces", `${handle.toLowerCase()}.txt`));
    const ok = (result) =>
      new Response(JSON.stringify({ status: "OK", result }), { status: 200, headers: { "content-type": "application/json" } });
    if (!exists) {
      return new Response(JSON.stringify({ status: "FAILED", comment: `handle: User with handle ${handle} not found` }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }
    if (method === "rating") return ok([{ contestId: 1 }, { contestId: 2 }]);
    const now = Math.floor(Date.now() / 1000);
    return ok(
      [800, 1300, 1900].map((rating, i) => ({
        contestId: 1001 + i,
        creationTimeSeconds: now - 3600 * (i + 1),
        verdict: "OK",
        problem: { contestId: 1001 + i, index: "A", rating }
      }))
    );
  }
  if (platformDir && url === "https://www.codingame.com/services/CodinGamer/findCodingamePointsStatsByHandle") {
    const [handle] = JSON.parse(String(init?.body ?? "[]"));
    const file = path.join(platformDir, "codingame", `${String(handle).toLowerCase()}.txt`);
    if (!fs.existsSync(file)) return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    return new Response(
      JSON.stringify({
        codingamer: { publicHandle: String(handle), tagline: fs.readFileSync(file, "utf8") },
        xp: 5000,
        level: 12,
        rank: 345
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  return realFetch(input, init);
};
