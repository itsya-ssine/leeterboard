import "dotenv/config";
import { decideRuntime, HOSTING_SIGNALS, type RuntimeDecision } from "../../runtimeEnvPolicy.js";

declare const __PRODUCTION_BUNDLE__: boolean | undefined;
export const isProductionBundle = typeof __PRODUCTION_BUNDLE__ !== "undefined" && __PRODUCTION_BUNDLE__ === true;

export function getRuntimeDecision(): RuntimeDecision {
  return decideRuntime(process.env, isProductionBundle);
}

export function applyRuntimeEnvironment(): RuntimeDecision {
  const decision = getRuntimeDecision();
  if (decision.forceProduction) {
    process.env.NODE_ENV = "production";
  }
  for (const warning of decision.warnings) {
    console.warn(`[Config] ${warning}`);
  }
  if (decision.fatal) {
    console.error(`[Config] ${decision.fatal}`);
    process.exit(1);
  }
  return decision;
}

export const IS_PRODUCTION = process.env.NODE_ENV === "production";
export const PORT = Number(process.env.PORT) || 3000;
export const JWT_SECRET = process.env.JWT_SECRET || "";

export { HOSTING_SIGNALS, type RuntimeDecision };
