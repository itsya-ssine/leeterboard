import { createClient, type Client } from "@libsql/client";

// If TURSO_DATABASE_URL is set, connect to a real Turso cloud database.
// Otherwise fall back to a local SQLite file (no signup needed) so the
// project still runs out of the box — same @libsql/client API either way,
// so upgrading later is just setting two env vars, no code changes.
const url = process.env.TURSO_DATABASE_URL || "file:local.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

// Fail fast on a misconfigured production deployment instead of silently
// running against the wrong database or an unauthenticated remote connection.
if (process.env.VERCEL && url.startsWith("file:")) {
  throw new Error(
    "TURSO_DATABASE_URL is not set. Serverless deployments cannot use a local SQLite file; " +
      "set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the Vercel project's environment variables."
  );
}
if (!url.startsWith("file:") && !authToken) {
  throw new Error("TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL points at a remote database.");
}

// The token travels with every query, so a remote database must be reached
// over TLS: libsql:// and https:// are, plain http:// / ws:// (or tls=0) are
// not. Loopback is allowed for a local sqld during development.
function isInsecureRemoteUrl(value: string): boolean {
  if (value.startsWith("file:")) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false; // the client library reports malformed URLs itself
  }
  const plain = parsed.protocol === "http:" || parsed.protocol === "ws:" || parsed.searchParams.get("tls") === "0";
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  return plain && !loopback;
}
if (isInsecureRemoteUrl(url)) {
  throw new Error("TURSO_DATABASE_URL must use an encrypted scheme (libsql:// or https://) for a remote database.");
}

export const client: Client = authToken
  ? createClient({ url, authToken })
  : createClient({ url });

export async function columnExists(table: string, column: string): Promise<boolean> {
  const res = await client.execute({
    sql: `SELECT 1 FROM pragma_table_info(?) WHERE name = ?`,
    args: [table, column]
  });
  return res.rows.length > 0;
}
