# Leeterboard

A weekly LeetCode leaderboard. Members sign up with their LeetCode username, and the app tracks their solved counts, weekly and monthly progress, streaks and contest ratings, ranking everyone on a live board.

## Features

- **Leaderboard** ranked by weekly progress, all-time solved, or contest rating, with search and pinned members
- **Top-3 podium** for whichever ranking is selected
- **Rank movement arrows** (▲/▼) next to each name showing how many places a member has climbed or dropped since last week, with a NEW tag for members who just joined
- **Light and dark themes** with a toggle in the header; your choice is remembered, and it follows your system setting until you pick one
- **Stats page** with group trends, an activity heatmap and achievement badges
- **Automatic data** pulled from LeetCode: easy/medium/hard counts, streaks, contest rating and avatar
- **Freshness indicators** that flag members whose data has stopped updating
- **Account settings** to change your display name or password, or delete your account
- **Admin tools** to sync everyone at once and remove members

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

Logged-in members open **Account** in the header to:

- **Change their display name.** The avatar is not editable: it always comes from the member's LeetCode profile and refreshes automatically.
- **Change their password.** This needs the current password, keeps the current device signed in, and signs out every other device.
- **Delete their account.** This needs the password and permanently removes the member's stats and history. Signing up again starts from zero.

## Security

- Passwords are hashed with scrypt and a unique salt per password.
- An account locks for 15 minutes after 5 failed password attempts, whether at login or when confirming a password change or deletion. Attempts are also rate limited per IP.
- Unknown usernames and wrong passwords return the same error.
- Sessions are signed HTTP-only cookies. Resetting a password signs out all older sessions.
- Request bodies are size-limited, usernames are validated, and responses carry standard security headers.

## Data syncing

On a server that stays running, all members are refreshed every 30 minutes. On Vercel there is no background job, so the board syncs itself when someone visits: if it was last synced more than 30 minutes ago, the page asks the server to refresh the stale members (a few at a time, within a short time budget, continuing on the next visit if needed). An admin can still force a full refresh with the **Sync all** button, and any visitor can refresh a single member.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Build the frontend and bundle the server into `dist/` |
| `npm start` | Run the production build |
| `npm run lint` | Type-check the project |
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
| PATCH | `/api/account/profile` | Member | Change the display name |
| POST | `/api/account/password` | Member | Change the password (needs the current one) |
| POST | `/api/account/delete` | Member | Delete the account (needs the password) |
| POST | `/api/refresh-all` | Admin | Refresh every member |
| DELETE | `/api/users/:id` | Admin | Remove a member |