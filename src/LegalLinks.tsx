import { LEGAL_PATHS } from "./legal.js";

// "Privacy Policy" and "Terms of Service" links, reused wherever the site needs
// them: the landing page, the sign-in form and (later) a site-wide footer.
//
// They are plain links to real paths, so they work for someone who hasn't
// signed in, in a new tab, or pasted into Google's OAuth consent screen.
// `newTab` keeps a half-finished sign-up open while the policy is read.
export default function LegalLinks({
  newTab = false,
  className = "",
  linkClassName = ""
}: {
  newTab?: boolean;
  className?: string;
  linkClassName?: string;
}) {
  const target = newTab ? { target: "_blank", rel: "noopener noreferrer" } : {};
  return (
    <span className={className}>
      <a href={LEGAL_PATHS.privacy} className={linkClassName} {...target}>
        Privacy Policy
      </a>
      <span aria-hidden="true"> · </span>
      <a href={LEGAL_PATHS.terms} className={linkClassName} {...target}>
        Terms of Service
      </a>
    </span>
  );
}
