import crypto from "crypto";
import { Router } from "express";
import { requireAdmin, requireAuth, resolveSession } from "../../middleware/auth.js";
import { refreshLimiter } from "../../middleware/rateLimit.js";
import { logSecurityEvent } from "../../utils/logger.js";
import { acquireLease, releaseLease, getUserById, recordSyncResult, getMeta } from "../../../db.js";
import { LeetCodeUserNotFoundError } from "../../platforms/leetcode/errors.js";
import {
  AUTO_SYNC_BUDGET_MS,
  AUTO_SYNC_STALE_MS,
  syncAllUsers,
  syncSingleUser
} from "./sync.service.js";
import { withVisiblePlatforms, type Viewer } from "../users/users.service.js";

const router = Router();

async function viewerOf(req: any): Promise<Viewer> {
  if (req.user) return { id: req.user.id, isAdmin: !!req.user.isAdmin };
  const resolved = await resolveSession(req);
  return { id: resolved?.user.id ?? null, isAdmin: !!resolved?.isAdmin };
}

// POST refresh individual user — admin only
router.post("/users/:id/refresh", refreshLimiter, requireAdmin, async (req, res, next) => {
  const id = req.params.id as string;
  const admin = req.user!;
  logSecurityEvent(
    "admin_refresh",
    { ip: req.ip, adminId: admin.id, admin: admin.loginUsername, scope: "member", targetId: id },
    "info"
  );

  try {
    const existing = await getUserById(id);
    if (!existing) {
      return res.status(404).json({ error: "User not found." });
    }

    try {
      const user = await syncSingleUser(id);
      res.vary("Cookie");
      return res.json(withVisiblePlatforms(user, await viewerOf(req)));
    } catch (err: any) {
      if (err instanceof LeetCodeUserNotFoundError) {
        await recordSyncResult(id, { ok: false, state: "not_found", error: err.message });
        return res.status(404).json({ error: err.message, user: existing });
      }
      await recordSyncResult(id, { ok: false, state: "unavailable", error: err.message });
      return res.status(503).json({ error: err.message, user: existing });
    }
  } catch (error: any) {
    next(error);
  }
});

// POST sync-if-stale
router.post("/sync-if-stale", requireAuth, refreshLimiter, async (_req, res, next) => {
  try {
    const lastSyncAll = (await getMeta("lastSyncAll")) || "";
    const age = Date.now() - Date.parse(lastSyncAll);
    if (lastSyncAll && Number.isFinite(age) && age < AUTO_SYNC_STALE_MS) {
      return res.json({ synced: false, partial: false, busy: false, lastSyncAll });
    }

    const leaseHolder = await acquireLease("sync", AUTO_SYNC_BUDGET_MS + 20_000);
    if (!leaseHolder) {
      return res.json({ synced: false, partial: false, busy: true, lastSyncAll });
    }

    try {
      const result = await syncAllUsers({
        onlyStaleMs: AUTO_SYNC_STALE_MS,
        budgetMs: AUTO_SYNC_BUDGET_MS
      });
      res.json({
        synced: true,
        partial: result.partial,
        busy: false,
        lastSyncAll: result.lastSyncAll
      });
    } finally {
      await releaseLease("sync", leaseHolder).catch(() => {});
    }
  } catch (error: any) {
    next(error);
  }
});

// POST /api/cron/sync
router.post("/cron/sync", async (req, res, next) => {
  try {
    const authHeader = req.get("authorization") ?? "";
    const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
    const givenBuf = Buffer.from(authHeader);
    const wantBuf = Buffer.from(expected);

    if (
      !process.env.CRON_SECRET ||
      givenBuf.length === 0 ||
      givenBuf.length !== wantBuf.length ||
      !crypto.timingSafeEqual(givenBuf, wantBuf)
    ) {
      logSecurityEvent("cron_sync_unauthorized", { ip: req.ip }, "warn");
      return res.status(401).json({ error: "Unauthorized." });
    }

    const leaseHolder = await acquireLease("sync", 5 * 60_000);
    if (!leaseHolder) {
      return res.status(202).json({ skipped: "already running" });
    }

    try {
      const result = await syncAllUsers({
        onlyStaleMs: AUTO_SYNC_STALE_MS,
        budgetMs: AUTO_SYNC_BUDGET_MS
      });
      logSecurityEvent(
        "cron_sync_completed",
        {
          ip: req.ip,
          partial: result.partial,
          count: result.users.length
        },
        "info"
      );
      res.json({
        ok: true,
        synced: true,
        partial: result.partial,
        lastSyncAll: result.lastSyncAll
      });
    } finally {
      await releaseLease("sync", leaseHolder).catch(() => {});
    }
  } catch (error: any) {
    next(error);
  }
});

// POST refresh-all
router.post("/refresh-all", refreshLimiter, requireAdmin, async (req, res, next) => {
  const admin = req.user!;
  logSecurityEvent(
    "admin_refresh",
    { ip: req.ip, adminId: admin.id, admin: admin.loginUsername, scope: "all" },
    "info"
  );
  try {
    const result = await syncAllUsers();
    res.json({ success: true, ...result });
  } catch (error: any) {
    next(error);
  }
});

export default router;
