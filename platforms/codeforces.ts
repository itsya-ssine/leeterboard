import { PlatformNotFoundError, PlatformUnavailableError, type PlatformProfile, type PlatformStats } from "./common.js";

// Codeforces public API (https://codeforces.com/apiHelp). No key needed for
// these methods. Codeforces allows about one request every two seconds, so every
// call goes through a shared throttle.

const API = "https://codeforces.com/api";
const NAME = "Codeforces";
const MIN_GAP_MS = 2100;

// Contest ids from 100000 up are "gym" contests (private/team training sets),
// which the Codeforces profile does not count as solved problems.
const GYM_MIN_CONTEST_ID = 100_000;

// Difficulty buckets by problem rating, so the Stats page can keep an
// Easy / Medium / Hard style chart. Problems without a rating go in "unrated".
export const EASY_BELOW = 1200;
export const MEDIUM_BELOW = 1700;

const DAY_SECONDS = 86_400;

/* ---------- Throttle ---------- */

// Each caller reserves the next free slot, so concurrent callers queue up
// instead of all firing together. (Per server instance: on serverless, separate
// instances don't share it, which is why a retry on "limit exceeded" exists.)
let nextSlot = 0;
async function throttle(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

async function call(method: string, params: Record<string, string>, handle: string, timeoutMs: number, attempt = 0): Promise<any> {
  await throttle();

  let res: Response;
  try {
    res = await fetch(`${API}/${method}?${new URLSearchParams(params)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err: any) {
    throw new PlatformUnavailableError(NAME, err?.name === "TimeoutError" ? "timed out" : String(err?.message ?? err));
  }

  // Failures come back as HTTP 400 with {status:"FAILED", comment:"..."}; an
  // outage can return an HTML page, which is why the JSON parse is guarded.
  const body: any = await res.json().catch(() => null);
  if (body?.status === "OK") return body.result;

  const comment = typeof body?.comment === "string" ? body.comment : "";
  if (/not found/i.test(comment)) throw new PlatformNotFoundError(NAME, handle);
  if (attempt === 0 && (res.status === 429 || /limit exceeded/i.test(comment))) {
    return call(method, params, handle, timeoutMs, attempt + 1);
  }
  throw new PlatformUnavailableError(NAME, comment || `HTTP ${res.status}`);
}

/* ---------- Pure maths (no I/O, so it can be unit-tested) ---------- */

export interface CodeforcesSubmission {
  verdict?: string;
  creationTimeSeconds: number;
  contestId?: number;
  problem: { contestId?: number; index: string; problemsetName?: string; rating?: number };
}

// Unix seconds of the most recent Monday 00:00 UTC (same week rule as LeetCode).
export function startOfUtcWeekSeconds(nowMs: number = Date.now()): number {
  const d = new Date(nowMs);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday) / 1000;
}

// Counts distinct problems solved. A problem counts once, on the day of its
// FIRST accepted submission, so re-submitting an old solution never adds to
// this week.
export function summarizeSubmissions(subs: CodeforcesSubmission[], nowMs: number = Date.now()) {
  const firstSolved = new Map<string, { t: number; rating?: number }>();
  for (const s of subs) {
    if (s.verdict !== "OK") continue;
    const contestId = s.problem.contestId ?? s.contestId;
    if (contestId !== undefined && contestId >= GYM_MIN_CONTEST_ID) continue;
    const key = `${contestId ?? s.problem.problemsetName ?? "?"}-${s.problem.index}`;
    const prev = firstSolved.get(key);
    if (!prev || s.creationTimeSeconds < prev.t) {
      firstSolved.set(key, { t: s.creationTimeSeconds, rating: s.problem.rating });
    }
  }

  const weekStart = startOfUtcWeekSeconds(nowMs);
  const monthStart = nowMs / 1000 - 30 * DAY_SECONDS;
  const buckets = { easy: 0, medium: 0, hard: 0, unrated: 0 };
  let weekly = 0;
  let monthly = 0;
  for (const p of firstSolved.values()) {
    if (p.t >= weekStart) weekly++;
    if (p.t >= monthStart) monthly++;
    if (typeof p.rating !== "number") buckets.unrated++;
    else if (p.rating < EASY_BELOW) buckets.easy++;
    else if (p.rating < MEDIUM_BELOW) buckets.medium++;
    else buckets.hard++;
  }
  return { solved: firstSolved.size, weekly, monthly, buckets };
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Codeforces sometimes returns protocol-relative image URLs ("//userpic...").
function normalizeUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  return v.startsWith("//") ? `https:${v}` : v;
}

/* ---------- Public ---------- */

// Throws PlatformNotFoundError / PlatformUnavailableError; never invents numbers.
export async function fetchCodeforcesStats(handle: string): Promise<PlatformStats> {
  // user.info first: it is cheap, and a wrong handle fails here before the
  // heavy submissions download.
  const [info] = await call("user.info", { handles: handle }, handle, 8000);
  if (!info) throw new PlatformNotFoundError(NAME, handle);

  // Every submission the user ever made (can be several MB for heavy users).
  const subs: CodeforcesSubmission[] = await call("user.status", { handle }, handle, 20000);
  const s = summarizeSubmissions(subs);

  return {
    solved: s.solved,
    weekly: s.weekly,
    monthly: s.monthly,
    rating: finiteOrNull(info.rating),
    maxRating: finiteOrNull(info.maxRating),
    rankTitle: typeof info.rank === "string" ? info.rank : null,
    avatarUrl: normalizeUrl(info.titlePhoto) ?? normalizeUrl(info.avatar),
    extra: { buckets: s.buckets }
  };
}

// Public profile, for proving ownership when linking. Codeforces has no "about
// me" box, so the member temporarily puts a code in a field they can edit
// (Settings > Social: Organization, name, city) and we read it back here.
export async function fetchCodeforcesProfile(handle: string): Promise<PlatformProfile> {
  const [info] = await call("user.info", { handles: handle }, handle, 8000);
  if (!info || typeof info.handle !== "string") throw new PlatformNotFoundError(NAME, handle);
  const texts = ["organization", "firstName", "lastName", "city", "country"]
    .map((k) => info[k])
    .filter((v): v is string => typeof v === "string");
  return { handle: info.handle, texts };
}
