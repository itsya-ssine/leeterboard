import type { ReactNode } from "react";
import LegalPage from "./LegalPages.js";
import { legalPageFromPath } from "./legal.js";

// Sits OUTSIDE the landing page and the sign-in gate. /privacy and /terms must
// be readable by anyone, signed in or not (Google's OAuth reviewers included),
// so for those two paths nothing else renders: no session check, no API calls.
// Every other path falls through to the app untouched.
//
// The path is read once. These pages are reached by an ordinary link (a full
// page load), so there is no navigation to listen for.
export default function LegalGate({ children }: { children: ReactNode }) {
  const page = legalPageFromPath(window.location.pathname);
  if (page) return <LegalPage page={page} />;
  return <>{children}</>;
}
