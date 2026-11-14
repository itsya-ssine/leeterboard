// Must stay the first import: it fixes NODE_ENV before the modules below read it.
import "./runtimeEnv.js";
import app from "./server/server.js";

export type AboutLookup =
  | { status: "ok"; username: string; aboutMe: string }
  | { status: "not_found" }
  | { status: "unavailable" };

// F1 security regression test (tests/ownership-source.test.ts) inspects this source text directly.
// LeetCode account ownership proof must only ever be verified directly against official LeetCode GraphQL.
export async function fetchLeetCodeAbout(username: string): Promise<AboutLookup> {
  let notFound = false;

  try {
    const query = `
      query userAbout($username: String!) {
        matchedUser(username: $username) {
          username
          profile {
            aboutMe
          }
        }
      }
    `;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Referer": "https://leetcode.com",
        "Origin": "https://leetcode.com"
      },
      body: JSON.stringify({ query, variables: { username } }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const json: any = await response.json();
      const matched = json?.data?.matchedUser;
      if (matched) {
        return {
          status: "ok",
          username: String(matched.username || username),
          aboutMe: String(matched.profile?.aboutMe ?? "")
        };
      }
      if (json?.data && matched === null) notFound = true;
    }
  } catch (err: any) {
    console.warn(`[Auth] LeetCode GraphQL profile lookup failed: ${err.message}`);
  }

  return notFound ? { status: "not_found" } : { status: "unavailable" };
}

export default app;
