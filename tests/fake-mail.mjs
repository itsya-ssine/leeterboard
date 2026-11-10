// Preloaded into the TEST server process only (NODE_OPTIONS=--import <this file>).
//
// Stands in for Resend (POST https://api.resend.com/emails), the same way
// fake-leetcode.mjs stands in for LeetCode. The server under test therefore runs
// in production mode with the REAL "resend" provider code; only the network is
// faked. (The development-only "outbox" provider is refused in production, so
// tests must not use it.)
//
// Every accepted message is written as one JSON file in $FAKE_MAIL_DIR:
//
//   <dir>/<sortable name>.json   {"to","from","subject","text","sentAt"}
//
// Two marker files change what the fake answers, so tests can prove the
// failure paths:
//
//   <dir>/_down       -> HTTP 500 for every send (provider outage)
//   <dir>/_reject     -> HTTP 422 for every send (e.g. sender domain not verified)
//
// A request without "Authorization: Bearer ..." gets 401, like the real API.
// Every other request goes to the real fetch.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const realFetch = globalThis.fetch;
let sequence = 0;

const reply = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function headerOf(init, name) {
  const h = init?.headers;
  if (!h) return null;
  if (typeof h.get === "function") return h.get(name);
  for (const [k, v] of Object.entries(h)) if (k.toLowerCase() === name.toLowerCase()) return String(v);
  return null;
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : (input?.url ?? String(input));
  const dir = process.env.FAKE_MAIL_DIR;
  if (url === "https://api.resend.com/emails" && dir) {
    if (!/^Bearer \S+$/.test(headerOf(init, "authorization") ?? "")) {
      return reply(401, { statusCode: 401, name: "missing_api_key", message: "Missing API key." });
    }
    if (fs.existsSync(path.join(dir, "_down"))) {
      return reply(500, { statusCode: 500, name: "application_error", message: "Provider outage." });
    }
    if (fs.existsSync(path.join(dir, "_reject"))) {
      return reply(422, { statusCode: 422, name: "validation_error", message: "The sender domain is not verified." });
    }
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (!body.from || !body.to || !body.subject || !body.text) {
      return reply(422, { statusCode: 422, name: "missing_required_field", message: "Missing field." });
    }
    const to = Array.isArray(body.to) ? body.to[0] : body.to;
    const name = [
      String(Date.now()).padStart(13, "0"),
      String(++sequence).padStart(6, "0"),
      crypto.randomBytes(4).toString("hex")
    ].join("-");
    fs.writeFileSync(
      path.join(dir, `${name}.json`),
      JSON.stringify({ to, from: body.from, subject: body.subject, text: body.text, sentAt: new Date().toISOString() })
    );
    return reply(200, { id: crypto.randomUUID() });
  }
  return realFetch(input, init);
};
