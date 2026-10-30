// Decides which mode the server runs in, and checks the folder it serves.
//
// Kept free of side effects (runtimeEnv.ts applies the decision) so the rules
// can be unit-tested without starting anything.
//
// Why this exists (audit F3): the server picks the Vite DEV server whenever
// NODE_ENV isn't "production". On a host that doesn't set it for you, that
// means no CSP, no HSTS and non-Secure cookies, silently. So the production
// build must never depend on someone remembering an environment variable.
import fs from "fs";
import path from "path";

// Environment variables that only exist on a hosting platform. If one of them
// is set and NODE_ENV is not, someone is about to expose the dev server.
export const HOSTING_SIGNALS = [
  "RENDER",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_PROJECT_ID",
  "FLY_APP_NAME",
  "DYNO", // Heroku
  "K_SERVICE", // Google Cloud Run
  "KUBERNETES_SERVICE_HOST",
  "WEBSITE_SITE_NAME", // Azure App Service
  "ECS_CONTAINER_METADATA_URI_V4", // AWS ECS
  "AWS_EXECUTION_ENV" // AWS Lambda / Beanstalk
] as const;

export interface RuntimeDecision {
  /** Set process.env.NODE_ENV to "production" before anything else loads. */
  forceProduction: boolean;
  /** Printed as warnings, the server keeps going. */
  warnings: string[];
  /** When set, the server must refuse to start with this message. */
  fatal: string | null;
}

/**
 * @param isProductionBundle true only inside the file built by `npm run build`
 *   (esbuild sets it), never when running the TypeScript source.
 */
export function decideRuntime(env: NodeJS.ProcessEnv, isProductionBundle: boolean): RuntimeDecision {
  const nodeEnv = (env.NODE_ENV ?? "").trim();
  const warnings: string[] = [];

  // The built bundle IS the production server: it can't serve the dev
  // frontend (Vite is a dev dependency), so no NODE_ENV value can change that.
  if (isProductionBundle) {
    if (nodeEnv && nodeEnv !== "production") {
      warnings.push(`Ignoring NODE_ENV="${nodeEnv}": the production build always runs in production mode.`);
    }
    return { forceProduction: true, warnings, fatal: null };
  }

  if (nodeEnv === "production") return { forceProduction: false, warnings, fatal: null };
  if (env.VERCEL && !nodeEnv) return { forceProduction: true, warnings, fatal: null };

  // From here on the server would run the Vite dev server.
  const host = HOSTING_SIGNALS.find((name) => env[name]);
  if (host) {
    const problem =
      `This looks like a hosted environment (${host} is set) but NODE_ENV is ` +
      `${nodeEnv ? `"${nodeEnv}"` : "not set"}, so the Vite dev server would be exposed ` +
      "with no Content-Security-Policy, no HSTS and non-Secure cookies.";
    if (!nodeEnv) {
      return {
        forceProduction: false,
        warnings,
        fatal: `${problem} Refusing to start. Run \`npm run build && npm start\` (or set NODE_ENV=production).`
      };
    }
    // Set on purpose, so respect it, but say so.
    warnings.push(`${problem} Continuing because NODE_ENV was set explicitly.`);
  } else {
    const remoteDb = Boolean(env.TURSO_DATABASE_URL) && !String(env.TURSO_DATABASE_URL).startsWith("file:");
    if (env.PORT || remoteDb) {
      warnings.push(
        "Running the Vite dev server (NODE_ENV is not \"production\"): no CSP, no HSTS, non-Secure cookies. " +
          "Never expose this to the internet. For a real deployment use `npm run build && npm start`."
      );
    }
  }
  return { forceProduction: false, warnings, fatal: null };
}

// Files that must never be reachable over HTTP: server code and its sourcemaps.
const SERVER_CODE = /(\.(cjs|ts)(\.map)?$)|(^server\.)/i;

/** Lists anything in the static folder that looks like server code (relative paths). */
export function findServerCode(dir: string, base = dir): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findServerCode(full, base));
    else if (SERVER_CODE.test(entry.name)) found.push(path.relative(base, full));
  }
  return found;
}
