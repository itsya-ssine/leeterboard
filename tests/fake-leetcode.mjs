// Preloaded into the TEST server process only (NODE_OPTIONS=--import <this file>).
//
// Answers the one LeetCode call the ownership check makes
// (POST https://leetcode.com/graphql, matchedUser) from files in
// $FAKE_LEETCODE_DIR, so tests can prove "the person really did put the code in
// their LeetCode summary" without touching the network:
//
//   <dir>/<username lower-cased>.txt  -> the user exists, summary = file content
//   no such file                      -> LeetCode says the user doesn't exist
//
// Every other request goes to the real fetch.
import fs from "node:fs";
import path from "node:path";

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : (input?.url ?? String(input));
  if (url === "https://leetcode.com/graphql" && process.env.FAKE_LEETCODE_DIR) {
    const { variables } = JSON.parse(String(init?.body ?? "{}"));
    const name = String(variables?.username ?? "");
    const file = path.join(process.env.FAKE_LEETCODE_DIR, `${name.toLowerCase()}.txt`);
    const matchedUser = fs.existsSync(file)
      ? { username: name, profile: { aboutMe: fs.readFileSync(file, "utf8") } }
      : null;
    return new Response(JSON.stringify({ data: { matchedUser } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  return realFetch(input, init);
};
