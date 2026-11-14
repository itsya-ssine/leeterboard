import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { listUsers, leetcodeLinkedUsers } from "../../../db.js";
import { isPlatformId } from "../../../platforms/registry.js";
import { buildPlatformTrend } from "../../../platformTrends.js";

const router = Router();

router.get("/trends", requireAuth, async (req, res, next) => {
  try {
    const users = await listUsers();

    if (req.query.platform !== undefined) {
      if (!isPlatformId(req.query.platform)) return res.status(400).json({ error: "Unknown platform." });
      return res.json(await buildPlatformTrend(req.query.platform, users));
    }

    const board = leetcodeLinkedUsers(users);
    const allDates = new Set<string>();
    board.forEach((u) => u.history.forEach((h) => allDates.add(h.date)));
    const sortedDates = [...allDates].sort();

    const perUser = board
      .map((u) => {
        const history = [...u.history].sort((a, b) => a.date.localeCompare(b.date));
        const base =
          history.length > 0 && history[0].date === u.trackingStart ? u.baselineSolved : history[0]?.solvedCount ?? 0;
        return { history, base };
      })
      .filter((p) => p.history.length > 0);

    const trendData = sortedDates.map((date) => {
      let growth = 0;
      let activeUsers = 0;
      for (const p of perUser) {
        const first = p.history[0];
        if (date < first.date) continue;
        let latest = first;
        for (const h of p.history) {
          if (h.date <= date) latest = h;
          else break;
        }
        growth += Math.max(0, latest.solvedCount - p.base);
        activeUsers += 1;
      }
      return { date, solved: growth, activeUsers };
    });

    let easyTotal = 0;
    let mediumTotal = 0;
    let hardTotal = 0;
    board.forEach((u) => {
      easyTotal += u.easySolved;
      mediumTotal += u.mediumSolved;
      hardTotal += u.hardSolved;
    });

    let topSolver = "None";
    let topCount = 0;
    board.forEach((u) => {
      if (u.weeklyProgress > topCount) {
        topCount = u.weeklyProgress;
        topSolver = u.displayName;
      }
    });

    res.json({
      historyTrend: trendData,
      difficultyBreakdown: [
        { name: "Easy", value: easyTotal, color: "#10b981" },
        { name: "Medium", value: mediumTotal, color: "#f59e0b" },
        { name: "Hard", value: hardTotal, color: "#ef4444" }
      ],
      topSolverThisWeek: topSolver,
      topSolverThisWeekCount: topCount,
      totalSolved: board.reduce((acc, u) => acc + u.allTimeSolved, 0)
    });
  } catch (error: any) {
    next(error);
  }
});

export default router;
