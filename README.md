# Leeterboard

A competitive-programming leaderboard for a group of friends, a class or a club. Members sign up with **Google or GitHub** and choose a public username (the provider verifies their email address), then link any of their **LeetCode**, **Codeforces** and **CodinGame** accounts (all optional). Members who joined earlier can still sign in with a password and connect Google or GitHub in Account settings. Everything is for signed-in members only. The app tracks solved counts, weekly and monthly progress, streaks, contest ratings and badges, and ranks everyone on live boards with a podium, weekly winners, profiles and head-to-head comparisons.

## Contents

- [Features](#features)
- [Pages](#pages)
- [Platforms](#platforms)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Provider setup](#provider-setup)
- [Configuration](#configuration)
- [Accounts](#accounts)
- [Account settings](#account-settings)
- [Linked accounts](#linked-accounts)
- [Badges and tiers](#badges-and-tiers)
- [Themes](#themes)
- [Security](#security)
- [Data syncing](#data-syncing)
- [Sync health (admins)](#sync-health-admins)
- [Database](#database)
- [Notifications](#notifications)
- [Feedback](#feedback)
- [API](#api)
- [Rate limits](#rate-limits)
- [Scripts](#scripts)
- [Project structure](#project-structure)
- [Deployment](#deployment)

## Features

**Boards and rankings**

- **LeetCode leaderboard** ranked by weekly progress, all-time solved, or contest rating, with search, pinned members and a shareable URL (`?sort=weekly&q=ali`). Only members who linked LeetCode are on it
- **Codeforces and CodinGame boards**, one per platform, for members who linked an account (see [Platforms](#platforms))
- **Top-3 podium** for whichever ranking is selected, with gold, silver and bronze styling
- **Rank movement arrows** (▲/▼) showing how many places a member has climbed or dropped since last week, with a NEW tag for members who just joined
- **Live round clock** counting down to Monday 00:00 UTC, when the weekly round closes, plus a scrolling feed of this week's solvers
- **Live data**: the board polls every 15 seconds while the tab is visible, so new stats appear without a reload
- **Freshness indicators** that flag members whose data has stopped updating

**Weekly winners**

- **Winner banner** showing last week's top solver, and a **hall of fame** listing each past winner once, with the number of weeks they were the top solver. Weeks run Monday to Sunday (UTC) and are scored from the daily snapshots. Winners are archived, so the hall of fame outlasts the 60 days of stored history

**Profiles and comparison**

- **Member profile pages** (`#/u/<username>`) with key stats, a progress chart, a difficulty split compared with the board, a per-day activity chart, weekly sprints, weekday rhythm, standing in every category, weekly wins and badges. A toggle switches between the platforms the member linked (LeetCode, Codeforces, CodinGame); a member with nothing linked yet gets a short note instead of empty charts
- **Tier avatar frames**: a member's avatar is framed by their contest-rating tier, from a plain ring up to a glowing, turning frame for Grandmasters
- **Compare page** (`#/compare`): pick any two members who linked LeetCode for a head-to-head view with every stat side by side (solved counts by difficulty, weekly and monthly progress, contest rating, streaks), who is ahead in each, and both members' solved counts over time on one chart. The URL is shareable, and the profile of every member with LeetCode has a Compare button
- **Compare card**: export the head-to-head as a PNG
- **Share card**: from any profile, generate a PNG card (wide for LinkedIn, or square) with rank, solved count, streak, rating and difficulty split. Download it, copy it, share it from your phone, or open a LinkedIn post with a caption ready. Cards can be drawn in the dark or the light palette

**Stats**

- **Stats page** (`#/stats`) with group growth since tracking began, a difficulty breakdown, an activity heatmap, this week's top three and summary tiles. A switch shows the LeetCode, Codeforces or CodinGame view (the CodinGame view counts XP instead of problems, and has no difficulty breakdown or heatmap)

**Engagement**

- **Badges** for solved counts, streaks, a first Hard, a first contest and contest-rating tiers, plus two awarded across the board (see [Badges and tiers](#badges-and-tiers))
- **Notifications** in a bell in the header: you're told when you earn a new badge or win a week, and admins can message you directly or broadcast to everyone

**Accounts and administration**

- **Sign-up with Google or GitHub** and a chosen username (the provider verifies the email; no passwords or mail servers to manage; no LeetCode needed), and a **members-only** site: without a session the app shows only the sign-in screen, and the API refuses every data request (see [Security](#security))
- **Account settings page** (`#/account`) for display name, school, bio, links, linked platforms, password and account deletion
- **Privacy controls**: hide a linked platform from other members, or hide LeetCode stats on your profile (you still appear on the board)
- **Admin tools** to sync everyone at once, remove members, watch sync health, and send messages with a record of how many members have read each

**Interface**

- **Light and dark themes** with a toggle in the header; your choice is remembered, and it follows your system setting until you pick one
- Responsive layout, keyboard-friendly controls and reduced-motion support

## Pages

The app is a single page switched with the URL hash, so no server rewrite is needed: a plain static host or Vercel serves `/` for everything.

| Route | Page | Who |
| --- | --- | --- |
| any address, no session | Sign-in and sign-up screen (nothing else is shown) | Visitors |
| `#/` | LeetCode leaderboard, podium, winner banner and hall of fame | Members |
| `#/codeforces` | Codeforces board | Members |
| `#/codingame` | CodinGame board | Members |
| `#/stats` | Group stats (LeetCode, Codeforces or CodinGame) | Members |
| `#/compare` and `#/compare/<a>/<b>` | Head-to-head comparison (members with LeetCode) | Members |
| `#/u/<username>` | Member profile | Members |
| `#/account` | Account settings and linked accounts | Members |
| `#/admin` | Sync health, messages and feedback | Admins |

"Members" means a signed-in member; a visitor without a session only ever sees the sign-in screen, whichever address they open. A signed-in member who opens `#/admin` without admin rights sees a short "for admins" notice.

The leaderboard also keeps its view in the query string (`?sort=weekly|allTime|rating&q=<search>`) and remembers pinned members in your browser.

## Platforms

A member signs up with Google or GitHub and a chosen username, so no platform is required. LeetCode, Codeforces and CodinGame are all optional links, added after signing up, in any combination.

| | LeetCode | Codeforces | CodinGame |
| --- | --- | --- | --- |
| Required | No | No | No |
| Source | Public profile data | Official public API | The website's own JSON endpoints (no official API) |
| "Solved" | Problems solved (easy / medium / hard) | Distinct problems solved, gym contests excluded | Total XP |
| Rating | Contest rating | Codeforces rating, max rating and rank title | Level |
| Weekly / monthly | Progress since the week (Mon-Sun UTC) or last 30 days | Problems first solved in that window | XP earned, from daily snapshots |
| Difficulty split | Easy / Medium / Hard | By problem rating: under 1200, 1200 to 1699, 1700 and up, plus Unrated | n/a |
| Handle | LeetCode username | Codeforces handle | The hex id in `codingame.com/profile/<id>` |
| Ownership proof | Code in the profile **Summary** | Code in **Settings > Social > Organization** | Code in the **Tagline** (or Company, School and similar fields) |

Notes:

- Codeforces allows roughly one request every two seconds, so every call goes through a shared throttle and retries once when the limit is hit.
- CodinGame has no official API. The adapter uses the same endpoints the site itself calls, which can change without notice. Everything that reads a response field lives in `parseStats` and `parseProfile` in `platforms/codingame.ts`, so a change on their side is a one-place fix. `scripts/probe-codingame.ts` prints a real response to check field names.
- Each platform is a provider registered in `platforms/registry.ts` (handle pattern, profile fetcher, proof instructions), which is where a new platform would be added.
- A platform answering "not found" is treated differently from a platform not answering. Only the first marks the account as missing.

## Tech stack

- **Frontend:** React 19, Vite, Tailwind CSS 4, Recharts, Motion, Lucide icons
- **Backend:** Node.js, Express, TypeScript
- **Database:** SQLite through libSQL, either a local file or a Turso cloud database
- **Hosting:** any Node host, or Vercel

## Getting started

Requires Node.js 20 or later.

```bash
npm install
cp .env.example .env
```

Set `JWT_SECRET` in `.env` (see below), then start the dev server:

```bash
npm run dev
```

The app runs at http://localhost:3000. With no database configured, data is stored in a local `local.db` file.

Sign-up uses Google or GitHub OAuth. For local development and tests, you can run with real dev OAuth credentials or use the dev-only fake OAuth provider (`node tests/fake-oauth.mjs`, and set `OAUTH_DEV_PROVIDER_URL=http://localhost:4010` in `.env`). The fake provider issues mock identities and verified emails without reaching external networks; the server strictly refuses `OAUTH_DEV_PROVIDER_URL` in production. Or, set real `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` and `PUBLIC_URL=http://localhost:3000` (registering `http://localhost:3000/api/auth/oauth/github/callback` with GitHub).

To try the app with some members already on the boards, seed two fake members into the local database (they have LeetCode data without linking a real account):

```bash
npx tsx scripts/seed-dev-users.ts          # add them (skips any that exist)
npx tsx scripts/seed-dev-users.ts --reset  # delete and re-create them
```

The seed script only writes to a local SQLite file. It refuses to run if `TURSO_DATABASE_URL` points anywhere else, or if `NODE_ENV=production` or `VERCEL` is set.

## Provider setup

To enable Google or GitHub sign-in, create OAuth apps with the providers. Keep every client secret server-side only (never a `VITE_` variable, never in chat, issues or logs).

**GitHub**
1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**.
2. Homepage URL: your site URL (e.g. `http://localhost:3000` or `https://leaderboard-leet.vercel.app`).
3. Authorization callback URL: exactly `<PUBLIC_URL>/api/auth/oauth/github/callback`. Since GitHub allows one callback URL per app, create two apps: one for local development (`http://localhost:3000/api/auth/oauth/github/callback`) and one for production (`https://leaderboard-leet.vercel.app/api/auth/oauth/github/callback`).
4. Generate a client secret and set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `.env` (or Vercel environment variables).

**Google**
1. [Google Cloud Console](https://console.cloud.google.com) → create a project → **APIs & Services → OAuth consent screen**: user type External, app name, user support email, and scopes `openid`, `email`, `profile`. Publish the app (in "Testing" mode only listed test accounts can sign in). These basic scopes do not require Google's verification review.
2. **Credentials → Create Credentials → OAuth client ID → Web application**. Authorized redirect URIs: add `http://localhost:3000/api/auth/oauth/google/callback` and `https://leaderboard-leet.vercel.app/api/auth/oauth/google/callback`.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` (or Vercel).

Preview deployments on Vercel have dynamic URLs; leave OAuth variables unset for Preview (sign-in with providers is simply disabled there) or configure dedicated apps.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `JWT_SECRET` | Yes | Signs session cookies. Must be at least 32 random characters. |
| `PUBLIC_URL` | Yes in production | The site's public origin, for example `https://leaderboard-leet.vercel.app` (no trailing slash). In production it must start with `https://`. Used to construct OAuth redirect URIs. |
| `GITHUB_CLIENT_ID` | To enable GitHub | Client ID from the GitHub OAuth app. Set together with `GITHUB_CLIENT_SECRET`. |
| `GITHUB_CLIENT_SECRET` | To enable GitHub | Client secret from the GitHub OAuth app. Server-side only. |
| `GOOGLE_CLIENT_ID` | To enable Google | Client ID from the Google Cloud Console OAuth client. Set together with `GOOGLE_CLIENT_SECRET`. |
| `GOOGLE_CLIENT_SECRET` | To enable Google | Client secret from the Google OAuth client. Server-side only. |
| `OAUTH_DEV_PROVIDER_URL` | Dev and tests only | Base URL of the fake provider (`node tests/fake-oauth.mjs`). Refused in production. |
| `ADMIN_USER_IDS` | Yes (for admin access) | Comma-separated internal member ids (`user-...`) with admin rights. Find one with `npm run admin -- show-id <username>` (the name they sign in with), or `GET /api/auth/session` while signed in. Any member can be an admin, with or without a LeetCode account. Admins are matched by id, never by name: a name is freed when an account is deleted, so a name-based list would let the next person to sign up with it inherit admin. There is no default: if neither admin variable is set, nobody is an admin. |
| `ADMIN_LEETCODE_USERNAMES` | No (deprecated) | Comma-separated LeetCode usernames with admin rights, used only while `ADMIN_USER_IDS` is empty. A LeetCode username can be recycled by someone else, so prefer ids. |
| `ALLOWED_ORIGINS` | No | Comma-separated extra origins allowed to make state-changing API requests (CSRF allow-list). The app's own origin is always allowed. |
| `TURSO_DATABASE_URL` | No | Turso database URL. Leave empty to use the local `local.db` file. |
| `TURSO_AUTH_TOKEN` | Yes, with a remote database | Auth token for the Turso database. Server-side only: never put it (or any secret) in a `VITE_` variable, which would ship it to the browser. |
| `TRUST_PROXY_HOPS` | No | How many reverse proxies sit in front of the app, used to read the real client IP for rate limiting. Defaults to `1` in production (Vercel, Render, Railway, Fly) and `0` in development. Raise it only if you add another proxy or CDN; too high lets clients spoof their IP. |
| `ALLOWED_EMAIL_DOMAINS` | No | Comma-separated domains whose addresses may sign up, for example a school's. Exact match (`school.edu` does not allow `mail.school.edu`), any letter case. Empty means any domain. Applied to sign-up and when connecting an OAuth provider. |
| `PORT` | No | Server port. Defaults to `3000`. |
| `SYNC_BUDGET_MS` | No | Time budget in milliseconds for one visit-triggered sync. Defaults to `8000`. |

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Accounts

Nothing on the site is public. A visitor sees only the sign-in screen, and every data endpoint answers `401` without a session.

**Signing up** uses **Google or GitHub**. The provider verifies the person's email address, so no email is ever sent and no mail credentials are required. Once the provider flow completes, the new member chooses a public username (and optional display name), and their account is created with the provider-verified email stored in `users.email` (`email_verified_at`). They are then signed in and taken to **Account settings** where they can optionally link LeetCode, Codeforces, or CodinGame.

1. Click **Continue with Google** or **Continue with GitHub**.
2. Authorize the application at the provider. Provider authorization codes and tokens are exchanged on the server and never stored.
3. Choose a public username. If the name is valid and free, the account is created with the provider-verified email and signed in immediately.

- The **username** is what members sign in with. It is 3 to 30 characters from `A-Z`, `a-z`, `0-9` and `_`, stored in lowercase, and unique in any letter case. Names that could pass for the site or its staff (`admin`, `root`, `support`, ...) are refused.
- The **email** is verified by the provider, trimmed and lowercased, and unique in any letter case. It is private: it is never shown to other members, never in `/api/users`, never in logs (logs hold a masked form such as `a***@example.com`). If `ALLOWED_EMAIL_DOMAINS` is set, only approved domains can sign up.
- **Passwords**: Members who sign up via Google or GitHub do not need a password. Existing members who joined before OAuth keep their passwords and sign in with their username and password.
- **Connecting providers**: Existing members can connect Google and GitHub to their account in **Account settings** (requires entering their current password). An OAuth identity can belong to at most one member.
- **Sign-in methods**: Every account must keep at least one way to sign in (a password or at least one connected OAuth provider). Disconnecting the last sign-in method is refused.
- **Password recovery**: Members who have a password and linked accounts (LeetCode, Codeforces, CodinGame) can reset a forgotten password using the proof-of-ownership challenge (`POST /api/auth/reset/start` and `/verify`). Members who connected Google or GitHub can sign in directly through their provider. Members with neither can ask an admin, who can set a password with `npm run admin -- set-password <username>` (add `--confirm-remote` for remote databases). See [Security and operations](docs/security-operations.md).

Sessions last 7 days. When one ends (it expired, the member logged out elsewhere, or the password was changed on another device) the app returns to the sign-in screen and says so.

## Account settings

Logged-in members click their name in the header and choose **Account settings** (`#/account`; the same menu also links to their profile) to:

- **Manage sign-in methods.** View connected Google and GitHub accounts, connect new providers (requires the current password if the member has one), or disconnect a provider (disconnection is refused if it is the member's only sign-in method).
- **Change their display name, school, bio and links.** School is shown as a tag on the leaderboard. Bio and the GitHub, LinkedIn and website links are shown on the profile page. The server validates each link and limits lengths. The avatar is not editable: a member gets a generated letter avatar, replaced by their LeetCode profile picture once they link LeetCode (it then refreshes automatically).
- **View their verified email.** The card shows the address masked (`a***@example.com`), verified by Google or GitHub.
- **Manage linked accounts** (see below).
- **Hide LeetCode stats on their profile.** They still count on the board and in the group stats.
- **Change their password.** Available for members who have a password. This needs the current password, keeps the current device signed in, and signs out every other device.
- **Log out.**
- **Delete their account.** Permanently removes the member's stats, history and linked accounts. Members with a password confirm with their password; passwordless members confirm by typing their username.

## Linked accounts

Signing up needs only Google or GitHub OAuth and a username. Linking is optional: from **Account settings**, a member can link any of **LeetCode**, **Codeforces** and **CodinGame**, in any combination (none, one, or all three), and remove them again.

1. Choose the platform and enter the handle.
2. Copy the one-time code (valid for 30 minutes) and paste it where the page says: the Summary on LeetCode, the Organization field on Codeforces, the Tagline on CodinGame.
3. Press **Verify**. The app reads the public profile and looks for the code.
4. Remove the code from the profile afterwards if you like.

Each platform has its own row on the page with the same steps: link, prove with the code, verify, hide, remove. A member who has linked nothing yet is on no board; the page tells them so, and their profile says they haven't linked anything. A handle can belong to at most one member. Linking LeetCode starts tracking from that moment: what the member already solved is their starting point and doesn't count towards weekly or monthly progress, and badges they already hold don't arrive as notifications. Unlinking LeetCode deletes its stats and history; the member and their other linked accounts stay.

A linked account can be unlinked at any time, or hidden on the member's profile. A hidden account still counts on the leaderboard and in the trends; other members' browsers receive it flagged as hidden and without the day-by-day series, and the profile page doesn't show it. The owner and admins see everything.

A linked account is also a way to recover a forgotten password for members with a password (see [Security and operations](docs/security-operations.md)); members who connected Google or GitHub can sign in with their provider, and members with neither can ask an admin.

## Badges and tiers

Badges are computed from a member's data, not stored.

| Badge | How to earn it |
| --- | --- |
| 100 / 500 / 1,000 solved | Reach that many solved problems |
| First Hard | Solve your first Hard problem |
| First contest | Take part in a LeetCode contest |
| Contest tiers | Rated 1500+, Rated 1700+, Knight (1850+), Guardian (2150+) |
| 7-day streak | Submit on 7 days in a row |
| Most improved | Biggest jump in monthly solving pace compared with the month before (needs at least two comparable members and a real amount of solving) |
| First on the board | The earliest member still here (only shown to the member who holds it) |

**Rating tiers** use Codeforces-style names scaled to LeetCode's contest range, and they drive the colour of ratings and the avatar frame:

| Tier | LeetCode rating from |
| --- | --- |
| Newbie | 0 |
| Pupil | 1400 |
| Specialist | 1550 |
| Expert | 1700 |
| Candidate | 1850 |
| Master | 2000 |
| Grandmaster | 2150 |

Codeforces rank titles map onto the same colours and frames. CodinGame levels step up one tier every ten levels (10+ Pupil, 20+ Specialist, and so on up to 60+).

## Themes

Dark is the default. A header toggle switches to light; the choice is saved in `localStorage` and, until you pick one, follows your system setting. An inline script in `index.html` applies the saved theme before first paint, so there is no flash of the wrong one.

The theme is driven by CSS variables in `src/index.css`:

- Surfaces (`ink-*`), text (`mist-*`), hairlines (`line`), the brand gradient (`aurora-*`) and rating tiers (`tier-*`) are redefined under `html[data-theme="light"]`.
- The accent and status ramps (teal, emerald, amber, orange, rose, sky and more) are remapped for light surfaces, so gradients stay in one colour family.
- Gold, silver and bronze washes, rings and glows use dedicated `--medal-*` variables, and the two head-to-head sides use `--side-a` and `--side-b`.
- Button glows and the modal backdrop follow `--btn-*` and `--modal-scrim`.
- Light mode adds card elevation, softens the background glow and switches off neon glows.
- Charts take their colours from `chartColors()` in `src/theme.tsx`, because Recharts needs plain values. Share and compare cards are drawn on a canvas with their own palettes and do not depend on the site theme.

## Security

- **Members only, enforced by the API.** Every route that returns member, board, trend or profile data requires a session and answers `401` (with the code `session_required`) without one; hiding the UI is only a convenience on top. The few public routes are the sign-in and OAuth endpoints, password-reset endpoints, the session check, logout and the feedback form. `tests/gating.test.ts` fails if any route is open to visitors without being on its short allow-list.
- Passwords are hashed with scrypt and a unique salt per password.
- **OAuth rules (Google and GitHub)**:
  - **PKCE**: Strict PKCE with SHA-256 code challenge (`code_challenge`) and random 43-character verifier (`code_verifier`).
  - **State verification**: Cryptographic single-use `state` parameter (128-bit hex string) held in an HttpOnly cookie and validated with constant-time equality (`crypto.timingSafeEqual`).
  - **No account matching by email**: Sign-in matches *only* by the provider's stable user ID (`oauth_identities`), never by email address. Having the same email as an existing member does not automatically sign into or link that member's account (account takeover prevention).
  - **Token and secret privacy**: Authorization codes, access tokens and client secrets are exchanged in server memory and never stored, logged or sent to the browser. Client secrets are never in `VITE_` variables.
  - **Verified emails only**: The server only accepts emails that the provider explicitly marked verified (e.g. GitHub primary verified email, Google `email_verified: true`).
  - **Emails are private**: Stored lowercase with `email_verified_at`. Never exposed in public member payloads (`/api/users`, profiles, boards, admin tables); members see only their own masked email (`a***@example.com`) in account settings.
  - **Strict redirect URIs**: `redirect_uri` is strictly constructed on the server from `PUBLIC_URL`, never from the HTTP `Host` header or client parameters.
  - **Production guards**: `OAUTH_DEV_PROVIDER_URL` is blocked from booting in production mode.
- An account locks for 15 minutes after 5 failed password attempts, whether at login or when confirming a password change or deletion. Attempts are also rate limited per IP.
- Unknown usernames and wrong passwords return the same error.
- Sessions are signed HTTP-only cookies. Resetting a password signs out all older sessions.
- Ownership of every account (LeetCode, Codeforces, CodinGame) is proven with a one-time code read back from the public profile.
- Request bodies are limited to 10 KB and usernames and handles are validated against allow-lists. Every `/api` response is sent with `Cache-Control: no-store`.
- Production responses carry a Content Security Policy (own scripts only, plus the hashed theme bootstrap in `index.html`), `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, a `Referrer-Policy`, a `Permissions-Policy` and `Cross-Origin-Opener-Policy`. They are defined once in `securityHeaders.ts` and mirrored in `vercel.json`, which serves the static frontend on Vercel. `npm run security:check` fails if the two drift apart or if the inline script in `index.html` changes without its CSP hash being updated; run it after editing either.
- The sensitive rate limiters keep their counters in the database, so they hold across serverless instances (see [Rate limits](#rate-limits)).
- Dependencies are audited with `npm run audit:prod`, and Dependabot keeps them and the CI actions current.
- Security regressions are covered by `npm test`: the suite starts the real server on a throwaway database and checks authorization, forged tokens, CSRF, challenge replay, rate limits, validation, headers and log hygiene (it checks the database as well as the status codes). CI runs it on every push and pull request, alongside a dependency audit, a full-history secret scan and CodeQL (`.github/workflows`).
- Security events (failed and locked logins, ownership checks, password and account changes, OAuth events, admin actions, blocked requests) are logged as structured JSON with secrets redacted. See [docs/security-operations.md](docs/security-operations.md) for the event list, what to alert on, an incident-response checklist and the backup-restore drill.
- Notification text is always rendered as plain text, never HTML.

## Data syncing

On a server that stays running, all members who linked LeetCode are refreshed every 30 minutes. On Vercel there is no background job, so the board syncs itself when a member opens it: if it was last synced more than 30 minutes ago, the page asks the server to refresh the stale members (a few at a time, within a short time budget, continuing on the next visit if needed). The same pass refreshes linked Codeforces and CodinGame accounts (including those of members who never linked LeetCode) with whatever time is left. A member without a LeetCode account is never fetched from LeetCode: there is nothing to fetch, and they aren't ranked.

An admin can force a full refresh with the **Sync all** button, or refresh a single member (rate limited). For a member without LeetCode that refreshes just their other linked accounts.

Each sync reads LeetCode's public data for easy / medium / hard counts, streaks, contest rating and the avatar, then stores one cumulative snapshot for that UTC day. The newest 60 days are kept per member.

## Sync health (admins)

Admins get a **Sync health** page (`#/admin`) in the navbar. It lists the members who have linked LeetCode (those without have nothing to sync) with each one's last successful sync and last attempt, who is failing to sync and for how long, and the last error. A member whose LeetCode account was removed or renamed is flagged as "Account not found" (LeetCode confirmed the username doesn't exist), which is different from LeetCode simply not answering. From there an admin can retry a sync or remove the member. The page also holds the **Send a message** form and the list of messages sent, with how many members received and read each.

The data comes from a `sync_status` table that every sync attempt writes to, served through the admin-only `GET /api/admin/sync-status`. Linked platforms record the same information in `platform_sync_status`.

## Database

SQLite locally, Turso in production. The full annotated schema is in [`db/schema.sql`](db/schema.sql).

```
users ──< history               one cumulative snapshot per member per UTC day (newest 60 kept)
users ──< notifications         badge / achievement / admin notifications, one row per recipient
users ──o< feedback             messages from the Feedback button (user_id is NULL for visitors)
users ──< user_awards           ledger of awards already announced (each is announced once)
users ── sync_status            latest LeetCode sync attempt per member (admin page)
users ──< platform_accounts     linked Codeforces / CodinGame accounts, with current stats
users ──< platform_history      one snapshot per member per platform per UTC day
users ──< platform_sync_status  latest sync attempt per member per platform
users ──< pending_links         open "prove you own this account" requests
users ──< oauth_identities      connected Google / GitHub accounts (provider + provider_user_id)
users ──o< oauth_states         in-flight OAuth flows (PKCE verifier, intent, single use, 10 min)
pending_oauth_signups           verified provider identities waiting for a username (15 min)
pending_registrations           unused since the username sign-up (kept empty for rollback)
pending_resets                  "forgot password" requests waiting for the proof code
rate_limits                     counters for the sensitive rate limiters (shared across instances)
meta                            key/value store (weekly winners archive, last full sync)
schema_migrations               applied migrations
```

Changes to an existing database are versioned migrations in `db.ts` (`MIGRATIONS`). They run automatically on start-up and are idempotent; `npm run db:migrate` runs them on purpose, with a backup of a local database first. For a Turso database, take a snapshot before migrating; `npm run db:migrate` refuses to touch a remote database unless you add `-- --confirm-remote`, so a `.env` holding production credentials can't migrate production by accident. Keep `db/schema.sql`, the `MIGRATIONS` list and `initDb()` in step.

**Database credentials.** Keep separate Turso databases, and separate tokens, for development, preview and production, and set each only in the matching Vercel environment. The app needs read and write access, so it can't use a read-only token; create it per database, set an expiry you are willing to rotate on, and never reuse it for tooling. The app refuses to start with a remote URL that isn't encrypted (`libsql://` or `https://`). Rotate the token if it was ever pasted into a chat, an issue or a log.

**How progress is counted.** Each member has a `tracking_start` day and a `baseline_solved` total (their all-time count when they linked LeetCode). Weeks run Monday to Sunday (UTC) and the weekly counter restarts from 0 every Monday. A member who links LeetCode mid-week is counted from that day to that Sunday, measured from their baseline, and from then on like everyone else. Group growth is the sum of what each member has solved since they joined, so linking someone never inflates the chart with their past.

**Activity heatmap.** Daily activity is the difference between consecutive snapshots. When a gap of N days separates two snapshots, the difference is spread evenly over those days. Days before anyone was tracked show as "no data", which is different from a tracked day where nobody solved anything.

## Notifications

After every sync the server works out the badges and weekly wins of the members who linked LeetCode (badges and wins are LeetCode-based) and compares them with the `user_awards` ledger. Anything not in the ledger is new: it is announced once as a row in `notifications`.

- A member's **first check is silent**: it only records what they already hold, so nothing is announced on the day this ships and a new member isn't congratulated for what they walked in with.
- Each contest tier is its own award; **weekly champion** is the achievement.
- The ledger insert and the notification are one transaction, so two serverless instances racing on a sync can't announce an award twice.
- A notification error is logged and never fails a sync or a sign-up. Notifications older than 90 days are pruned.

Awards are noticed when a sync runs (at most about 30 minutes after the member earns them).

In the app, signed-in members get a bell in the header (`src/NotificationBell.tsx`). It polls `GET /api/notifications` on load, every 60 seconds while the tab is visible, and when the tab regains focus (serverless hosts have no persistent connections, so polling is how updates arrive). It shows the unread count and offers mark all read, dismiss and clear read. Admins send messages from the **Admin** page (`src/AdminDashboard.tsx`).

### Notification API

Members only ever see and change their own notifications; the member id always comes from the session.

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/notifications` | member | Newest 50 notifications and the total unread count |
| `POST` | `/api/notifications/read` | member | Body `{ "all": true }` or `{ "ids": [...] }` |
| `POST` | `/api/notifications/clear-read` | member | Remove every notification already read |
| `DELETE` | `/api/notifications/:id` | member | Remove one |
| `GET` | `/api/admin/notifications` | admin | Recent messages sent, with how many members received and read each |
| `POST` | `/api/admin/notifications` | admin | Body `{ "to": "all" \| "<member id>", "title", "message"? }` |

Titles are limited to 80 characters and messages to 500; control characters are stripped. Sending is rate-limited with the same limiter as account actions. Removing a notification is a soft delete, so an admin's "read by" numbers don't shrink when members tidy up; rows are deleted for good after 90 days.

## Feedback

Every page has two floating buttons at the bottom right (`src/FeedbackWidget.tsx`): **Star on GitHub**, which opens the repository in a new tab (a website can't star a repo on someone's behalf without GitHub OAuth, so the visitor clicks Star there), and **Feedback**, which opens a short form: a kind (bug, idea or other) and a message of 3 to 1000 characters.

Anyone can send feedback, signed in or not. A signed-in member's message carries their name; a visitor's is anonymous. The member id comes from the session, never from the request body, and no IP address is stored. If a member deletes their account their feedback is kept but becomes anonymous.

Admins read it in the **Feedback** section of the Admin page (`src/AdminDashboard.tsx`): newest first, with an unread count, a filter, mark read / unread, and delete. It reloads every 60 seconds while the tab is visible. Messages are shown as plain text.

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/feedback` | anyone, rate limited | Body `{ "message", "category"?: "bug" \| "idea" \| "other", "page"? }` |
| `GET` | `/api/admin/feedback` | admin | Newest 100 and the total unread count |
| `PATCH` | `/api/admin/feedback/:id` | admin | Body `{ "read": boolean }` |
| `DELETE` | `/api/admin/feedback/:id` | admin | Delete one |

Sending is limited to 10 per hour per IP (see [Rate limits](#rate-limits)). The limit is per IP, so on a shared school network it is shared by everyone on that network.

## API

All endpoints live under `/api`.

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/users` | Members | Leaderboard data, ranks, weekly winners and the last full sync time. Members without LeetCode come last and unranked (`rank` 0). A linked account a member has hidden is flagged `hidden` and sent without its day-by-day series, unless the viewer is that member or an admin |
| GET | `/api/trends` | Members | LeetCode group trend, difficulty breakdown and top solver of the week |
| GET | `/api/trends?platform=codeforces` | Members | The same shape, built from linked Codeforces accounts |
| GET | `/api/trends?platform=codingame` | Members | The same shape, built from linked CodinGame accounts; the values are XP, not problems |
| POST | `/api/users/:id/refresh` | Admin, rate limited | Refresh one member from LeetCode (a member without LeetCode only has their other accounts refreshed) |
| POST | `/api/sync-if-stale` | Members, rate limited | Refresh stale members within a time budget (used by the page whenever a member opens the board) |
| GET | `/api/auth/oauth/:provider/start` | Public, rate limited | Start OAuth sign-in (`:provider` is `github` or `google`). Sets HttpOnly `oauth_state` cookie and redirects to provider |
| GET | `/api/auth/oauth/:provider/callback` | Public, rate limited | Callback from provider. Existing identities sign in immediately; new ones get a pending signup and redirect to username step |
| GET | `/api/auth/oauth/pending` | Public, rate limited | Get provider, masked email and suggested display name for the pending signup (needs `oauth_signup` cookie) |
| POST | `/api/auth/oauth/complete` | Public, rate limited | Complete signup with `{ username, displayName? }`. Creates account with verified email and signs in (`201`) |
| POST | `/api/auth/login` | Public | Log in with `username` + `password` (for existing members with a password) |
| POST | `/api/auth/reset/start` | Public, rate limited | Forgot password, step 1: name the account to prove (LeetCode, Codeforces or CodinGame), choose the new password, get a one-time code |
| POST | `/api/auth/reset/verify` | Public, rate limited | Forgot password, step 2: reads the profile, and if the code is there sets the password and signs the person in |
| POST | `/api/logout` | Public | Log out |
| GET | `/api/auth/session` | Public | Current session state |
| PATCH | `/api/account/profile` | Member | Change display name, school, bio, links and/or the hide-LeetCode-stats setting |
| POST | `/api/account/leetcode/start` | Member, rate limited | Start linking a LeetCode account (optional) and get the proof code to put in its profile Summary |
| POST | `/api/account/leetcode/verify` | Member, rate limited | Verify the code, link the account and start tracking from now |
| DELETE | `/api/account/leetcode` | Member | Unlink LeetCode and delete its stats and history; the member stays |
| POST | `/api/account/platforms/:platform/start` | Member, rate limited | Start linking a Codeforces or CodinGame account and get the proof code |
| POST | `/api/account/platforms/:platform/verify` | Member, rate limited | Verify the proof code and finish linking |
| PATCH | `/api/account/platforms/:platform` | Member | Show or hide a linked account. Body `{ "hidden": boolean }` |
| DELETE | `/api/account/platforms/:platform` | Member | Unlink an account |
| POST | `/api/account/oauth/:provider/start` | Member, rate limited | Start connecting an OAuth provider (`:provider` is `github` or `google`). Body `{ "currentPassword"?: string }` (required if member has a password) |
| DELETE | `/api/account/oauth/:provider` | Member | Disconnect an OAuth provider (refused if it is the only remaining sign-in method) |
| POST | `/api/account/password` | Member | Change the password (requires current password; available for members with a password) |
| POST | `/api/account/delete` | Member | Delete the account (body `{ "password": string }` for members with a password, or `{ "confirmUsername": string }` for passwordless members) |
| GET | `/api/notifications` and related | Member | See [Notification API](#notification-api) |
| POST | `/api/refresh-all` | Admin, rate limited | Refresh every member who linked LeetCode, plus every linked Codeforces and CodinGame account |
| DELETE | `/api/users/:id` | Admin | Remove a member |
| GET | `/api/admin/sync-status` | Admin | LeetCode sync health, one row per member who linked LeetCode |
| GET / POST | `/api/admin/notifications` | Admin | See [Notification API](#notification-api) |
| POST | `/api/feedback` | Public, rate limited | Send feedback; see [Feedback](#feedback) |
| GET / PATCH / DELETE | `/api/admin/feedback` | Admin | Read and manage the feedback inbox; see [Feedback](#feedback) |

`:platform` is `codeforces` or `codingame`.

## Rate limits

Limits are per IP. The sensitive limiters (login, OAuth, verification, refresh, account actions and feedback) store their counters in the `rate_limits` table, so they are enforced across every serverless instance and survive restarts and cold starts. The general `/api` ceiling stays in memory: the frontend polls it, and a database write per poll isn't worth the cost. Logins are additionally protected by a per-account lockout, which holds even if an attacker rotates IPs.

| Scope | Limit |
| --- | --- |
| All `/api` requests | 300 per 15 minutes |
| Login | 20 per 15 minutes |
| OAuth start, callback, pending, complete | 20 per 15 minutes |
| Verification (linking accounts, password reset) | 20 per 15 minutes |
| Starting a password reset | 10 per hour |
| Single-member refresh and sync-if-stale | 6 per minute |
| Account actions and admin messages | 20 per 15 minutes |
| Feedback form | 10 per hour |

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Build the frontend into `dist/client/` and bundle the server into `server-dist/` (`dist/client/` is the only folder served over HTTP) |
| `npm start` | Run the production build (always in production mode, no `NODE_ENV` needed) |
| `npm run clean` | Delete `dist/` and `server-dist/` |
| `npm run lint` | Type-check the project |
| `npm run db:migrate` | Back up the local database, then apply any pending schema migrations (a remote database also needs `-- --confirm-remote`) |
| `npm test` | Run the security regression tests against the real server (throwaway database) |
| `npm run db:verify-backup` | Check that a restored copy of the database is complete and readable (`-- --url <copy>`) |
| `npm run security:check` | Verify the CSP script hashes, that `vercel.json` sends the same security headers as `securityHeaders.ts`, and that the build scripts keep the server bundle out of the served folder |
| `npm run audit:prod` | Fail on known high-severity vulnerabilities in production dependencies |
| `npm run clean` | Remove build output |
| `npx tsx scripts/seed-dev-users.ts` | Development only: add two fake members to the local database (`--reset` re-creates them) |
| `npx tsx scripts/probe-codingame.ts <handle>` | Print what CodinGame returns for one handle, to check the field names the adapter reads |

## Project structure

```
leeterboard/
├── db/schema.sql           annotated current schema
├── platforms/              Codeforces and CodinGame adapters, shared types and the registry
├── scripts/                migrate, seed-dev-users, probe-codingame, check-security-config, verify-backup
├── src/                    React app
│   ├── App.tsx             app shell, navbar, leaderboard and stats pages
│   ├── ProfilePage.tsx     member profile
│   ├── ComparePage.tsx     head-to-head view
│   ├── CodeforcesPage.tsx  Codeforces board
│   ├── CodinGamePage.tsx   CodinGame board
│   ├── AccountPage.tsx     account settings and linked accounts (a card per platform)
│   ├── linkedAccounts.ts   who counts as linked, and the LeetCode board's members
│   ├── SessionGate.tsx     shows only the sign-in screen without a session; LoginModal.tsx is its form
│   ├── AdminDashboard.tsx  sync health, messages and the feedback inbox
│   ├── FeedbackWidget.tsx  floating Star on GitHub and Feedback buttons
│   ├── Podium.tsx, WinnerBanner.tsx, ActivityHeatmap.tsx, TierAvatar.tsx, ...
│   ├── achievements.ts, tiers.ts, movement.ts, winners.ts, activity.ts, compare.ts
│   ├── shareCard.ts, compareCard.ts   canvas-drawn PNG cards
│   ├── theme.tsx, ThemeToggle.tsx, index.css
│   └── NotificationBell.tsx, Toast.tsx, Modal.tsx, ...
├── server.ts               Express app: auth, account, sync and trend routes
├── auth.ts                 sessions, password hashing, admin check
├── usernames.ts            rules for choosing a username
├── emails.ts               rules for an email address (format, allowed domains, masking)
├── oauth.ts                pure OAuth helpers (PKCE, state validation, provider endpoints, URL validation)
├── oauthProviders.ts       OAuth token exchange and user info fetchers (GitHub, Google, fake dev provider)
├── db.ts                   database access and MIGRATIONS
├── platformSync.ts         sync for linked platform accounts
├── platformTrends.ts       group trend for a linked platform
├── notifications.ts        award ledger and notification creation
├── notificationRoutes.ts   notification endpoints
├── feedbackRoutes.ts       feedback endpoints
├── rateLimit.ts            rate limiters
├── rateLimitStore.ts       database-backed counter store for the sensitive limiters
├── csrf.ts                 cross-site request checks for state-changing routes
├── runtimeEnv.ts           first import of server.ts: makes sure production mode is on (applies runtimeEnvPolicy.ts)
├── runtimeEnvPolicy.ts     the production-mode rules and the served-folder check
├── securityHeaders.ts      CSP and other response headers (mirrored in vercel.json)
├── securityLog.ts          structured, redacted security-event logging
├── tests/                  security regression tests (npm test)
├── docs/                   security-operations.md: alerts, incident response, restore drills
├── .github/                CI workflows (tests, audit, secret scan, CodeQL) and Dependabot
├── streaks.ts              streak maths for LeetCode's submission calendar
└── vercel.json             Vercel build and routing
```

## Deployment

**Any Node host:** run `npm run build`, set the environment variables, then run `npm start`. Use a Turso database if the host has no persistent disk.

- `npm start` runs the production bundle, which is always in production mode (Content-Security-Policy, HSTS, `Secure` cookies). You don't need to set `NODE_ENV`, and setting it to something else is ignored.
- Never run `npm run dev` (or `tsx server.ts`) on a server: it starts the Vite dev server. On a recognised hosting platform (Render, Railway, Fly, Heroku, Cloud Run, Kubernetes, ...) the app refuses to start that way unless `NODE_ENV` is set on purpose.
- Only `dist/client/` is served. The server bundle lives in `server-dist/` and must stay out of any folder you serve statically (the app also refuses to start if it finds server code in `dist/client/`).
- Upgrading from an older version? Run `npm run clean` once, so the old `dist/server.cjs` and its sourcemap are removed from disk, then rebuild.
- Set up OAuth before the first deploy: create the OAuth apps with GitHub and/or Google (see [Provider setup](#provider-setup)), and set `PUBLIC_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and/or the Google pair in your production environment settings. Migrations run automatically on startup.
- After deploying, check it from outside, see [Verify a self-hosted deployment](docs/security-operations.md#verify-a-self-hosted-deployment).

**Vercel:** import the repository and set the environment variables in the project settings. A Turso database is required, because Vercel has no persistent disk for a local SQLite file. `vercel.json` routes `/api/*` to the Express app and serves the built frontend for everything else. There is no background job on Vercel; the board syncs when visitors open it (see [Data syncing](#data-syncing)).