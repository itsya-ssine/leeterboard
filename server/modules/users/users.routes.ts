import { Router } from "express";
import { requireAuth, requireAdmin } from "../../middleware/auth.js";
import { accountLimiter } from "../../middleware/rateLimit.js";
import { logSecurityEvent } from "../../utils/logger.js";
import {
  deleteUserById,
  getMeta,
  getUserAuthById,
  getUserById,
  listUsers,
  setHideLeetcodeStats,
  setPasswordHash,
  updateDisplayName,
  updateProfileDetails,
  updateSchool,
  type ProfileDetailsUpdate
} from "../../../db.js";
import {
  clearSessionCookie,
  hashPassword,
  isAdminUser,
  isPasswordHash,
  SESSION_REQUIRED_BODY,
  setSessionCookie
} from "../../../auth.js";
import { buildAccountExport, exportFileName } from "../../../accountExport.js";
import { sortAndRankUsers } from "../../domain/ranking.js";
import {
  cleanBio,
  cleanDisplayName,
  cleanLink,
  cleanSchool,
  LINK_FIELDS
} from "./users.validation.js";
import {
  resolveWinners,
  withVisiblePlatforms,
  type Viewer
} from "./users.service.js";
import {
  checkAccountDeletion,
  checkCurrentPassword
} from "../auth/auth.service.js";
import { validatePassword } from "../auth/auth.validation.js";

const router = Router();

// GET all users
router.get("/users", requireAuth, async (req, res, next) => {
  try {
    const { id, isAdmin } = req.user!;
    const viewer: Viewer = { id, isAdmin: !!isAdmin };
    res.vary("Cookie");
    const users = (await listUsers()).map((u) => withVisiblePlatforms(u, viewer));
    sortAndRankUsers(users);
    const lastSyncAll = (await getMeta("lastSyncAll")) || "";
    const winners = await resolveWinners(users);
    res.json({ users, lastSyncAll, winners });
  } catch (error: any) {
    next(error);
  }
});

// GET lightweight version token
router.get("/version", requireAuth, async (_req, res, next) => {
  try {
    const lastSyncAll = (await getMeta("lastSyncAll")) || "";
    res.json({ lastSyncAll });
  } catch (error: any) {
    next(error);
  }
});

// PATCH profile
router.patch("/account/profile", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = req.user!;
    const body = req.body ?? {};
    const hasName = body.displayName !== undefined;
    const hasSchool = body.school !== undefined;

    if (hasSchool && typeof body.school !== "string") {
      return res.status(400).json({ error: "School must be text." });
    }

    let cleanedName = "";
    if (hasName) {
      cleanedName = cleanDisplayName(body.displayName, "");
      if (!cleanedName) return res.status(400).json({ error: "Display name can't be empty." });
    }

    const details: ProfileDetailsUpdate = {};
    if (body.bio !== undefined) {
      if (typeof body.bio !== "string") return res.status(400).json({ error: "Bio must be text." });
      details.bio = cleanBio(body.bio);
    }
    for (const f of LINK_FIELDS) {
      if (body[f.body] === undefined) continue;
      if (typeof body[f.body] !== "string") {
        return res.status(400).json({ error: `${f.label} link must be text.` });
      }
      const result = cleanLink(body[f.body], f.label, f.hosts ? [...f.hosts] : null);
      if ("error" in result) return res.status(400).json({ error: result.error });
      details[f.key] = result.value;
    }

    const hasHideLeetcode = body.hideLeetcodeStats !== undefined;
    if (hasHideLeetcode && typeof body.hideLeetcodeStats !== "boolean") {
      return res.status(400).json({ error: "hideLeetcodeStats must be true or false." });
    }

    if (!hasName && !hasSchool && !hasHideLeetcode && Object.keys(details).length === 0) {
      return res.status(400).json({ error: "Nothing to update." });
    }

    if (hasName) await updateDisplayName(id, cleanedName);
    if (hasSchool) await updateSchool(id, cleanSchool(body.school));
    await updateProfileDetails(id, details);
    if (hasHideLeetcode) await setHideLeetcodeStats(id, body.hideLeetcodeStats);

    const updated = await getUserById(id);
    if (!updated) return res.status(401).json(SESSION_REQUIRED_BODY);
    res.json({ ...updated, isAdmin: isAdminUser(updated) });
  } catch (error: any) {
    console.error(`[Account] profile update failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST change password
router.post("/account/password", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id, loginUsername } = req.user!;
    const { currentPassword, newPassword } = req.body ?? {};

    const check = await checkCurrentPassword(id, currentPassword, "password_change", req.ip);
    if (!check.record) return res.status(check.status).json({ error: check.error, code: check.code });

    const passwordError = await validatePassword(newPassword, loginUsername);
    if (passwordError) return res.status(400).json({ error: passwordError });
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: "Your new password must be different from the current one." });
    }

    const newHash = await hashPassword(newPassword as string);
    await setPasswordHash(id, newHash);
    const updatedUserAuth = await getUserAuthById(id);
    logSecurityEvent("password_changed", { ip: req.ip, userId: id, username: loginUsername }, "info");
    setSessionCookie(res, check.record.user, newHash, updatedUserAuth?.auth.sessionVersion);
    res.json({ success: true });
  } catch (error: any) {
    console.error(`[Account] password change failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// GET export
router.get("/account/export", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id, loginUsername } = req.user!;
    const now = new Date();
    const data = await buildAccountExport(id, now);
    if (!data) return res.status(404).json({ error: "Account not found." });

    logSecurityEvent("account_exported", { ip: req.ip, userId: id, username: loginUsername }, "info");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${exportFileName(loginUsername, now)}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(JSON.stringify(data, null, 2));
  } catch (error: any) {
    console.error(`[Account] export failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// POST delete account
router.post("/account/delete", accountLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = req.user!;
    const check = await checkAccountDeletion(id, req.body, req.ip);
    if (!check.record) return res.status(check.status).json({ error: check.error, code: check.code });

    const confirmedWith = isPasswordHash(check.record.auth.passwordHash) ? "password" : "username";
    await deleteUserById(id);
    logSecurityEvent(
      "account_deleted",
      { ip: req.ip, userId: id, username: check.record.user.loginUsername, confirmedWith },
      "info"
    );
    clearSessionCookie(res);
    res.json({ success: true });
  } catch (error: any) {
    console.error(`[Account] delete failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// DELETE user — admin only
router.delete("/users/:id", requireAdmin, async (req, res) => {
  const id = req.params.id as string;
  const session = req.user!;

  try {
    const target = await getUserById(id);
    if (!target) {
      return res.status(404).json({ error: "User not found." });
    }
    if (target.id === session.id || isAdminUser(target)) {
      return res.status(403).json({
        error: "Admin accounts can't be removed here. Remove the account from the admin list first."
      });
    }

    const deleted = await deleteUserById(id);
    if (!deleted) {
      return res.status(404).json({ error: "User not found." });
    }
    logSecurityEvent(
      "admin_user_removed",
      { ip: req.ip, adminId: session.id, admin: session.loginUsername, targetId: target.id, target: target.loginUsername },
      "warn"
    );
    res.json({ success: true });
  } catch (error: any) {
    console.error(`[Admin] user deletion failed: ${error.message}`);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
