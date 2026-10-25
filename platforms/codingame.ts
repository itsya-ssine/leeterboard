import { PlatformNotFoundError, PlatformUnavailableError, type PlatformProfile, type PlatformStats } from "./common.js";

// CodinGame has no official public API. This uses the same JSON-RPC style
// endpoints the website itself calls (POST a JSON array of arguments), which
// can change without notice. Everything that reads a response field is in
// parseStats / parseProfile below, so a change on their side is a one-place fix.
//
// The "handle" is the long hex id in the profile URL:
//   https://www.codingame.com/profile/<handle>

const API = "https://www.codingame.com/services";
const NAME = "CodinGame";
const MIN_GAP_MS = 1000;

/* ---------- Throttle (same idea as Codeforces, gentler gap) ---------- */

let nextSlot = 0;
async function throttle(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

async function call(service: string, method: string, args: unknown[], handle: string, timeoutMs = 8000): Promise<any> {
  await throttle();

  let res: Response;
  try {
    res = await fetch(`${API}/${service}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8", Accept: "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err: any) {
    throw new PlatformUnavailableError(NAME, err?.name === "TimeoutError" ? "timed out" : String(err?.message ?? err));
  }

  // An unknown handle comes back as an error status or an empty body. Rate
  // limits and outages are NOT "not found": we know nothing in those cases.
  if (res.status === 400 || res.status === 404 || res.status === 422) throw new PlatformNotFoundError(NAME, handle);
  if (!res.ok) throw new PlatformUnavailableError(NAME, `HTTP ${res.status}`);

  const body: any = await res.json().catch(() => null);
  if (body === null || typeof body !== "object") throw new PlatformNotFoundError(NAME, handle);
  return body;
}

/* ---------- Response parsing (the only place that knows field names) ---------- */

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// CodinGamer/findCodingamePointsStatsByHandle -> { codingamer: {...}, xp, level, rank, ... }
export function parseStats(body: any) {
  const c = body?.codingamer ?? {};
  const xp = finiteOrNull(body?.xp) ?? finiteOrNull(c.xp) ?? 0;
  const level = finiteOrNull(body?.level) ?? finiteOrNull(c.level);
  const rank = finiteOrNull(body?.rank) ?? finiteOrNull(body?.codingamePointsRankingDto?.rank);
  return { xp, level, rank };
}

// Every short text field of the public profile (tagline, biography, company,
// school, city, ...). The proof code is searched in all of them, so it works in
// whichever editable field the member pastes it into.
export function parseProfile(body: any, requestedHandle: string): PlatformProfile {
  const c = body?.codingamer;
  if (!c || typeof c !== "object") throw new PlatformNotFoundError(NAME, requestedHandle);
  const texts = Object.values(c).filter((v): v is string => typeof v === "string" && v.length <= 2000);
  const handle = typeof c.publicHandle === "string" && c.publicHandle ? c.publicHandle : requestedHandle;
  return { handle, texts };
}

/* ---------- Public ---------- */

// "solved" holds the member's total XP and "rating" their level: CodinGame has
// no single reliable "problems solved" number, but XP only ever grows, so the
// weekly figure (computed from platform_history snapshots by platformSync) is
// exactly the XP earned this week. weekly / monthly are returned as 0 here.
export async function fetchCodingameStats(handle: string): Promise<PlatformStats> {
  const body = await call("CodinGamer", "findCodingamePointsStatsByHandle", [handle], handle);
  const { xp, level, rank } = parseStats(body);
  return {
    solved: xp,
    weekly: 0,
    monthly: 0,
    rating: level,
    maxRating: null,
    rankTitle: level != null ? `Level ${level}` : null,
    avatarUrl: null,
    extra: { rank }
  };
}

export async function fetchCodingameProfile(handle: string): Promise<PlatformProfile> {
  const body = await call("CodinGamer", "findCodingamePointsStatsByHandle", [handle], handle);
  return parseProfile(body, handle);
}
