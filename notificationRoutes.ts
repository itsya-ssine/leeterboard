import { Router } from "express";
import { requireAuth, requireAdmin } from "./auth.js";
import { accountLimiter } from "./rateLimit.js";
import { logSecurityEvent } from "./securityLog.js";
import {
  createAdminMessage,
  dismissNotification,
  dismissReadNotifications,
  listNotifications,
  listSentMessages,
  markNotificationsRead
} from "./db.js";

/* ---------- Notification endpoints ----------
 *
 * Members read and tidy their own notifications; admins send messages. A
 * member only ever sees or touches rows whose user_id is their own — the id
 * always comes from the verified session, never from the request.
 *
 *   GET    /api/notifications              the member's list + unread count
 *   POST   /api/notifications/read         { all: true } | { ids: string[] }
 *   POST   /api/notifications/clear-read   remove every read notification
 *   DELETE /api/notifications/:id          remove one
 *
 *   GET    /api/admin/notifications        recently sent messages (+ read counts)
 *   POST   /api/admin/notifications        { to: "all" | <member id>, title, message? }
 */

const MAX_TITLE_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 500;
const MAX_IDS_PER_REQUEST = 100;

// Replaces control characters with spaces and trims. A title is one line, so
// its whitespace is also collapsed; a message keeps its line breaks. Returns
// null for a non-string or one longer than `max`.
function cleanText(value: unknown, max: number, multiline: boolean): string | null {
  if (typeof value !== "string") return null;
  let text = value.replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, " ");
  if (!multiline) text = text.replace(/\s+/g, " ");
  text = text.trim();
  return text.length <= max ? text : null;
}

const router = Router();

/* ---------- Members: their own notifications ---------- */

router.get("/notifications", requireAuth, async (req, res) => {
  try {
    const { id } = (req as any).user;
    res.json(await listNotifications(id));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/notifications/read", requireAuth, async (req, res) => {
  try {
    const { id } = (req as any).user;
    const { ids, all } = req.body ?? {};

    if (all === true) {
      await markNotificationsRead(id, null);
    } else if (
      Array.isArray(ids) &&
      ids.length <= MAX_IDS_PER_REQUEST &&
      ids.every((x) => typeof x === "string" && x.length > 0 && x.length <= 64)
    ) {
      await markNotificationsRead(id, ids);
    } else {
      return res.status(400).json({ error: "Send { all: true } or a list of notification ids." });
    }
    res.json(await listNotifications(id));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/notifications/clear-read", requireAuth, async (req, res) => {
  try {
    const { id } = (req as any).user;
    await dismissReadNotifications(id);
    res.json(await listNotifications(id));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/notifications/:notificationId", requireAuth, async (req, res) => {
  try {
    const { id } = (req as any).user;
    const removed = await dismissNotification(id, req.params.notificationId as string);
    if (!removed) return res.status(404).json({ error: "Notification not found." });
    res.json(await listNotifications(id));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/* ---------- Admins: send messages ---------- */

router.get("/admin/notifications", requireAdmin, async (req, res) => {
  try {
    res.json({ messages: await listSentMessages(20) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/admin/notifications", accountLimiter, requireAdmin, async (req, res) => {
  try {
    const sender = (req as any).user;
    const { to, title, message } = req.body ?? {};

    const cleanTitle = cleanText(title, MAX_TITLE_LENGTH, false);
    if (!cleanTitle) {
      return res.status(400).json({ error: `Give the message a title of up to ${MAX_TITLE_LENGTH} characters.` });
    }
    const cleanMessage = cleanText(message ?? "", MAX_MESSAGE_LENGTH, true);
    if (cleanMessage === null) {
      return res.status(400).json({ error: `The message can be at most ${MAX_MESSAGE_LENGTH} characters.` });
    }
    if (typeof to !== "string" || to.length === 0 || to.length > 100) {
      return res.status(400).json({ error: 'Choose who to send it to: a member, or "all".' });
    }

    const sent = await createAdminMessage({
      senderId: sender.id,
      userId: to === "all" ? null : to,
      title: cleanTitle,
      body: cleanMessage
    });
    if (sent === 0) {
      return res.status(to === "all" ? 409 : 404).json({
        error: to === "all" ? "There are no members to send it to." : "That member doesn't exist."
      });
    }
    logSecurityEvent(
      "admin_message_sent",
      { ip: req.ip, adminId: sender.id, admin: sender.leetcodeUsername, to: to === "all" ? "all" : to, recipients: sent },
      "info"
    );
    res.status(201).json({ sent });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
