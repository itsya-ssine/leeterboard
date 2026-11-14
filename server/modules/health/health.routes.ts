import { Router } from "express";
import { getMeta } from "../../../db.js";

const router = Router();

router.get("/health", async (_req, res) => {
  try {
    const lastSyncAll = await getMeta("lastSyncAll");
    res.set("Cache-Control", "no-store").json({
      ok: true,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      lastSyncAll: lastSyncAll || null
    });
  } catch {
    res.set("Cache-Control", "no-store").status(503).json({
      ok: false,
      error: "Database unavailable"
    });
  }
});

export default router;
