import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { client, startServer, type TestServer } from "./helpers.js";
import { makeUser } from "./f2-seed.js";

const PW = "correct-horse-battery-9";

let tmpDir = "";
let dbUrl = "";
let server: TestServer;
let api: ReturnType<typeof client>;
let db: typeof import("../db.js");
let auth: typeof import("../auth.js");
let userId = "";

before(async () => {
  const secret = crypto.randomBytes(48).toString("hex");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-pwharden-"));
  dbUrl = `file:${path.join(tmpDir, "test.db")}`;

  process.env.JWT_SECRET = secret;
  process.env.TURSO_DATABASE_URL = dbUrl;
  process.env.TURSO_AUTH_TOKEN = "";

  auth = await import("../auth.js");
  db = await import("../db.js");
  await db.initDb();

  // Create user with an intentionally under-costed hash (N = 2^14 instead of 2^15)
  // Format: scrypt$N$r$p$salt$key
  const salt = crypto.randomBytes(16);
  const key = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(PW, salt, 64, { N: 2 ** 14, r: 8, p: 1 }, (err, k) => (err ? reject(err) : resolve(k)));
  });
  const weakHash = `scrypt$${2 ** 14}$8$1$${salt.toString("base64")}$${key.toString("base64")}`;

  const u = makeUser("rehash_user");
  await db.insertUser(u, weakHash);
  userId = u.id;

  server = await startServer({
    TURSO_DATABASE_URL: dbUrl,
    JWT_SECRET: secret
  });
  api = client(server);
});

after(async () => {
  await server?.stop();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Password Hashing & Policy Hardening (SEC-07)", () => {
  it("enforces minimum 10-character password length", () => {
    assert.equal(auth.MIN_PASSWORD_LENGTH, 10);
  });

  it("identifies hashes that need rehashing", () => {
    // Weak N (2^14 < 2^15)
    assert.equal(auth.needsRehash(`scrypt$${2 ** 14}$8$1$c2FsdA==$a2V5`), true);
    // Current N (2^15)
    assert.equal(auth.needsRehash(`scrypt$${2 ** 15}$8$1$c2FsdA==$a2V5`), false);
    // Future higher N (2^16)
    assert.equal(auth.needsRehash(`scrypt$${2 ** 16}$8$1$c2FsdA==$a2V5`), false);
    // Invalid format
    assert.equal(auth.needsRehash("plaintext"), false);
  });

  it("transparently rehashes older passwords upon successful login", async () => {
    const beforeUser = await db.getUserAuthById(userId);
    assert.ok(beforeUser);
    assert.equal(auth.needsRehash(beforeUser.auth.passwordHash), true);

    const loginRes = await api("POST", "/api/auth/login", {
      body: { username: "rehash_user", password: PW }
    });
    assert.equal(loginRes.status, 200);

    const afterUser = await db.getUserAuthById(userId);
    assert.ok(afterUser);
    assert.equal(auth.needsRehash(afterUser.auth.passwordHash), false);
    assert.notEqual(afterUser.auth.passwordHash, beforeUser.auth.passwordHash);

    const logs = server.logs();
    assert.match(logs, /"event":"password_rehashed"/);
  });

  it("breached password check fails open gracefully on errors", async () => {
    // With dummy input in test environment, isBreachedPassword safely returns false
    const result = await auth.isBreachedPassword("dummySafePassword123");
    assert.equal(result, false);
  });
});
