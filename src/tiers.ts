// Contest-rating tiers (Codeforces-style names, thresholds scaled to
// LeetCode's contest range: most members sit between 1400 and 2000). Colours
// come from CSS variables in index.css so they follow the light / dark theme.
// The leaderboard's rating colours and the avatar frames share this one list.

export interface RatingTier {
  min: number;
  name: string;
  color: string;
  // 0 (Newbie) to 6 (Grandmaster): how elaborate the avatar frame is.
  level: number;
}

// Highest first, so `find` returns the best tier a rating reaches.
export const RATING_TIERS: readonly RatingTier[] = [
  { min: 2150, name: "Grandmaster", color: "var(--tier-gm)", level: 6 },
  { min: 2000, name: "Master", color: "var(--tier-master)", level: 5 },
  { min: 1850, name: "Candidate", color: "var(--tier-cm)", level: 4 },
  { min: 1700, name: "Expert", color: "var(--tier-expert)", level: 3 },
  { min: 1550, name: "Specialist", color: "var(--tier-specialist)", level: 2 },
  { min: 1400, name: "Pupil", color: "var(--tier-pupil)", level: 1 },
  { min: 0, name: "Newbie", color: "var(--tier-newbie)", level: 0 }
];

export const ratingTier = (rating: number): RatingTier =>
  RATING_TIERS.find((t) => rating >= t.min) ?? RATING_TIERS[RATING_TIERS.length - 1];

// null = unrated (never entered a contest, or the rating hasn't been fetched).
export const tierOf = (user: { contestRating: number | null }): RatingTier | null =>
  user.contestRating == null ? null : ratingTier(user.contestRating);

// "Expert · rated 1,720 · next: Candidate at 1,850", for tooltips.
export function tierSummary(user: { contestRating: number | null }): string {
  const tier = tierOf(user);
  if (!tier || user.contestRating == null) return "Unrated: enter a LeetCode contest to earn a tier frame";
  const next = [...RATING_TIERS].reverse().find((t) => t.min > tier.min);
  return `${tier.name} · rated ${user.contestRating.toLocaleString()}${
    next ? ` · next: ${next.name} at ${next.min.toLocaleString()}` : " · top tier"
  }`;
}

const byName = (name: string) => RATING_TIERS.find((t) => t.name === name)!;

// Codeforces rank titles share the colours (and frames) of the rating tiers
// above; the higher international / legendary titles use their parent colour.
const CODEFORCES_TIERS: Record<string, string> = {
  newbie: "Newbie",
  pupil: "Pupil",
  specialist: "Specialist",
  expert: "Expert",
  "candidate master": "Candidate",
  master: "Master",
  "international master": "Master",
  grandmaster: "Grandmaster",
  "international grandmaster": "Grandmaster",
  "legendary grandmaster": "Grandmaster"
};

// null = unrated, or a title we don't know.
export function codeforcesTier(rankTitle: string | null | undefined): RatingTier | null {
  if (!rankTitle) return null;
  const tier = CODEFORCES_TIERS[rankTitle.toLowerCase()];
  return tier ? { ...byName(tier), name: rankTitle.replace(/\b\w/g, (c) => c.toUpperCase()) } : null;
}

// CodinGame has plain levels, so a frame steps up every ten of them.
const CODINGAME_STEPS = [
  { min: 60, tier: "Grandmaster" },
  { min: 50, tier: "Master" },
  { min: 40, tier: "Candidate" },
  { min: 30, tier: "Expert" },
  { min: 20, tier: "Specialist" },
  { min: 10, tier: "Pupil" },
  { min: 1, tier: "Newbie" }
] as const;

export function codingameTier(level: number | null | undefined): RatingTier | null {
  if (level == null) return null;
  const step = CODINGAME_STEPS.find((s) => level >= s.min);
  return step ? { ...byName(step.tier), name: `Level ${step.min}+` } : null;
}
