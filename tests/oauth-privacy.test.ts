/**
 * E-mail privacy across the whole app. Runs real flows (sign-ups through Google
 * and GitHub, a sign-up left open, a sign-up refused because the address is
 * already a member's) and then looks everywhere an address, a provider code or a
 * client secret could have leaked to: what other members, an admin and a visitor
 * can read, every log line, and the tables that hold pending rows and rate-limit
 * counters.
 *
 * The addresses and their local parts are distinctive on purpose, so a leak of
 * any piece of one is found by a plain substring search.
 */
import { createClient } from "@libsql/client";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { makeFakeOAuth, mergeEnv, OAUTH_TEST_ENV } from "./f2-seed.js";
import { approveViaOAuth, client, signUpViaOAuth, startServer, type ApiResult, type TestServer } from "./helpers.js";

const VICTIM = "privacytarget.alpha@example.com";
const OPEN_SIGNUP = "privacytarget.charlie@example.com"; // a provider step that is never finished
const VIEWER = "privacyviewer.omega@example.com";
const ADMIN = "privacyadmin.sigma@example.com";
const ADDRESSES = [VICTIM, OPEN_SIGNUP];
const LOCAL_PARTS = ADDRESSES.map((a) => a.split("@")[0]);
// What nobody but the member may ever be shown: the address and its local part.
const VICTIM_PROBES = [VICTIM, ...LOCAL_PARTS];
const SECRETS = [OAUTH_TEST_ENV.GITHUB_CLIENT_SECRET, OAUTH_TEST_ENV.GOOGLE_CLIENT_SECRET];

let server: TestServer;
let api: ReturnType<typeof client>;
const fake = makeFakeOAuth();
// Remember every authorization code the fake provider hands out, to look for them later.
const issued: string[] = [];
const recording = {
  issueCode: (...args: Parameters<typeof fake.issueCode>) => {
    const code = fake.issueCode(...args);
    issued.push(code);
    return code;
  }
};

let ipSeq = 0;
const ip = () => ({ "x-forwarded-for": `10.70.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}` });

const query = async (sql: string, args: (string | number)[] = []) => {
  const c = createClient({ url: server.dbUrl });
  try {
    await c.execute("PRAGMA busy_timeout = 5000");
    await c.execute("PRAGMA journal_mode = WAL");
    return (await c.execute({ sql, args })).rows.map((r) => ({ ...r }));
  } finally {
    c.close();
  }
};
// The test server treats the member whose LeetCode name is "test_admin" as an admin.
const makeAdmin = async (id: string) => {
  const c = createClient({ url: server.dbUrl });
  try {
    await c.execute("PRAGMA busy_timeout = 5000");
    await c.execute("UPDATE users SET leetcode_username = NULL WHERE lower(leetcode_username) = 'test_admin'");
    await c.execute({ sql: "UPDATE users SET leetcode_username = 'test_admin' WHERE id = ?", args: [id] });
  } finally {
    c.close();
  }
};

interface Member {
  id: string;
  cookie: string;
}
const signUp = async (username: string, email: string, provider: "github" | "google" = "github"): Promise<Member> => {
  const res = await signUpViaOAuth(api, recording, { username, email, provider });
  assert.equal(res.status, 201, res.text);
  return { id: res.json.id, cookie: res.cookie! };
};

const get = (route: string, cookie: string | null): Promise<ApiResult> => api("GET", route, { cookie, headers: ip() });
const leaks = (text: string, probes: string[]) => probes.filter((p) => text.toLowerCase().includes(p.toLowerCase()));

let victim: Member;
let viewer: Member;
let admin: Member;

before(async () => {
  server = await startServer(mergeEnv(fake.env, { ...OAUTH_TEST_ENV, ALLOWED_EMAIL_DOMAINS: "" }));
  api = client(server);

  // Three members through the real flow, then the traffic that leaves traces.
  victim = await signUp("victimuser", VICTIM, "github");
  viewer = await signUp("viewermember", VIEWER, "google");
  admin = await signUp("adminmember", ADMIN, "github");
  await makeAdmin(admin.id);

  // A sign-up that is started and left open (the member never picks a username).
  const open = await approveViaOAuth(api, recording, { email: OPEN_SIGNUP });
  assert.equal(open.location, "/#/signup/username");

  // A sign-up for an address that is already a member's: refused, nothing created.
  const taken = await approveViaOAuth(api, recording, { email: VICTIM, provider: "google" });
  assert.match(taken.location, /oauth_error=email_in_use/);
});

after(async () => {
  await server.stop();
  fake.cleanup();
});

describe("what other members, an admin and a visitor can read", () => {
  const SURFACES: [string, string][] = [
    ["GET", "/api/users"],
    ["GET", "/api/trends"],
    ["GET", "/api/trends?platform=codeforces"],
    ["GET", "/api/notifications"],
    ["GET", "/api/auth/session"]
  ];
  const ADMIN_SURFACES = ["/api/admin/sync-status", "/api/admin/feedback", "/api/admin/notifications"];

  it("the board and every other page another member can read hold no part of the victim's address", async () => {
    for (const [, route] of SURFACES) {
      const res = await get(route, viewer.cookie);
      assert.ok(res.status < 500, `${route} -> ${res.status}`);
      assert.deepEqual(leaks(res.text, VICTIM_PROBES), [], route);
    }
    // The victim IS on the board the viewer reads (this would be vacuous otherwise).
    const users = await get("/api/users", viewer.cookie);
    assert.equal(users.status, 200);
    assert.ok(users.json.users.some((u: any) => u.id === victim.id));
  });

  it("the board has no email field at all, not even an empty one, for anyone", async () => {
    for (const cookie of [viewer.cookie, admin.cookie, victim.cookie]) {
      const users = await get("/api/users", cookie);
      assert.equal(users.status, 200);
      assert.doesNotMatch(users.text, /"email/i);
    }
  });

  it("the admin tables hold no address of any member", async () => {
    for (const route of ADMIN_SURFACES) {
      const res = await get(route, admin.cookie);
      assert.equal(res.status, 200, `${route} -> ${res.status}: ${res.text.slice(0, 200)}`);
      assert.deepEqual(leaks(res.text, [...VICTIM_PROBES, VIEWER, "privacyviewer"]), [], route);
    }
    const sync = await get("/api/admin/sync-status", admin.cookie);
    assert.doesNotMatch(sync.text, /"email/i);
  });

  it("an admin's board and session show the admin's own address at most, never a member's", async () => {
    const users = await get("/api/users", admin.cookie);
    assert.deepEqual(leaks(users.text, [...VICTIM_PROBES, VIEWER]), []);
    const session = await get("/api/auth/session", admin.cookie);
    assert.equal(session.json.user.email, ADMIN);
    assert.deepEqual(leaks(session.text, [...VICTIM_PROBES, VIEWER]), []);
  });

  it("the session answers a member with their OWN address, and nobody else with it", async () => {
    const own = await get("/api/auth/session", victim.cookie);
    assert.equal(own.json.user.email, VICTIM);
    assert.equal(own.json.user.emailVerified, true);
    const viewerSession = await get("/api/auth/session", viewer.cookie);
    assert.equal(viewerSession.json.user.email, VIEWER);
    assert.deepEqual(leaks(viewerSession.text, VICTIM_PROBES), []);
    const guest = await get("/api/auth/session", null);
    assert.equal(guest.json.status, "guest");
    assert.deepEqual(leaks(guest.text, [...VICTIM_PROBES, VIEWER]), []);
  });

  it("a visitor gets no member data at all, so no address", async () => {
    for (const [, route] of [...SURFACES.filter(([, r]) => r !== "/api/auth/session"), ...ADMIN_SURFACES.map((r): [string, string] => [ "GET", r])]) {
      const res = await get(route, null);
      assert.equal(res.status, 401, route);
      assert.deepEqual(leaks(res.text, [...VICTIM_PROBES, VIEWER]), [], route);
    }
  });

  it("the pending sign-up and its address are not readable through any route", async () => {
    const res = await get("/api/auth/oauth/pending", null);
    assert.equal(res.status, 400);
    assert.deepEqual(leaks(res.text, VICTIM_PROBES), []);
  });
});

describe("the logs", () => {
  it("hold no address, no part of one, no provider code, no token and no client secret", () => {
    const logs = server.logs();
    assert.ok(logs.length > 0, "the server logged something");
    for (const address of [...ADDRESSES, VIEWER, ADMIN]) {
      assert.equal(logs.toLowerCase().includes(address), false, `address in the logs: ${address}`);
      assert.equal(logs.toLowerCase().includes(address.split("@")[0]), false, `local part in the logs: ${address}`);
    }
    for (const secret of SECRETS) assert.equal(logs.includes(secret), false, "a client secret is in the logs");
    assert.ok(issued.length >= 5, "the flows used several provider codes");
    for (const code of issued) {
      assert.equal(logs.includes(code), false, `provider code ${code} is in the logs`);
      assert.equal(logs.includes(`fake-github-token-${code}`), false, `github token for ${code} in logs`);
      assert.equal(logs.includes(`fake-google-token-${code}`), false, `google token for ${code} in logs`);
    }
    assert.equal(logs.includes("fake-github-token"), false, "github token in logs");
    assert.equal(logs.includes("fake-google-token"), false, "google token in logs");
  });

  it("do say what happened, with the masked address only", () => {
    const logs = server.logs();
    assert.match(logs, /"event":"account_created"/);
    assert.match(logs, /"event":"oauth_failed"/);
    assert.match(logs, /"maskedEmail":"p\*\*\*@example\.com"/);
  });
});

describe("what is stored", () => {
  it("keeps an address in a pending row only for the sign-up that is still open, lowercase", async () => {
    const rows = await query("SELECT email FROM pending_oauth_signups");
    assert.deepEqual(rows.map((r) => r.email), [OPEN_SIGNUP]);
  });

  it("keeps no authorization code or token in the state or pending tables", async () => {
    const stored = JSON.stringify([...(await query("SELECT * FROM oauth_states")), ...(await query("SELECT * FROM pending_oauth_signups"))]);
    for (const code of issued) {
      assert.equal(stored.includes(code), false, `code ${code} stored`);
      assert.equal(stored.includes(`fake-github-token-${code}`), false, `github token for ${code} stored`);
      assert.equal(stored.includes(`fake-google-token-${code}`), false, `google token for ${code} stored`);
    }
    for (const secret of SECRETS) assert.equal(stored.includes(secret), false, "a client secret is stored");
    assert.equal(stored.includes("fake-github-token"), false, "github token stored");
    assert.equal(stored.includes("fake-google-token"), false, "google token stored");
  });

  it("keeps no address or local part in the rate-limit counters", async () => {
    const rows = JSON.stringify(await query("SELECT * FROM rate_limits"));
    assert.ok(rows.length > 2, "the flows were counted");
    assert.deepEqual(leaks(rows, [...ADDRESSES, VIEWER, ADMIN, ...LOCAL_PARTS, "privacyviewer", "privacyadmin"]), []);
  });

  it("keeps an address only in users.email (lowercase) for the members whose provider verified it", async () => {
    const rows = await query("SELECT email FROM users WHERE email IS NOT NULL ORDER BY email");
    assert.deepEqual(rows.map((r) => r.email), [ADMIN, VICTIM, VIEWER].sort());
  });

  it("keeps no identity for a sign-up that was refused", async () => {
    assert.equal((await query("SELECT 1 FROM oauth_identities WHERE provider = 'google'")).length, 1, "only the viewer's own Google identity");
  });
});
