import type { SessionStatus } from "../../../AuthContext.js";

// What the site shows for each state of the session check. Nothing but the
// sign-in screen is rendered without a session, and the app (which is what
// loads members, trends and polls the server) is not even mounted: the API
// answers 401 to a visitor, so there would be nothing to show anyway, and
// hiding the UI is only a convenience on top of that.
//
//   loading        the first /api/auth/session call hasn't answered yet; show a
//                  spinner, never the sign-in form (a signed-in member would
//                  see it flash).
//   guest          no valid session: sign-in screen only.
//   authenticated  the app.
export type GateView = "loading" | "auth" | "app";

export function gateView(status: SessionStatus): GateView {
  if (status === "authenticated") return "app";
  if (status === "guest") return "auth";
  return "loading";
}
