export const MAX_DISPLAY_NAME_LENGTH = 40;
export const MAX_SCHOOL_LENGTH = 60;
export const MAX_BIO_LENGTH = 200;
export const MAX_LINK_LENGTH = 200;

export function cleanDisplayName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH);
  return v || fallback;
}

export function cleanSchool(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SCHOOL_LENGTH);
}

export function cleanBio(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_BIO_LENGTH);
}

export function cleanLink(
  value: string,
  label: string,
  hosts: string[] | null
): { value: string } | { error: string } {
  const trimmed = value.replace(/[\u0000-\u001f\u007f\s]/g, "");
  if (!trimmed) return { value: "" };
  if (trimmed.length > MAX_LINK_LENGTH) return { error: `${label} link is too long.` };

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: `${label} link isn't a valid web address.` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { error: `${label} link must start with https://.` };
  }
  if (url.username || url.password) {
    return { error: `${label} link can't contain a username or password.` };
  }
  const host = url.hostname.toLowerCase();
  if (hosts) {
    if (!hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      return { error: `${label} link must be a ${hosts[0]} address.` };
    }
    url.protocol = "https:";
  } else if (!host.includes(".") || /^[\d.]+$/.test(host)) {
    return { error: `${label} link must be a website address like example.com.` };
  }
  return { value: url.href.slice(0, MAX_LINK_LENGTH) };
}

export const LINK_FIELDS = [
  { body: "github", key: "githubUrl", label: "GitHub", hosts: ["github.com"] },
  { body: "linkedin", key: "linkedinUrl", label: "LinkedIn", hosts: ["linkedin.com"] },
  { body: "website", key: "websiteUrl", label: "Website", hosts: null }
] as const;

export function defaultAvatar(name: string): string {
  const letter = (name.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">` +
    `<rect width="120" height="120" fill="#171c25"/>` +
    `<text x="60" y="60" dy=".35em" text-anchor="middle" font-family="sans-serif" ` +
    `font-size="56" font-weight="600" fill="#2dd4bf">${letter}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
