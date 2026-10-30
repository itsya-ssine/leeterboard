/**
 * F3 regression: self-hosted deployments.
 *
 *  (a) `npm start` must run in production mode (CSP, HSTS, Secure cookies)
 *      without anyone setting NODE_ENV, and must not boot the Vite dev server
 *      on a hosting platform by accident.
 *  (b) The server bundle must never be downloadable: it is built outside the
 *      folder the server serves.
 *
 * The last block really builds the app and runs the bundle the way a naive
 * host does (NODE_ENV unset). It writes dist/client and server-dist/, the same
 * folders `npm run build` always writes, and takes a few seconds.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { HOSTING_SIGNALS, decideRuntime, findServerCode } from "../runtimeEnvPolicy.js";

const root = path.resolve(import.meta.dirname, "..");

describe("decideRuntime", () => {
  it("always runs the production bundle in production mode, whatever NODE_ENV says", () => {
    for (const nodeEnv of [undefined, "", "development", "test", "production"]) {
      const d = decideRuntime({ NODE_ENV: nodeEnv }, true);
      assert.equal(d.forceProduction, true, `NODE_ENV=${nodeEnv}`);
      assert.equal(d.fatal, null);
    }
    const warned = decideRuntime({ NODE_ENV: "development" }, true);
    assert.match(warned.warnings.join(" "), /Ignoring NODE_ENV="development"/);
    assert.deepEqual(decideRuntime({ NODE_ENV: "production" }, true).warnings, []);
  });

  it("leaves an explicit NODE_ENV=production alone", () => {
    assert.deepEqual(decideRuntime({ NODE_ENV: "production", RENDER: "true" }, false), {
      forceProduction: false,
      warnings: [],
      fatal: null
    });
  });

  it("treats Vercel without NODE_ENV as production", () => {
    assert.equal(decideRuntime({ VERCEL: "1" }, false).forceProduction, true);
  });

  it("refuses to start the dev server on a hosting platform when NODE_ENV is unset", () => {
    for (const signal of HOSTING_SIGNALS) {
      for (const unset of [undefined, "", "  "]) {
        const d = decideRuntime({ [signal]: "1", NODE_ENV: unset }, false);
        assert.ok(d.fatal, `${signal} with NODE_ENV=${JSON.stringify(unset)} must be fatal`);
        assert.match(d.fatal!, new RegExp(signal));
        assert.match(d.fatal!, /npm run build && npm start/);
      }
    }
  });

  it("only warns when someone sets a non-production NODE_ENV on purpose", () => {
    const d = decideRuntime({ RENDER: "true", NODE_ENV: "development" }, false);
    assert.equal(d.fatal, null);
    assert.equal(d.forceProduction, false);
    assert.match(d.warnings.join(" "), /set explicitly/);
  });

  it("stays quiet for plain local development, warns when it looks deployed", () => {
    assert.deepEqual(decideRuntime({}, false), { forceProduction: false, warnings: [], fatal: null });
    assert.deepEqual(decideRuntime({ TURSO_DATABASE_URL: "file:local.db" }, false).warnings, []);
    assert.match(decideRuntime({ PORT: "8080" }, false).warnings.join(" "), /Vite dev server/);
    assert.match(
      decideRuntime({ TURSO_DATABASE_URL: "libsql://db.turso.io" }, false).warnings.join(" "),
      /Vite dev server/
    );
  });
});

describe("findServerCode", () => {
  it("flags server bundles, sourcemaps and TypeScript in a static folder, but not frontend assets", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-static-"));
    try {
      fs.mkdirSync(path.join(dir, "assets"));
      for (const f of ["index.html", "assets/index-abc.js", "assets/index-abc.css", "favicon.svg"]) {
        fs.writeFileSync(path.join(dir, f), "x");
      }
      assert.deepEqual(findServerCode(dir), []);

      for (const f of ["server.cjs", "server.cjs.map", "assets/db.ts", "server.js"]) {
        fs.writeFileSync(path.join(dir, f), "x");
      }
      assert.deepEqual(findServerCode(dir).sort(), ["assets/db.ts", "server.cjs", "server.cjs.map", "server.js"].sort());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("package.json scripts", () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts;

  it("builds the server outside the served frontend folder, and `start` runs it", () => {
    assert.match(scripts.build, /vite build --outDir dist\/client/);
    assert.match(scripts.build, /--outfile=server-dist\/server\.cjs/);
    assert.match(scripts.build, /--define:__PRODUCTION_BUNDLE__=true/);
    assert.doesNotMatch(scripts.build, /--outfile=dist\//);
    assert.match(scripts.start, /server-dist\/server\.cjs/);
  });

  it("keeps the Vercel build frontend-only", () => {
    assert.doesNotMatch(scripts["vercel-build"], /esbuild|server/);
  });
});

describe("the built production bundle (real build, NODE_ENV unset)", () => {
  const children: ChildProcess[] = [];
  let tmpDir = "";

  const freePort = () =>
    new Promise<number>((resolve, reject) => {
      const srv = net.createServer();
      srv.once("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const { port } = srv.address() as net.AddressInfo;
        srv.close(() => resolve(port));
      });
    });

  // NODE_ENV is set to "" rather than removed so a developer's .env can't fill it in.
  const baseEnv = (port: number, nodeEnv = ""): NodeJS.ProcessEnv => ({
    ...process.env,
    NODE_ENV: nodeEnv,
    VERCEL: "",
    PORT: String(port),
    JWT_SECRET: crypto.randomBytes(48).toString("hex"),
    TURSO_DATABASE_URL: `file:${path.join(tmpDir, `db-${port}.db`)}`,
    TURSO_AUTH_TOKEN: ""
  });

  async function startBundle(nodeEnv = ""): Promise<{ url: string; logs: () => string }> {
    const port = await freePort();
    const child = spawn(process.execPath, ["server-dist/server.cjs"], {
      cwd: root,
      env: baseEnv(port, nodeEnv),
      stdio: ["ignore", "pipe", "pipe"]
    });
    children.push(child);
    let logs = "";
    child.stdout!.on("data", (d) => (logs += d));
    child.stderr!.on("data", (d) => (logs += d));

    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`bundle exited early (${child.exitCode}):\n${logs}`);
      try {
        await fetch(url + "/");
        return { url, logs: () => logs };
      } catch {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    throw new Error(`bundle didn't start in time:\n${logs}`);
  }

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "leeterboard-f3-"));
    const build = spawnSync("npm", ["run", "build"], { cwd: root, encoding: "utf8", timeout: 180_000 });
    assert.equal(build.status, 0, `npm run build failed:\n${build.stdout}\n${build.stderr}`);
  });

  after(async () => {
    for (const child of children) child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes the server bundle outside the folder that gets served", () => {
    assert.ok(fs.existsSync(path.join(root, "server-dist", "server.cjs")));
    assert.ok(fs.existsSync(path.join(root, "dist", "client", "index.html")));
    assert.deepEqual(findServerCode(path.join(root, "dist", "client")), []);
  });

  it("runs in production mode without NODE_ENV: CSP and HSTS are sent", async () => {
    const { url } = await startBundle("");
    const res = await fetch(url + "/");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    assert.ok(res.headers.get("strict-transport-security"), "HSTS is only sent in production mode");
  });

  it("does not hand out the backend source, however the path is spelled", async () => {
    const { url } = await startBundle("");
    const paths = [
      "/server.cjs",
      "/server.cjs.map",
      "/server-dist/server.cjs",
      "/server-dist/server.cjs.map",
      "/dist/server.cjs",
      "/dist/server.cjs.map",
      "/%2e%2e/server-dist/server.cjs",
      "/assets/../../server-dist/server.cjs"
    ];
    for (const p of paths) {
      const res = await fetch(url + p, { redirect: "manual" });
      const body = await res.text();
      assert.doesNotMatch(body, /__commonJS|__defProp|__toESM|require\("express"\)/, `${p} leaked server code`);
      assert.doesNotMatch(res.headers.get("content-type") ?? "", /javascript|json|octet-stream/, `${p}`);
    }
  });

  it("stays in production mode even if the host sets NODE_ENV=development", async () => {
    const { url, logs } = await startBundle("development");
    const res = await fetch(url + "/");
    assert.ok(res.headers.get("content-security-policy"));
    assert.match(logs(), /Ignoring NODE_ENV="development"/);
  });

  it("still starts, API only and with a warning, when there is no frontend build", async () => {
    // Run from an empty folder so dist/client doesn't exist. (The test suite
    // itself runs before any build in CI, so this must never be fatal.)
    const emptyCwd = fs.mkdtempSync(path.join(tmpDir, "no-build-"));
    const port = await freePort();
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), path.join(root, "server.ts")], {
      cwd: emptyCwd,
      env: { ...baseEnv(port, "production") },
      stdio: ["ignore", "pipe", "pipe"]
    });
    children.push(child);
    let logs = "";
    child.stdout!.on("data", (d) => (logs += d));
    child.stderr!.on("data", (d) => (logs += d));

    let status = 0;
    const deadline = Date.now() + 30_000;
    while (!status && Date.now() < deadline) {
      if (child.exitCode !== null) assert.fail(`server exited (${child.exitCode}):\n${logs}`);
      try {
        status = (await fetch(`http://127.0.0.1:${port}/api/auth/session`)).status;
      } catch {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    assert.ok(status > 0, `server didn't answer:\n${logs}`);
    assert.match(logs, /No frontend build found/);
  });

  it("the TypeScript source refuses to boot the dev server on a hosting platform", () => {
    const run = spawnSync(process.execPath, ["--import", "tsx", "server.ts"], {
      cwd: root,
      env: { ...baseEnv(0), RENDER: "true" },
      encoding: "utf8",
      timeout: 60_000
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Refusing to start/);
    assert.match(run.stderr, /NODE_ENV/);
  });
});
