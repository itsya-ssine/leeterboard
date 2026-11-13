import type { ReactNode } from "react";
import LegalPage from "./LegalPages.js";
import FaqPage from "./FaqPage.js";
import { isFaqPath } from "./faq.js";
import { legalPageFromPath } from "./legal.js";

// Sits OUTSIDE the landing page and the sign-in gate. /privacy and /terms must
// be readable by anyone, signed in or not (Google's OAuth reviewers included),
// and /faq ("How scoring works") is public for the same reason: a visitor deciding
// whether to sign up should be able to read how the board works. For those three
// paths nothing else renders: no session check, no API calls. Every other path
// falls through to the app untouched.
//
// The path is read once. These pages are reached by an ordinary link (a full
// page load), so there is no navigation to listen for.
export default function LegalGate({ children }: { children: ReactNode }) {
  const page = legalPageFromPath(window.location.pathname);
  if (page) return <LegalPage page={page} />;
  if (isFaqPath(window.location.pathname)) return <FaqPage />;
  return <>{children}</>;
}
