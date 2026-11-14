import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.js";
import { getMeta, listSyncStatus, listUsers, leetcodeLinkedUsers } from "../../../db.js";
import type { AdminSyncMember, AdminSyncReport } from "../../../shared/types.js";

const router = Router();

router.get("/admin/sync-status", requireAdmin, async (_req, res, next) => {
  try {
    const [users, statuses, lastSyncAll] = await Promise.all([
      listUsers(),
      listSyncStatus(),
      getMeta("lastSyncAll")
    ]);

    const members: AdminSyncMember[] = leetcodeLinkedUsers(users).map((u) => {
      const s = statuses.get(u.id);
      return {
        id: u.id,
        displayName: u.displayName,
        loginUsername: u.loginUsername,
        leetcodeUsername: u.leetcodeUsername,
        avatarUrl: u.avatarUrl,
        lastUpdated: u.lastUpdated,
        lastAttempt: s?.lastAttempt ?? null,
        state: s?.state ?? "unknown",
        error: s?.error ?? null,
        failures: s?.failures ?? 0,
        failingSince: s?.failingSince ?? null
      };
    });

    const report: AdminSyncReport = {
      generatedAt: new Date().toISOString(),
      lastSyncAll: lastSyncAll || "",
      members
    };
    res.json(report);
  } catch (error: any) {
    next(error);
  }
});

export default router;
