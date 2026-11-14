import "./config/env.js";
import path from "path";
import fs from "fs";
import app, { dbReady } from "./app.js";
import { PORT } from "./config/env.js";
import { pageLimiter } from "./middleware/rateLimit.js";
import { findServerCode } from "../runtimeEnvPolicy.js";
import { syncAllUsers } from "./modules/sync/sync.service.js";

export async function startServer() {
  await dbReady;

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist", "client");
    if (!fs.existsSync(path.join(distPath, "index.html"))) {
      console.error(
        `[Config] No frontend build found in ${distPath}. Run "npm run build"; until then only the API works.`
      );
    }
    const leaked = fs.existsSync(distPath) ? findServerCode(distPath) : [];
    if (leaked.length > 0) {
      console.error(
        `[Config] Refusing to start: ${distPath} is served publicly but contains server code (${leaked.join(", ")}). Keep the server bundle and sourcemaps outside it.`
      );
      process.exit(1);
    }
    const express = (await import("express")).default;
    app.use(express.static(distPath, { dotfiles: "ignore" }));
    app.get("/*splat", pageLimiter, (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  setInterval(() => {
    syncAllUsers()
      .then(({ users }) => {
        console.log(`[Background Sync] Refreshed ${users.length} users.`);
      })
      .catch((e) => {
        console.warn(`[Background Sync] Failed: ${e.message}`);
      });
  }, 1000 * 60 * 30);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;
