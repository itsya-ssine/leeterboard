import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import { initDb } from "../db.js";
import { securityHeaders } from "./middleware/securityHeaders.js";
import { csrfProtection } from "./middleware/csrf.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { centralErrorHandler } from "./middleware/error.js";
import { requestIdMiddleware } from "./middleware/requestId.js";

import healthRoutes from "./modules/health/health.routes.js";
import authRoutes from "./modules/auth/auth.routes.js";
import oauthRoutes from "./modules/oauth/oauth.routes.js";
import usersRoutes from "./modules/users/users.routes.js";
import platformsRoutes from "./modules/platforms/platforms.routes.js";
import syncRoutes from "./modules/sync/sync.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import leaderboardRoutes from "./modules/leaderboard/leaderboard.routes.js";
import notificationRoutes from "../notificationRoutes.js";
import feedbackRoutes from "../feedbackRoutes.js";

const app = express();

const TRUST_PROXY_HOPS = (() => {
  const raw = process.env.TRUST_PROXY_HOPS;
  if (raw !== undefined && raw !== "") {
    const hops = Number(raw);
    if (Number.isInteger(hops) && hops >= 0 && hops <= 5) return hops;
    console.warn(`[Config] Ignoring invalid TRUST_PROXY_HOPS "${raw}" (use a whole number from 0 to 5).`);
  }
  return process.env.VERCEL || process.env.NODE_ENV === "production" ? 1 : 0;
})();
app.set("trust proxy", TRUST_PROXY_HOPS);
app.disable("x-powered-by");

// Correlation ID on every request
app.use(requestIdMiddleware);

// Security headers
app.use(securityHeaders);

// CSRF defense on /api
app.use("/api", csrfProtection);

// Payload size cap & cookies
app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());

// Rate limiter on /api
app.use("/api", apiLimiter);

// Database ready gate
export const dbReady = initDb();
app.use((_req, _res, next) => {
  dbReady.then(() => next()).catch(next);
});

// Feature routers mounted on /api
app.use("/api", healthRoutes);
app.use("/api", authRoutes);
app.use("/api", oauthRoutes);
app.use("/api", usersRoutes);
app.use("/api", platformsRoutes);
app.use("/api", syncRoutes);
app.use("/api", adminRoutes);
app.use("/api", leaderboardRoutes);
app.use("/api", notificationRoutes);
app.use("/api", feedbackRoutes);

// Central error handler
app.use(centralErrorHandler);

export default app;
