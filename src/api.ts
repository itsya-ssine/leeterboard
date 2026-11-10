// Global handling of "your session is gone".
//
// The server answers 401 with code "session_required" whenever a request needs
// a signed-in member and has none (the 7-day session ran out, the member
// logged out on another device, their password was changed elsewhere, the
// account was deleted). Every call in the app goes through window.fetch, so one
// wrapper catches all of them, instead of each component having to remember to.
//
// A 401 WITHOUT that code is something else (a wrong password on the login form
// or when confirming a password change) and must not sign anyone out, which is
// why the code is checked and not just the status.

// The same string as SESSION_REQUIRED_CODE in auth.ts (tests keep them equal;
// auth.ts can't be imported into the browser bundle).
export const SESSION_REQUIRED_CODE = "session_required";

export const SESSION_ENDED_MESSAGE = "Your session has ended. Please log in again.";

type FetchHost = { fetch: typeof fetch };

function isApiRequest(input: RequestInfo | URL, base: string): boolean {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, base);
    return url.origin === new URL(base).origin && url.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

async function saysSessionRequired(res: Response): Promise<boolean> {
  try {
    const body = await res.clone().json();
    return body?.code === SESSION_REQUIRED_CODE;
  } catch {
    return false; // not JSON: a proxy error page, say
  }
}

/**
 * Wraps `host.fetch` so that a session-required 401 on an /api/ request calls
 * `onExpired(epoch)`. `epoch` is what `getEpoch()` returned when the request
 * STARTED, so the caller can ignore a late 401 that belongs to a session that
 * has since been replaced (log out, then log in again while an old poll was in
 * flight). Returns a function that removes the wrapper.
 */
export function installSessionExpiryHandler(
  getEpoch: () => number,
  onExpired: (epoch: number) => void,
  host: FetchHost = window,
  base: string = window.location.href
): () => void {
  const original = host.fetch;
  const wrapped: typeof fetch = async (input, init) => {
    const epoch = getEpoch();
    const res = await original.call(host, input, init);
    if (res.status === 401 && isApiRequest(input, base) && (await saysSessionRequired(res))) onExpired(epoch);
    return res;
  };
  host.fetch = wrapped;
  return () => {
    if (host.fetch === wrapped) host.fetch = original;
  };
}
