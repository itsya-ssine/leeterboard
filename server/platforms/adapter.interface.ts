import type { PlatformProfile, PlatformStats } from "../../platforms/common.js";
import type { PlatformId } from "../../shared/types.js";

export type SupportedPlatformId = PlatformId | "leetcode";

export interface PlatformAdapter {
  id: SupportedPlatformId;
  name: string;
  handlePattern: RegExp;
  proofHelp: string;
  fetchProfile?: (handle: string) => Promise<PlatformProfile>;
  fetchStats?: (handle: string) => Promise<PlatformStats>;
}
