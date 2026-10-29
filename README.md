# Leeterboard

A competitive-programming leaderboard for a group of friends, a class or a club. Members sign up with their **LeetCode** username and can link their **Codeforces** and **CodinGame** accounts. The app tracks solved counts, weekly and monthly progress, streaks, contest ratings and badges, and ranks everyone on live boards with a podium, weekly winners, profiles and head-to-head comparisons.

## Contents

- [Features](#features)
- [Pages](#pages)
- [Platforms](#platforms)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
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

- **LeetCode leaderboard** ranked by weekly progress, all-time solved, or contest rating, with search, pinned members and a shareable URL (`?sort=weekly&q=ali`)
- **Codeforces and CodinGame boards**, one per platform, for members who linked an account (see [Platforms](#platforms))
- **Top-3 podium** for whichever ranking is selected, with gold, silver and bronze styling
- **Rank movement arrows** (▲/▼) showing how many places a member has climbed or dropped since last week, with a NEW tag for members who just joined
- **Live round clock** counting down to Monday 00:00 UTC, when the weekly round closes, plus a scrolling feed of this week's solvers
- **Live data**: the board polls every 15 seconds while the tab is visible, so new stats appear without a reload
- **Freshness indicators** that flag members whose data has stopped updating

**Weekly winners**

- **Winner banner** showing last week's top solver, and a **hall of fame** listing each past winner once, with the number of weeks they were the top solver. Weeks run Monday to Sunday (UTC) and are scored from the daily snapshots. Winners are archived, so the hall of fame outlasts the 60 days of stored history

**Profiles and comparison**

- **Member profile pages** (`#/u/<username>`) with key stats, a progress chart, a difficulty split compared with the board, a per-day activity chart, weekly sprints, weekday rhythm, standing in every category, weekly wins and badges. A toggle switches between a member's LeetCode, Codeforces and CodinGame stats
- **Tier avatar frames**: a member's avatar is framed by their contest-rating tier, from a plain ring up to a glowing, turning frame for Grandmasters
- **Compare page** (`#/compare`): pick any two members for a head-to-head view with every stat side by side (solved counts by difficulty, weekly and monthly progress, contest rating, streaks), who is ahead in each, and both members' solved counts over time on one chart. The URL is shareable, and every profile has a Compare button
- **Compare card**: export the head-to-head as a PNG
- **Share card**: from any profile, generate a PNG card (wide for LinkedIn, or square) with rank, solved count, streak, rating and difficulty split. Download it, copy it, share it from your phone, or open a LinkedIn post with a caption ready. Cards can be drawn in the dark or the light palette

**Stats**

- **Stats page** (`#/stats`) with group growth since tracking began, a difficulty breakdown, an activity heatmap, this week's top three and summary tiles. A switch shows the LeetCode or the Codeforces view

**Engagement**

- **Badges** for solved counts, streaks, a first Hard, a first contest and contest-rating tiers, plus two awarded across the board (see [Badges and tiers](#badges-and-tiers))
- **Notifications** in a bell in the header: you're told when you earn a new badge or win a week, and admins can message you directly or broadcast to everyone

**Accounts and administration**

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
| `#/` | LeetCode leaderboard, podium, winner banner and hall of fame | Everyone |
| `#/codeforces` | Codeforces board | Everyone |
| `#/codingame` | CodinGame board | Everyone |
| `#/stats` | Group stats (LeetCode or Codeforces) | Everyone |
| `#/compare` and `#/compare/<a>/<b>` | Head-to-head comparison | Everyone |
| `#/u/<username>` | Member profile | Everyone |
| `#/account` | Account settings and linked accounts | Members |
| `#/admin` | Sync health and messages | Admins |

The leaderboard also keeps its view in the query string (`?sort=weekly|allTime|rating&q=<search>`) and remembers pinned members in your browser.

## Platforms

LeetCode is the home platform: every member has a LeetCode account. Codeforces and CodinGame are optional add-ons that a member links after signing up.

| | LeetCode | Codeforces | CodinGame |
| --- | --- | --- | --- |
| Required | Yes | No | No |
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

To try the app without signing up through LeetCode verification, seed two fake members into the local database:

```bash
npx tsx scripts/seed-dev-users.ts          # add them (skips any that exist)
npx tsx scripts/seed-dev-users.ts --reset  # delete and re-create them
```

The seed script only writes to a local SQLite file. It refuses to run if `TURSO_DATABASE_URL` points anywhere else, or if `NODE_ENV=production` or `VERCEL` is set.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `JWT_SECRET` | Yes | Signs session cookies. Must be at least 32 random characters. |
| `ADMIN_USER_IDS` | Yes (for admin access) | Comma-separated internal member ids (`user-...`) with admin rights. Find one with `npm run admin -- show-id <leetcodeUsername>`, or `GET /api/auth/session` while signed in. There is no default: if neither admin variable is set, nobody is an admin. Admin accounts can't be claimed or reset through the website. |
| `ADMIN_LEETCODE_USERNAMES` | No (deprecated) | Comma-separated LeetCode usernames with admin rights, used only while `ADMIN_USER_IDS` is empty. A LeetCode username can be recycled by someone else, so prefer ids. |
| `ALLOWED_ORIGINS` | No | Comma-separated extra origins allowed to make state-changing API requests (CSRF allow-list). The app's own origin is always allowed. |
| `TURSO_DATABASE_URL` | No | Turso database URL. Leave empty to use the local `local.db` file. |
| `TURSO_AUTH_TOKEN` | Yes, with a remote database | Auth token for the Turso database. Server-side only: never put it (or any secret) in a `VITE_` variable, which would ship it to the browser. |
| `TRUST_PROXY_HOPS` | No | How many reverse proxies sit in front of the app, used to read the real client IP for rate limiting. Defaults to `1` in production (Vercel, Render, Railway, Fly) and `0` in development. Raise it only if you add another proxy or CDN; too high lets clients spoof their IP. |
| `PORT` | No | Server port. Defaults to `3000`. |
| `SYNC_BUDGET_MS` | No | Time budget in milliseconds for one visit-triggered sync. Defaults to `8000`. |

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Accounts

Members log in with their **LeetCode username** and a **password chosen for this site**. This is never their LeetCode password, and the app never asks for it.

Signing up proves ownership of the LeetCode account:

1. Enter your LeetCode username and a password.
2. Copy the one-time code the app shows you (valid for 30 minutes).
3. Paste it into the **Summary** field of your LeetCode profile and save.
4. Press **Verify**. The app reads your public profile and checks the code.

You can remove the code from your profile afterwards. The same steps reset a forgotten password and claim a leaderboard entry that has no password yet. Existing stats and history are kept in both cases.

Sessions last 7 days.

## Account settings

Logged-in members click their name in the header and choose **Account settings** (`#/account`; the same menu also links to their profile) to:

- **Change their display name, school, bio and links.** School is shown as a tag on the leaderboard. Bio and the GitHub, LinkedIn and website links are shown on the profile page. The server validates each link and limits lengths. The avatar is not editable: it always comes from the member's LeetCode profile and refreshes automatically.
- **Manage linked accounts** (see below).
- **Hide LeetCode stats on their profile.** They still count on the board and in the group stats.
- **Change their password.** This needs the current password, keeps the current device signed in, and signs out every other device.
- **Log out.**
- **Delete their account.** This needs the password and permanently removes the member's stats and history. Signing up again starts from zero.

## Linked accounts

From **Account settings**, a member can link a Codeforces or CodinGame account on top of their LeetCode one:

1. Choose the platform and enter the handle.
2. Copy the one-time code (valid for 30 minutes) and paste it where the page says: the Organization field on Codeforces, the Tagline on CodinGame.
3. Press **Verify**. The app reads the public profile and looks for the code.
4. Remove the code from the profile afterwards if you like.

A handle can belong to at most one member. A linked account can be unlinked at any time, or hidden from other members (the owner and admins still see it). Hidden accounts are removed from other people's views of the board, profiles and trends by the server, not just the interface.

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

- Passwords are hashed with scrypt and a unique salt per password.
- An account locks for 15 minutes after 5 failed password attempts, whether at login or when confirming a password change or deletion. Attempts are also rate limited per IP.
- Unknown usernames and wrong passwords return the same error.
- Sessions are signed HTTP-only cookies. Resetting a password signs out all older sessions.
- Ownership of every account (LeetCode, Codeforces, CodinGame) is proven with a one-time code read back from the public profile.
- Request bodies are limited to 10 KB and usernames and handles are validated against allow-lists. Every `/api` response is sent with `Cache-Control: no-store`.
- Production responses carry a Content Security Policy (own scripts only, plus the hashed theme bootstrap in `index.html`), `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, a `Referrer-Policy`, a `Permissions-Policy` and `Cross-Origin-Opener-Policy`. They are defined once in `securityHeaders.ts` and mirrored in `vercel.json`, which serves the static frontend on Vercel. `npm run security:check` fails if the two drift apart or if the inline script in `index.html` changes without its CSP hash being updated; run it after editing either.
- The sensitive rate limiters keep their counters in the database, so they hold across serverless instances (see [Rate limits](#rate-limits)).
- Dependencies are audited with `npm run audit:prod`, and Dependabot keeps them and the CI actions current.
- Security regressions are covered by `npm test`: the suite starts the real server on a throwaway database and checks authorization, forged tokens, CSRF, challenge replay, rate limits, validation, headers and log hygiene (it checks the database as well as the status codes). CI runs it on every push and pull request, alongside a dependency audit, a full-history secret scan and CodeQL (`.github/workflows`).
- Security events (failed and locked logins, ownership checks, password and account changes, admin actions, blocked requests) are logged as structured JSON with secrets redacted. See [docs/security-operations.md](docs/security-operations.md) for the event list, what to alert on, an incident-response checklist and the backup-restore drill.
- Notification text is always rendered as plain text, never HTML.

## Data syncing

On a server that stays running, all members are refreshed every 30 minutes. On Vercel there is no background job, so the board syncs itself when someone visits: if it was last synced more than 30 minutes ago, the page asks the server to refresh the stale members (a few at a time, within a short time budget, continuing on the next visit if needed). The same pass refreshes linked Codeforces and CodinGame accounts with whatever time is left.

An admin can force a full refresh with the **Sync all** button, and any visitor can refresh a single member (rate limited).

Each sync reads LeetCode's public data for easy / medium / hard counts, streaks, contest rating and the avatar, then stores one cumulative snapshot for that UTC day. The newest 60 days are kept per member.

## Sync health (admins)

Admins get a **Sync health** page (`#/admin`) in the navbar. It shows each member's last successful sync and last attempt, who is failing to sync and for how long, and the last error. A member whose LeetCode account was removed or renamed is flagged as "Account not found" (LeetCode confirmed the username doesn't exist), which is different from LeetCode simply not answering. From there an admin can retry a sync or remove the member. The page also holds the **Send a message** form and the list of messages sent, with how many members received and read each.

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
pending_registrations           sign-ups waiting for LeetCode ownership proof
rate_limits                     counters for the sensitive rate limiters (shared across instances)
meta                            key/value store (weekly winners archive, last full sync)
schema_migrations               applied migrations
```

Changes to an existing database are versioned migrations in `db.ts` (`MIGRATIONS`). They run automatically on start-up and are idempotent; `npm run db:migrate` runs them on purpose, with a backup of a local database first. For a Turso database, take a snapshot before migrating; `npm run db:migrate` refuses to touch a remote database unless you add `-- --confirm-remote`, so a `.env` holding production credentials can't migrate production by accident. Keep `db/schema.sql`, the `MIGRATIONS` list and `initDb()` in step.

**Database credentials.** Keep separate Turso databases, and separate tokens, for development, preview and production, and set each only in the matching Vercel environment. The app needs read and write access, so it can't use a read-only token; create it per database, set an expiry you are willing to rotate on, and never reuse it for tooling. The app refuses to start with a remote URL that isn't encrypted (`libsql://` or `https://`). Rotate the token if it was ever pasted into a chat, an issue or a log.

**How progress is counted.** Each member has a `tracking_start` day and a `baseline_solved` total (their all-time count when they signed up). Weeks run Monday to Sunday (UTC) and the weekly counter restarts from 0 every Monday. A member who joins mid-week is counted from their joining day to that Sunday, measured from their baseline, and from then on like everyone else. Group growth is the sum of what each member has solved since they joined, so adding someone never inflates the chart with their past.

**Activity heatmap.** Daily activity is the difference between consecutive snapshots. When a gap of N days separates two snapshots, the difference is spread evenly over those days. Days before anyone was tracked show as "no data", which is different from a tracked day where nobody solved anything.

## Notifications

After every sync the server works out each member's badges and weekly wins and compares them with the `user_awards` ledger. Anything not in the ledger is new: it is announced once as a row in `notifications`.

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
| GET | `/api/users` | Public | Leaderboard data, ranks, weekly winners and the last full sync time. Linked accounts a member has hidden are left out unless the viewer is that member or an admin |
| GET | `/api/trends` | Public | LeetCode group trend, difficulty breakdown and top solver of the week |
| GET | `/api/trends?platform=codeforces` | Public | The same shape, built from linked Codeforces accounts |
| POST | `/api/users/:id/refresh` | Public, rate limited | Refresh one member from LeetCode |
| POST | `/api/sync-if-stale` | Public, rate limited | Refresh stale members within a time budget (used by the page on every visit) |
| POST | `/api/auth/register` | Public | Start a sign-up, claim or password reset |
| POST | `/api/auth/register/verify` | Public | Verify the LeetCode profile code |
| POST | `/api/auth/login` | Public | Log in |
| POST | `/api/logout` | Public | Log out |
| GET | `/api/auth/session` | Public | Current session state |
| PATCH | `/api/account/profile` | Member | Change display name, school, bio, links and/or the hide-LeetCode-stats setting |
| POST | `/api/account/platforms/:platform/start` | Member | Start linking a Codeforces or CodinGame account and get the proof code |
| POST | `/api/account/platforms/:platform/verify` | Member | Verify the proof code and finish linking |
| PATCH | `/api/account/platforms/:platform` | Member | Show or hide a linked account. Body `{ "hidden": boolean }` |
| DELETE | `/api/account/platforms/:platform` | Member | Unlink an account |
| POST | `/api/account/password` | Member | Change the password (needs the current one) |
| POST | `/api/account/delete` | Member | Delete the account (needs the password) |
| GET | `/api/notifications` and related | Member | See [Notification API](#notification-api) |
| POST | `/api/refresh-all` | Admin | Refresh every member |
| DELETE | `/api/users/:id` | Admin | Remove a member |
| GET | `/api/admin/sync-status` | Admin | Per-member sync health |
| GET / POST | `/api/admin/notifications` | Admin | See [Notification API](#notification-api) |
| POST | `/api/feedback` | Public, rate limited | Send feedback; see [Feedback](#feedback) |
| GET / PATCH / DELETE | `/api/admin/feedback` | Admin | Read and manage the feedback inbox; see [Feedback](#feedback) |

`:platform` is `codeforces` or `codingame`.

## Rate limits

Limits are per IP. The sensitive limiters (login, sign-up, verification, refresh, account actions and feedback) store their counters in the `rate_limits` table, so they are enforced across every serverless instance and survive restarts and cold starts. The general `/api` ceiling stays in memory: the frontend polls it, and a database write per poll isn't worth the cost. Logins are additionally protected by a per-account lockout, which holds even if an attacker rotates IPs.

| Scope | Limit |
| --- | --- |
| All `/api` requests | 300 per 15 minutes |
| Login | 20 per 15 minutes |
| Sign-up | 10 per hour |
| Verification (sign-up and linking) | 20 per 15 minutes |
| Single-member refresh and sync-if-stale | 6 per minute |
| Account actions and admin messages | 20 per 15 minutes |
| Feedback form | 10 per hour |

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Build the frontend and bundle the server into `dist/` |
| `npm start` | Run the production build |
| `npm run lint` | Type-check the project |
| `npm run db:migrate` | Back up the local database, then apply any pending schema migrations (a remote database also needs `-- --confirm-remote`) |
| `npm test` | Run the security regression tests against the real server (throwaway database) |
| `npm run db:verify-backup` | Check that a restored copy of the database is complete and readable (`-- --url <copy>`) |
| `npm run security:check` | Verify the CSP script hashes and that `vercel.json` sends the same security headers as `securityHeaders.ts` |
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
│   ├── AccountPage.tsx     account settings and linked accounts
│   ├── AdminDashboard.tsx  sync health, messages and the feedback inbox
│   ├── FeedbackWidget.tsx  floating Star on GitHub and Feedback buttons
│   ├── Podium.tsx, WinnerBanner.tsx, ActivityHeatmap.tsx, TierAvatar.tsx, ...
│   ├── achievements.ts, tiers.ts, movement.ts, winners.ts, activity.ts, compare.ts
│   ├── shareCard.ts, compareCard.ts   canvas-drawn PNG cards
│   ├── theme.tsx, ThemeToggle.tsx, index.css
│   └── NotificationBell.tsx, Toast.tsx, Modal.tsx, ...
├── server.ts               Express app: auth, account, sync and trend routes
├── auth.ts                 sessions, password hashing, admin check
├── db.ts                   database access and MIGRATIONS
├── platformSync.ts         sync for linked platform accounts
├── platformTrends.ts       group trend for a linked platform
├── notifications.ts        award ledger and notification creation
├── notificationRoutes.ts   notification endpoints
├── feedbackRoutes.ts       feedback endpoints
├── rateLimit.ts            rate limiters
├── rateLimitStore.ts       database-backed counter store for the sensitive limiters
├── csrf.ts                 cross-site request checks for state-changing routes
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

**Vercel:** import the repository and set the environment variables in the project settings. A Turso database is required, because Vercel has no persistent disk for a local SQLite file. `vercel.json` routes `/api/*` to the Express app and serves the built frontend for everything else. There is no background job on Vercel; the board syncs when visitors open it (see [Data syncing](#data-syncing)).