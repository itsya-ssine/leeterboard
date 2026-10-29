import { Router } from "express";
import { requireAdmin, resolveSession } from "./auth.js";
import { feedbackLimiter } from "./rateLimit.js";
import { logSecurityEvent } from "./securityLog.js";
import { createFeedback, deleteFeedback, listFeedback, setFeedbackRead } from "./db.js";
import type { FeedbackCategory } from "./src/types.js";

/* ---------- Feedback endpoints ----------
 *
 * Anyone can send feedback from the floating button; admins read it on the
 * Admin page. A signed-in member's feedback carries their name, a visitor's
 * is anonymous. The member id always comes from the verified session, never
 * from the request body.
 *
 *   POST   /api/feedback                { message, category?, page? }   public, rate limited
 *
 *   GET    /api/admin/feedback          newest 100 + total unread       admin
 *   PATCH  /api/admin/feedback/:id      { read: boolean }               admin
 *   DELETE /api/admin/feedback/:id                                      admin
 */

// Limits mirror the form (src/FeedbackWidget.tsx), which enforces them first.
const MIN_MESSAGE_LENGTH = 3;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_PAGE_LENGTH = 100;

const CATEGORIES: readonly FeedbackCategory[] = ["bug", "idea", "other"];

// Replaces control characters with spaces and trims; a one-line value also has
// its whitespace collapsed, a multi-line one keeps its line breaks. Returns
// null for a non-string or one longer than `max`. (Same rules as the admin
// message form in notificationRoutes.ts.)
function cleanText(value: unknown, max: number, multiline: boolean): string | null {
  if (typeof value !== "string") return null;
  let text = value.replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, " ");
  if (!multiline) text = text.replace(/\s+/g, " ");
  text = text.trim();
  return text.length <= max ? text : null;
}

const router = Router();

/* ---------- Anyone: send feedback ---------- */

router.post("/feedback", feedbackLimiter, async (req, res) => {
  try {
    const { message, category, page } = req.body ?? {};

    const cleanMessage = cleanText(message, MAX_MESSAGE_LENGTH, true);
    if (cleanMessage === null || cleanMessage.length < MIN_MESSAGE_LENGTH) {
      return res.status(400).json({
        error: `Write a message of ${MIN_MESSAGE_LENGTH} to ${MAX_MESSAGE_LENGTH} characters.`
      });
    }

    let cleanCategory: FeedbackCategory = "other";
    if (category !== undefined) {
      if (typeof category !== "string" || !CATEGORIES.includes(category as FeedbackCategory)) {
        return res.status(400).json({ error: "Choose bug, idea or other." });
      }
      cleanCategory = category as FeedbackCategory;
    }

    // Context only; too long or not a string just means "unknown".
    const cleanPage = cleanText(page ?? "", MAX_PAGE_LENGTH, false) ?? "";

    // A bad or missing session simply makes the feedback anonymous.
    const session = await resolveSession(req).catch(() => null);
    const userId = session?.user.id ?? null;

    await createFeedback({ userId, category: cleanCategory, message: cleanMessage, page: cleanPage });
    logSecurityEvent(
      "feedback_received",
      { ip: req.ip, userId, category: cleanCategory, length: cleanMessage.length },
      "info"
    );
    res.status(201).json({ ok: true });
  } catch (error: any) {
    console.error(`[Feedback] could not save: ${error.message}`);
    res.status(500).json({ error: "Couldn't save your feedback. Please try again." });
  }
});

/* ---------- Admins: the inbox ---------- */

router.get("/admin/feedback", requireAdmin, async (_req, res) => {
  try {
    res.json(await listFeedback(100));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/admin/feedback/:feedbackId", requireAdmin, async (req, res) => {
  try {
    const feedbackId = req.params.feedbackId as string;
    const { read } = req.body ?? {};
    if (typeof read !== "boolean") {
      return res.status(400).json({ error: "Send { read: true } or { read: false }." });
    }
    if (feedbackId.length === 0 || feedbackId.length > 64) {
      return res.status(404).json({ error: "Feedback not found." });
    }
    const updated = await setFeedbackRead(feedbackId, read);
    if (!updated) return res.status(404).json({ error: "Feedback not found." });
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/admin/feedback/:feedbackId", requireAdmin, async (req, res) => {
  try {
    const admin = (req as any).user as { id: string; leetcodeUsername: string };
    const feedbackId = req.params.feedbackId as string;
    if (feedbackId.length === 0 || feedbackId.length > 64) {
      return res.status(404).json({ error: "Feedback not found." });
    }
    const removed = await deleteFeedback(feedbackId);
    if (!removed) return res.status(404).json({ error: "Feedback not found." });
    logSecurityEvent(
      "admin_feedback_deleted",
      { ip: req.ip, adminId: admin.id, admin: admin.leetcodeUsername, feedbackId },
      "info"
    );
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
