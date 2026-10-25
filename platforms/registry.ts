import type { PlatformId } from "../src/types.js";
import type { PlatformProfile } from "./common.js";
import { fetchCodeforcesProfile } from "./codeforces.js";

// What the link / unlink routes need to know about each extra platform.
export interface PlatformInfo {
  id: PlatformId;
  label: string;
  // Allow-list for a handle. It keeps the value safe to put in a third-party
  // URL; the platform itself decides whether the account really exists.
  handlePattern: RegExp;
  // Reads the public profile for the ownership check. undefined = this
  // platform can't be linked yet.
  fetchProfile?: (handle: string) => Promise<PlatformProfile>;
  // Where the member puts the proof code. Shown to them by the UI.
  proofHelp: string;
}

export const PLATFORMS: Record<PlatformId, PlatformInfo> = {
  codeforces: {
    id: "codeforces",
    label: "Codeforces",
    handlePattern: /^[A-Za-z0-9_.-]{1,50}$/,
    fetchProfile: fetchCodeforcesProfile,
    proofHelp:
      "On Codeforces open Settings > Social, paste the code into the Organization field and save. Then press Verify. You can remove the code afterwards."
  },
  codingame: {
    id: "codingame",
    label: "CodinGame",
    handlePattern: /^[A-Za-z0-9]{1,64}$/,
    fetchProfile: undefined, // not supported yet
    proofHelp: ""
  }
};

export function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PLATFORMS, value);
}
