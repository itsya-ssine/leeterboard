# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Leeterboard, please **do not open a public issue**. Instead, report it privately through one of the following channels:

1. **GitHub Security Advisory (Recommended):** Use GitHub's [Report a vulnerability](https://github.com/itsya-ssine/leeterboard/security/advisories/new) button under the repository's **Security** tab.
2. **Email:** Contact the project maintainers directly at `security@leeterboard.org` (or reach out privately to the repository owner).

### What to include

- A detailed description of the vulnerability and its potential impact.
- Step-by-step reproduction instructions or a minimal proof-of-concept.
- Any suggested remediations or mitigations if you have them.

### Response Timeline

- **Initial acknowledgment:** Within 72 hours.
- **Assessment and triage:** Within 7 business days.
- **Fix and disclosure:** We coordinate disclosure dates with reporters once a patch is tested and deployed.

## Supported Versions

Only the latest commit on the `main` branch is actively supported with security updates.

| Branch / Release | Supported |
| --- | --- |
| `main` | :white_check_mark: |
| Older releases / forks | :x: |

## Security Architecture Highlights

Leeterboard employs defensive, layered security controls:
- **Zero-knowledge verification:** LeetCode account ownership is proven through first-party GraphQL verification only.
- **Fail-closed credentials:** High-entropy JWT secrets, scrypt password hashing with constant-time verification, and automatic session stamps.
- **Strict CSRF protection:** Multi-layered verification checking Origin, `Sec-Fetch-Site`, Referer, and Content-Type.
- **Rate limiting:** Database-backed token-bucket limiters for sensitive actions (authentication, profile linking, feedback).
- **Hardened headers:** Strict Content-Security-Policy (CSP) with script hashing, HSTS, frame isolation, and MIME sniffing protection.
