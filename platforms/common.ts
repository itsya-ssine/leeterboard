// Shared by every extra-platform provider (Codeforces now, CodinGame later).

// What a provider returns for one account. Stored on its platform_accounts row.
export interface PlatformStats {
  solved: number;
  weekly: number; // solved this calendar week (Mon-Sun, UTC)
  monthly: number; // solved in the last 30 days
  rating: number | null; // null = unrated
  maxRating: number | null;
  rankTitle: string | null;
  contests?: number; // omit when the provider doesn't fetch it (the stored value is kept)
  avatarUrl: string | null;
  extra: Record<string, unknown>; // platform-specific, stored as JSON
}

// The platform positively says this handle doesn't exist (removed or renamed).
export class PlatformNotFoundError extends Error {
  constructor(platform: string, handle: string) {
    super(`${platform} user "${handle}" doesn't exist.`);
    this.name = "PlatformNotFoundError";
  }
}

// The platform didn't answer (timeout, rate limit, outage), so we know nothing
// about the account and must not guess.
export class PlatformUnavailableError extends Error {
  constructor(platform: string, detail: string) {
    super(`Couldn't reach ${platform} right now (${detail}).`);
    this.name = "PlatformUnavailableError";
  }
}

// What a provider can read from a public profile, used to prove a member owns
// the account they are linking.
export interface PlatformProfile {
  handle: string; // the platform's own spelling of the handle
  texts: string[]; // profile fields a member can edit (name, organization, ...); the proof code is searched here
}
