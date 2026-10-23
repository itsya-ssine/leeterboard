# Leeterboard

A weekly LeetCode leaderboard. Members sign up with their LeetCode username, and the app tracks their solved counts, weekly and monthly progress, streaks and contest ratings, ranking everyone on a live board.

## Features

- **Leaderboard** ranked by weekly progress, all-time solved, or contest rating, with search and pinned members
- **Top-3 podium** for whichever ranking is selected
- **Rank movement arrows** (▲/▼) next to each name showing how many places a member has climbed or dropped since last week, with a NEW tag for members who just joined
- **Light and dark themes** with a toggle in the header; your choice is remembered, and it follows your system setting until you pick one
- **Weekly winner banner** showing last week's top solver, with a hall of fame listing each past winner once, with the number of weeks they were the top solver. Weeks run Monday to Sunday (UTC) and are scored from the daily snapshots; winners are archived, so the hall of fame outlasts the 60 days of stored history
- **Compare page** (`#/compare`): pick any two members for a head-to-head view with every stat side by side (solved counts by difficulty, weekly and monthly progress, contest rating, streaks), who is ahead in each, and both members' solved counts over time on one chart. The URL is shareable, and every profile has a Compare button
- **Stats page** with group trends, an activity heatmap and achievement badges
- **Share card**: from any profile, generate a PNG card (wide for LinkedIn, or square) with rank, solved count, streak, rating and difficulty split, then download it, copy it, share it from your phone, or open a LinkedIn post with a caption ready
- **Badges** for solved counts, streaks, a first Hard, a first contest and contest-rating tiers (1500+, 1700+, Knight, Guardian), plus two awarded across the board: **Most improved** (biggest jump in monthly solving pace) and **First on the board** (earliest member still here)
- **Automatic data** pulled from LeetCode: easy/medium/hard counts, streaks, contest rating and avatar
- **Freshness indicators** that flag members whose data has stopped updating
- **Notifications** in a bell in the header: you're told when you earn a new badge or win a week, and admins can message you directly or broadcast to everyone. Unread count, mark all read, dismiss, refreshed every minute and when you return to the tab
- **Account settings page** (`#/account`) to change your display name, add your school (shown as a tag on the leaderboard), add a short bio and GitHub / LinkedIn / website links (shown on your profile page), change your password, or delete your account
- **Admin tools** to sync everyone at once, remove members, and send messages (to one member or everyone) with a record of how many members have read each

## Tech stack

- **Frontend:** React 19, Vite, Tailwind CSS, Recharts, Motion
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

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `JWT_SECRET` | Yes | Signs session cookies. Must be at least 32 random characters. |
| `ADMIN_LEETCODE_USERNAMES` | No | Comma-separated LeetCode usernames with admin rights. Defaults to `0x_naoki`. |
| `TURSO_DATABASE_URL` | No | Turso database URL. Leave empty to use the local `local.db` file. |
| `TURSO_AUTH_TOKEN` | No | Auth token for the Turso database. |
| `PORT` | No | Server port. Defaults to `3000`. |

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Accounts

Members log in with their **LeetCode username** and a **password chosen for this site**. This is never their LeetCode password, and the app never asks for it.

Signing up proves ownership of the LeetCode account:

1. Enter your LeetCode username and a password.
2. Copy the one-time code the app shows you.
3. Paste it into the **Summary** field of your LeetCode profile and save.
4. Press **Verify**. The app reads your public profile and checks the code.

You can remove the code from your profile afterwards. The same steps reset a forgotten password and claim a leaderboard entry that has no password yet. Existing stats and history are kept in both cases.

## Account settings

Logged-in members click their name in the header and choose **Account settings** (the page lives at `#/account`; the same menu also links to their profile) to:

- **Change their display name, school, bio and links.** The avatar is not editable: it always comes from the member's LeetCode profile and refreshes automatically.
- **Change their password.** This needs the current password, keeps the current device signed in, and signs out every other device.
- **Log out.**
- **Delete their account.** This needs the password and permanently removes the member's stats and history. Signing up again starts from zero.

## Security

- Passwords are hashed with scrypt and a unique salt per password.
- An account locks for 15 minutes after 5 failed password attempts, whether at login or when confirming a password change or deletion. Attempts are also rate limited per IP.
- Unknown usernames and wrong passwords return the same error.
- Sessions are signed HTTP-only cookies. Resetting a password signs out all older sessions.
- Request bodies are size-limited, usernames are validated, and responses carry standard security headers.

## Sync health (admins)

Admins get a **Sync health** page (`#/admin`) in the navbar. It shows each member's last successful sync and last attempt, who is failing to sync and for how long, and the last error. A member whose LeetCode account was removed or renamed is flagged as "Account not found" (LeetCode confirmed the username doesn't exist), which is different from LeetCode simply not answering. From there an admin can retry a sync or remove the member. The data comes from a `sync_status` table that every sync attempt writes to, served through the admin-only `GET /api/admin/sync-status`.

## Data syncing

On a server that stays running, all members are refreshed every 30 minutes. On Vercel there is no background job, so the board syncs itself when someone visits: if it was last synced more than 30 minutes ago, the page asks the server to refresh the stale members (a few at a time, within a short time budget, continuing on the next visit if needed). An admin can still force a full refresh with the **Sync all** button, and any visitor can refresh a single member.

## Database

SQLite locally, Turso in production. The full annotated schema is in [`db/schema.sql`](db/schema.sql).

```
users ──< history        one cumulative snapshot per member per UTC day (newest 60 kept)
users ──< notifications  badge / achievement / admin notifications, one row per recipient
users ──< user_awards    ledger of awards already announced (each is announced once)
users ── sync_status     latest sync attempt per member (admin dashboard)
pending_registrations    sign-ups waiting for LeetCode ownership proof
meta                     key/value store (weekly winners archive, last full sync)
schema_migrations        applied migrations
```

Changes to an existing database are versioned migrations in `db.ts` (`MIGRATIONS`). They run automatically on start-up and are idempotent; `npm run db:migrate` runs them on purpose, with a backup of a local database first. For a Turso database, take a snapshot before migrating.

**How progress is counted.** Each member has a `tracking_start` day and a `baseline_solved` total (their all-time count when they signed up). Weeks run Monday to Sunday (UTC) and the weekly counter restarts from 0 every Monday. A member who joins mid-week is counted from their joining day to that Sunday, measured from their baseline, and from then on like everyone else. Group growth is the sum of what each member has solved since they joined, so adding someone never inflates the chart with their past.

## Notifications

After every sync the server works out each member's badges and weekly wins (badges are computed, not stored) and compares them with the `user_awards` ledger. Anything not in the ledger is new: it is announced once as a row in `notifications`.

- A member's **first check is silent**: it only records what they already hold, so nothing is announced on the day this ships and a new member isn't congratulated for what they walked in with.
- Each contest tier is its own award; **weekly champion** is the achievement.
- The ledger insert and the notification are one transaction, so two serverless instances racing on a sync can't announce an award twice.
- A notification error is logged and never fails a sync or a sign-up. Notifications older than 90 days are pruned.

Awards are noticed when a sync runs (at most ~30 minutes after the member earns them).

In the app, signed-in members get a bell in the header (`src/NotificationBell.tsx`). It polls `GET /api/notifications` on load, every 60 seconds while the tab is visible, and when the tab regains focus (serverless hosts have no persistent connections, so polling is how updates arrive). Admins send messages from the **Admin** page's "Send a message" form (`src/AdminDashboard.tsx`). All notification text is rendered as plain text, never HTML.

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

Titles are limited to 80 characters and messages to 500; control characters are stripped and the text is stored and shown as plain text. Sending is rate-limited with the same limiter as account actions. Removing a notification is a soft delete, so an admin's "read by" numbers don't shrink when members tidy up; rows are deleted for good after 90 days.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Build the frontend and bundle the server into `dist/` |
| `npm start` | Run the production build |
| `npm run lint` | Type-check the project |
| `npm run db:migrate` | Back up the local database, then apply any pending schema migrations |
| `npm run clean` | Remove build output |

## Deployment

**Any Node host:** run `npm run build`, set the environment variables, then run `npm start`. Use a Turso database if the host has no persistent disk.

**Vercel:** import the repository and set the environment variables in the project settings. A Turso database is required, because Vercel has no persistent disk for a local SQLite file.

## API

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| GET | `/api/users` | Public | Leaderboard data |
| GET | `/api/trends` | Public | Group trend data |
| POST | `/api/users/:id/refresh` | Public, rate limited | Refresh one member from LeetCode |
| POST | `/api/auth/register` | Public | Start a sign-up, claim or password reset |
| POST | `/api/auth/register/verify` | Public | Verify the LeetCode profile code |
| POST | `/api/auth/login` | Public | Log in |
| POST | `/api/logout` | Public | Log out |
| GET | `/api/auth/session` | Public | Current session state |
| PATCH | `/api/account/profile` | Member | Change the display name, school, bio and/or GitHub / LinkedIn / website links |
| POST | `/api/account/password` | Member | Change the password (needs the current one) |
| POST | `/api/account/delete` | Member | Delete the account (needs the password) |
| POST | `/api/refresh-all` | Admin | Refresh every member |
| DELETE | `/api/users/:id` | Admin | Remove a member |