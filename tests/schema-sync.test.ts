/**
 * db/schema.sql, the MIGRATIONS list and initDb() must describe the same
 * database. This builds one database with initDb() (which also runs every
 * migration) and one by executing db/schema.sql, then compares what SQLite
 * reports about them: tables, columns, types, NOT NULL, defaults, primary keys,
 * foreign keys, CHECK constraints and indexes. It turns "keep the three in
 * sync" from a comment into a failing test.
 */
import { createClient, type Client } from "@libsql/client";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

let tmpDir = "";
let fromInit: Client;
let fromSchema: Client;

// Lower-cases, drops comments and "IF NOT EXISTS", and collapses whitespace and
// the spacing around punctuation, so the same DDL written with different
// layout compares equal.
const normalize = (sql: string): string =>
  sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\bIF NOT EXISTS\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .replace(/"/g, "")
    .trim()
    .toLowerCase();

// Every CHECK (...) clause of a CREATE TABLE statement, with balanced parentheses.
function checks(sql: string): string[] {
  const text = normalize(sql);
  const found: string[] = [];
  let at = text.indexOf("check(");
  while (at !== -1) {
    let depth = 0;
    let i = at + "check".length;
    for (; i < text.length; i++) {
      if (text[i] === "(") depth++;
      if (text[i] === ")" && --depth === 0) break;
    }
    found.push(text.slice(at, i + 1));
    at = text.indexOf("check(", i);
  }
  return found.sort();
}

const rowsOf = async (db: Client, sql: string, args: (string | number)[] = []) =>
  (await db.execute({ sql, args })).rows.map((r) => ({ ...r }));

async function describeDb(db: Client) {
  const tables = (
    await rowsOf(
      db,
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE 'libsql\\_%' ESCAPE '\\'
       ORDER BY name`
    )
  ).map((r) => ({ name: String(r.name), sql: String(r.sql) }));

  const out: Record<string, unknown> = {};
  for (const t of tables) {
    const columns = await rowsOf(
      db,
      `SELECT name, type, "notnull" AS nn, dflt_value, pk FROM pragma_table_info(?) ORDER BY name`,
      [t.name]
    );
    const foreignKeys = await rowsOf(
      db,
      `SELECT "from", "table", "to", on_update, on_delete FROM pragma_foreign_key_list(?) ORDER BY "from", "table"`,
      [t.name]
    );
    const withoutRowid = (await rowsOf(db, `SELECT wr FROM pragma_table_list(?)`, [t.name]))[0]?.wr;

    // Indexes SQLite builds for PRIMARY KEY / UNIQUE constraints have generated
    // names, so they are compared by their columns; explicit ones by their SQL.
    const autoIndexes: string[] = [];
    for (const ix of await rowsOf(db, `SELECT name, "unique", origin FROM pragma_index_list(?)`, [t.name])) {
      if (ix.origin === "c") continue;
      const cols = await rowsOf(db, `SELECT name FROM pragma_index_info(?) ORDER BY seqno`, [String(ix.name)]);
      autoIndexes.push(`${ix.origin}:${ix.unique}:${cols.map((c) => c.name).join(",")}`);
    }
    const explicitIndexes = (
      await rowsOf(db, `SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL`, [t.name])
    )
      .map((r) => normalize(String(r.sql)))
      .sort();

    out[t.name] = {
      columns,
      foreignKeys,
      withoutRowid,
      checks: checks(t.sql),
      autoIndexes: autoIndexes.sort(),
      explicitIndexes
    };
  }
  return out;
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-schema-sync-"));
  process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
  process.env.TURSO_DATABASE_URL = `file:${path.join(tmpDir, "init.db")}`;
  process.env.TURSO_AUTH_TOKEN = "";
  const db = await import("../db.js");
  await db.initDb();
  fromInit = db.client;

  fromSchema = createClient({ url: `file:${path.join(tmpDir, "schema.db")}` });
  const sql = fs.readFileSync(path.resolve(import.meta.dirname, "../db/schema.sql"), "utf8");
  await fromSchema.executeMultiple(sql);
});

after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe("db/schema.sql matches initDb() and the migrations", () => {
  it("has the same set of tables", async () => {
    const names = async (db: Client) => Object.keys(await describeDb(db));
    assert.deepEqual(await names(fromSchema), await names(fromInit));
  });

  it("describes every table identically (columns, keys, checks, indexes)", async () => {
    const a = (await describeDb(fromInit)) as Record<string, unknown>;
    const b = (await describeDb(fromSchema)) as Record<string, unknown>;
    for (const table of Object.keys(a)) {
      assert.deepEqual(b[table], a[table], `table "${table}" differs between initDb() and db/schema.sql`);
    }
  });

  it("includes the e-mail columns and the unique e-mail index, and no pending_email_codes", async () => {
    for (const db of [fromInit, fromSchema]) {
      const cols = (await rowsOf(db, "SELECT name FROM pragma_table_info('users')")).map((r) => r.name);
      assert.ok(cols.includes("email") && cols.includes("email_verified_at"));
      const idx = await rowsOf(db, "SELECT sql FROM sqlite_master WHERE name = 'idx_users_email'");
      assert.match(normalize(String(idx[0]?.sql)), /create unique index idx_users_email on users\(lower\(email\)\)\s*where email is not null/);
      const t = await rowsOf(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pending_email_codes'");
      assert.equal(t.length, 0, "pending_email_codes was dropped by migration 19");
    }
  });

  it("includes the OAuth tables and their unique indexes", async () => {
    for (const db of [fromInit, fromSchema]) {
      for (const name of ["oauth_identities", "oauth_states", "pending_oauth_signups"]) {
        const t = await rowsOf(db, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${name}'`);
        assert.equal(t.length, 1, `${name} is missing`);
      }
      for (const name of ["idx_oauth_identities_user_provider", "idx_pending_oauth_signups_identity"]) {
        const idx = await rowsOf(db, `SELECT sql FROM sqlite_master WHERE name = '${name}'`);
        assert.match(normalize(String(idx[0]?.sql)), /^create unique index/);
      }
    }
  });
});
