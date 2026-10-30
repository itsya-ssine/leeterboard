// MUST be the first import of server.ts: modules loaded after it (security
// headers, cookie options) read NODE_ENV when they are first evaluated.
//
// Applies the decision from runtimeEnvPolicy.ts. See there for the why (F3).
import "dotenv/config"; // so a NODE_ENV in .env counts; it's a no-op the second time
import { decideRuntime } from "./runtimeEnvPolicy.js";

// `npm run build` defines this as true (esbuild --define). Running the
// TypeScript source (tsx, Vercel) leaves it undefined, and `typeof` on an
// undeclared name is safe.
declare const __PRODUCTION_BUNDLE__: boolean | undefined;
const isProductionBundle = typeof __PRODUCTION_BUNDLE__ !== "undefined" && __PRODUCTION_BUNDLE__ === true;

const decision = decideRuntime(process.env, isProductionBundle);
if (decision.forceProduction) process.env.NODE_ENV = "production";
for (const warning of decision.warnings) console.warn(`[Config] ${warning}`);
if (decision.fatal) {
  console.error(`[Config] ${decision.fatal}`);
  process.exit(1);
}
