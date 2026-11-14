import crypto from "crypto";
import { Router } from "express";
import { accountLimiter, verifyLimiter } from "../../middleware/rateLimit.js";
import { requireAuth } from "../../middleware/auth.js";
import { logSecurityEvent } from "../../utils/logger.js";
import {
  bumpPendingLinkAttempts,
  consumePendingLink,
  createPendingLink,
  deletePendingLink,
  findLeetcodeOwner,
  findPlatformAccountOwner,
  getPendingLink,
  getPlatformAccounts,
  getUserById,
  insertPlatformAccount,
  leetcodeLinkedUsers,
  linkLeetcodeAccount,
  listUsers,
  purgeExpiredPendingLinks,
  removePlatformAccount,
  setPlatformHidden,
  unlinkLeetcodeAccount
} from "../../../db.js";
import { isAdminUser, SESSION_REQUIRED_BODY } from "../../../auth.js";
import { isPlatformId, PLATFORMS, type PlatformInfo } from "../../../platforms/registry.js";
import { PlatformNotFoundError } from "../../../platforms/common.js";
import { syncPlatformAccount } from "../../../platformSync.js";
import { baselineNewMember } from "../../../notifications.js";
import {
  fetchContestRating,
  fetchLeetCodeAbout,
  fetchStreaks,
  scrapeLeetCodeProfile
} from "../../platforms/leetcode/scraper.js";
import { LeetCodeUserNotFoundError } from "../../platforms/leetcode/errors.js";

const router = Router();

const LINK_TTL_MS = 30 * 60 * 1000;
const MAX_LINK_ATTEMPTS = 10;
const LEETCODE_PROOF_HELP =
  "On LeetCode open your profile, click Edit Profile, paste the code into the Summary field and save. Then press Verify. You can remove the code afterward.";
const LEETCODE_UNAVAILABLE_MESSAGE =
  "Couldn't reach LeetCode right now. Please try again in a moment.";

const LEETCODE_USERNAME_RE = /^[A-Za-z0-9_.-]{1,50}$/;
function parseLeetCodeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return LEETCODE_USERNAME_RE.test(v) ? v : null;
}

function resolveLinkPlatform(value: unknown, res: any): PlatformInfo | null {
  if (!isPlatformId(value)) {
    res.status(404).json({ error: "Unknown platform." });
    return null;
  }
  const platform = PLATFORMS[value];
  if (!platform.fetchProfile) {
    res.status(400).json({ error: `Linking ${platform.label} isn't available yet.` });
    return null;
  }
  return platform;
}

async function userJson(id: string) {
  const user = await getUserById(id);
  return user ? { ...user, isAdmin: isAdminUser(user) } : null;
}

router.post("/account/platforms/:platform/start", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = req.user!;
    const platform = resolveLinkPlatform(req.params.platform, res);
    if (!platform) return;

    const raw = req.body?.handle;
    const handle = typeof raw === "string" ? raw.trim() : "";
    if (!platform.handlePattern.test(handle)) {
      return res.status(400).json({
        error: `Enter a valid ${platform.label} handle (letters, numbers, dots, dashes and underscores).`
      });
    }

    if ((await getPlatformAccounts(id))[platform.id]) {
      return res.status(409).json({
        error: `You've already linked a ${platform.label} account. Remove it first to link a different one.`
      });
    }
    if (await findPlatformAccountOwner(platform.id, handle)) {
      return res.status(409).json({ error: `That ${platform.label} account is already linked to a member.` });
    }

    let profile;
    try {
      profile = await platform.fetchProfile!(handle);
    } catch (err: any) {
      if (err instanceof PlatformNotFoundError) return res.status(404).json({ error: err.message });
      return res.status(503).json({ error: err.message });
    }

    const code = `leeterboard-${crypto.randomBytes(6).toString("hex")}`;
    await purgeExpiredPendingLinks(new Date().toISOString());
    await createPendingLink({
      userId: id,
      platform: platform.id,
      handle: profile.handle,
      code,
      expiresAt: new Date(Date.now() + LINK_TTL_MS).toISOString()
    });

    res.json({
      code,
      platform: platform.id,
      handle: profile.handle,
      instructions: platform.proofHelp,
      expiresInMinutes: LINK_TTL_MS / 60_000
    });
  } catch (error: any) {
    console.error(`[Account] link start failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/account/platforms/:platform/verify", verifyLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = req.user!;
    const platform = resolveLinkPlatform(req.params.platform, res);
    if (!platform) return;

    const pending = await getPendingLink(id, platform.id);
    if (!pending || Date.parse(pending.expiresAt) < Date.now()) {
      if (pending) await deletePendingLink(id, platform.id);
      return res.status(400).json({ error: "This link request has expired. Please start again.", expired: true });
    }
    if (pending.attempts >= MAX_LINK_ATTEMPTS) {
      await deletePendingLink(id, platform.id);
      return res.status(429).json({ error: "Too many failed checks. Please start again.", expired: true });
    }

    let profile;
    try {
      profile = await platform.fetchProfile!(pending.handle);
    } catch (err: any) {
      if (err instanceof PlatformNotFoundError) return res.status(404).json({ error: err.message });
      return res.status(503).json({ error: err.message });
    }

    const needle = pending.code.toLowerCase();
    if (!profile.texts.some((t) => t.toLowerCase().includes(needle))) {
      await bumpPendingLinkAttempts(id, platform.id);
      logSecurityEvent("platform_link_failed", {
        ip: req.ip,
        userId: id,
        platform: platform.id,
        handle: pending.handle,
        attempts: pending.attempts + 1
      });
      return res.status(400).json({
        error: `We couldn't find the code on your ${platform.label} profile yet. Save it there, wait a few seconds, then try again.`
      });
    }

    if (!(await consumePendingLink(id, platform.id))) {
      logSecurityEvent("platform_link_failed", { ip: req.ip, userId: id, platform: platform.id, reason: "replay" });
      return res.status(400).json({ error: "This link request was already used or has expired. Please start again.", expired: true });
    }
    try {
      await insertPlatformAccount(id, platform.id, profile.handle);
    } catch (err: any) {
      if (String(err?.message).includes("UNIQUE")) {
        return res.status(409).json({ error: `That ${platform.label} account was just linked. Refresh and check.` });
      }
      throw err;
    }

    logSecurityEvent("platform_link_verified", { ip: req.ip, userId: id, platform: platform.id, handle: profile.handle }, "info");
    await syncPlatformAccount({ userId: id, platform: platform.id, handle: profile.handle });

    const updated = await userJson(id);
    if (!updated) return res.status(401).json(SESSION_REQUIRED_BODY);
    res.status(201).json(updated);
  } catch (error: any) {
    console.error(`[Account] link verify failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.delete("/account/platforms/:platform", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = req.user!;
    if (!isPlatformId(req.params.platform)) return res.status(404).json({ error: "Unknown platform." });
    const platform = PLATFORMS[req.params.platform];

    if (!(await removePlatformAccount(id, platform.id))) {
      return res.status(404).json({ error: `You don't have a ${platform.label} account linked.` });
    }
    logSecurityEvent("platform_unlinked", { ip: req.ip, userId: id, platform: platform.id }, "info");
    const updated = await userJson(id);
    if (!updated) return res.status(401).json(SESSION_REQUIRED_BODY);
    res.json(updated);
  } catch (error: any) {
    console.error(`[Account] unlink failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/account/leetcode/start", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = req.user!;
    const handle = parseLeetCodeUsername((req.body as any)?.leetcodeUsername);
    if (!handle) {
      return res.status(400).json({ error: "Enter a valid LeetCode username (letters, numbers, _ . - only)." });
    }
    const me = await getUserById(id);
    if (!me) return res.status(401).json(SESSION_REQUIRED_BODY);
    if (me.leetcodeLinked) {
      return res.status(409).json({ error: "You already have a LeetCode account linked. Remove it first to link a different one." });
    }
    if (await findLeetcodeOwner(handle)) {
      return res.status(409).json({ error: "That LeetCode account is already linked to another member." });
    }

    const lookup = await fetchLeetCodeAbout(handle);
    if (lookup.status === "unavailable") {
      logSecurityEvent("ownership_lookup_unavailable", { ip: req.ip, userId: id, platform: "leetcode", purpose: "link" });
      return res.status(503).json({ error: LEETCODE_UNAVAILABLE_MESSAGE });
    }
    if (lookup.status === "not_found") {
      return res.status(404).json({ error: "We couldn't find that LeetCode account. Check the spelling." });
    }

    await purgeExpiredPendingLinks(new Date().toISOString());
    const code = `leeterboard-${crypto.randomBytes(6).toString("hex")}`;
    await createPendingLink({
      userId: id,
      platform: "leetcode",
      handle: lookup.username,
      code,
      expiresAt: new Date(Date.now() + LINK_TTL_MS).toISOString()
    });
    logSecurityEvent("ownership_started", { ip: req.ip, userId: id, platform: "leetcode", purpose: "link" }, "info");
    res.json({
      code,
      platform: "leetcode",
      handle: lookup.username,
      instructions: LEETCODE_PROOF_HELP,
      expiresInMinutes: LINK_TTL_MS / 60_000
    });
  } catch (error: any) {
    console.error(`[Account] LeetCode link start failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/account/leetcode/verify", verifyLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = req.user!;
    const pending = await getPendingLink(id, "leetcode");
    if (!pending || Date.parse(pending.expiresAt) < Date.now()) {
      if (pending) await deletePendingLink(id, "leetcode");
      return res.status(400).json({ error: "This link request has expired. Please start again.", expired: true });
    }
    if (pending.attempts >= MAX_LINK_ATTEMPTS) {
      await deletePendingLink(id, "leetcode");
      return res.status(429).json({ error: "Too many failed checks. Please start again.", expired: true });
    }
    const me = await getUserById(id);
    if (!me) return res.status(401).json(SESSION_REQUIRED_BODY);
    if (me.leetcodeLinked) {
      await deletePendingLink(id, "leetcode");
      return res.status(409).json({ error: "You already have a LeetCode account linked." });
    }

    const lookup = await fetchLeetCodeAbout(pending.handle);
    if (lookup.status === "unavailable") {
      logSecurityEvent("ownership_lookup_unavailable", { ip: req.ip, userId: id, platform: "leetcode", purpose: "link" });
      return res.status(503).json({ error: LEETCODE_UNAVAILABLE_MESSAGE });
    }
    if (lookup.status === "not_found") {
      await deletePendingLink(id, "leetcode");
      return res.status(404).json({ error: "That LeetCode account no longer exists." });
    }
    if (!lookup.aboutMe.toLowerCase().includes(pending.code.toLowerCase())) {
      await bumpPendingLinkAttempts(id, "leetcode");
      logSecurityEvent("ownership_failed", {
        ip: req.ip,
        userId: id,
        platform: "leetcode",
        purpose: "link",
        attempts: pending.attempts + 1
      });
      return res.status(400).json({
        error: "We couldn't find the code on your LeetCode profile yet. Save it in the Summary, wait a few seconds, then try again."
      });
    }

    let stats: Awaited<ReturnType<typeof scrapeLeetCodeProfile>>;
    try {
      stats = await scrapeLeetCodeProfile(pending.handle);
    } catch (err: any) {
      if (err instanceof LeetCodeUserNotFoundError) {
        await deletePendingLink(id, "leetcode");
        return res.status(404).json({ error: "That LeetCode account no longer exists." });
      }
      return res.status(503).json({ error: LEETCODE_UNAVAILABLE_MESSAGE });
    }
    const [contest, streaks] = await Promise.all([fetchContestRating(pending.handle), fetchStreaks(pending.handle, null)]);

    if (!(await consumePendingLink(id, "leetcode"))) {
      return res.status(400).json({ error: "This link request was already used or has expired. Please start again.", expired: true });
    }
    const now = new Date();
    let linked: boolean;
    try {
      linked = await linkLeetcodeAccount(id, {
        leetcodeUsername: pending.handle,
        avatarUrl: stats.avatarUrl ?? null,
        allTimeSolved: stats.allTimeSolved,
        easySolved: stats.easySolved,
        mediumSolved: stats.mediumSolved,
        hardSolved: stats.hardSolved,
        contestRating: contest?.rating ?? null,
        contestsAttended: contest?.attended ?? 0,
        currentStreak: streaks?.current ?? null,
        longestStreak: streaks?.longest ?? null,
        today: now.toISOString().split("T")[0],
        nowIso: now.toISOString()
      });
    } catch (err: any) {
      if (String(err?.message).includes("UNIQUE")) {
        return res.status(409).json({ error: "That LeetCode account was just linked to another member." });
      }
      throw err;
    }
    if (!linked) return res.status(409).json({ error: "You already have a LeetCode account linked." });

    const updated = await getUserById(id);
    if (updated) {
      try {
        await baselineNewMember(updated, leetcodeLinkedUsers(await listUsers()));
      } catch (err: any) {
        console.warn(`[Notifications] Baseline failed: ${err.message}`);
      }
    }
    logSecurityEvent("ownership_verified", { ip: req.ip, userId: id, platform: "leetcode", purpose: "link" }, "info");
    res.status(201).json(await userJson(id));
  } catch (error: any) {
    console.error(`[Account] LeetCode link verify failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.delete("/account/leetcode", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = req.user!;
    if (!(await unlinkLeetcodeAccount(id))) {
      return res.status(404).json({ error: "You don't have a LeetCode account linked." });
    }
    logSecurityEvent("platform_unlinked", { ip: req.ip, userId: id, platform: "leetcode" }, "info");
    const updated = await userJson(id);
    if (!updated) return res.status(401).json(SESSION_REQUIRED_BODY);
    res.json(updated);
  } catch (error: any) {
    console.error(`[Account] LeetCode unlink failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.patch("/account/platforms/:platform", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = req.user!;
    if (!isPlatformId(req.params.platform)) return res.status(404).json({ error: "Unknown platform." });
    const platform = PLATFORMS[req.params.platform];

    const hidden = req.body?.hidden;
    if (typeof hidden !== "boolean") return res.status(400).json({ error: "hidden must be true or false." });

    if (!(await setPlatformHidden(id, platform.id, hidden))) {
      return res.status(404).json({ error: `You don't have a ${platform.label} account linked.` });
    }
    const updated = await userJson(id);
    if (!updated) return res.status(401).json(SESSION_REQUIRED_BODY);
    res.json(updated);
  } catch (error: any) {
    console.error(`[Account] platform visibility failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
