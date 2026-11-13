# Security operations

How to watch Leeterboard for abuse, respond when something goes wrong, and
prove the backups work. Pairs with the controls described in the README's
Security section.

## 1. Security log

Security-relevant events are written as one JSON object per line (see
`securityLog.ts`). Passwords, verification codes, cookies, tokens and hashes
are never logged: fields with those names are redacted, and control characters
are stripped so a hostile username can't forge log lines.

```json
{"ts":"2026-10-27T09:14:02.511Z","level":"warn","type":"security","event":"login_failed","ip":"203.0.113.9","userId":"…","username":"someone","failures":3}
```

In Vercel, open the project's **Logs** and search for `"type":"security"`, or
for one event, e.g. `"event":"account_locked"`. Runtime logs are only kept for a
short time on most plans; forward them with a log drain to a service that keeps
history if you want to look back further than that.

| Event | Level | Meaning |
| --- | --- | --- |
| `login_failed` | warn | Wrong password (`failures`) or unknown user (`reason`) |
| `account_locked` | warn | An account hit the failed-login limit and is locked for 15 minutes |
| `login_blocked_locked` | warn | A login was refused because the account is locked |
| `reauth_failed` | warn | Wrong current password on a password change or account deletion (`action`) |
| `ownership_started` | info | An ownership challenge was issued (`purpose`: `reset` for a forgotten password, `link` for linking LeetCode; `platform`: `leetcode`, `codeforces` or `codingame`) |
| `ownership_verified` | info | Ownership proven (`purpose`: `reset` = password reset, `link` = LeetCode linked; `platform`) |
| `ownership_failed` | warn | Code not found, replayed challenge, or too many attempts (`reason`) |
| `ownership_lookup_unavailable` | warn | LeetCode, Codeforces or CodinGame didn't answer the ownership check, so the request was refused with a 503 (fail closed, no third-party fallback) |
| `ownership_blocked` | warn | A password reset was refused (`reason`: `unknown_user`, `not_linked`, `admin`, `name_not_found`, `sync_failing`, `changed`; `stage`: `start` or `verify`). The person always sees the same message |
| `password_reset_via_ownership` | warn | A password was replaced after an ownership proof (`warn` when the account already had one, `info` when it had none). The owner also gets an in-app notice |
| `platform_link_verified` / `platform_link_failed` | info / warn | Codeforces / CodinGame linking |
| `platform_unlinked` | info | A member removed a linked account (`platform`: `leetcode`, `codeforces` or `codingame`) |
| `password_changed` | info | A member changed their password (all older sessions are now invalid) |
| `account_created` | info | Someone completed sign-up with a verified OAuth identity (`userId`, `username`, `provider`, `maskedEmail`); a burst from one `ip` can mean automated sign-ups |
| `oauth_started` | info | An OAuth sign-in or account-linking flow was initiated (`provider`, `intent`: `signin` or `link`) |
| `oauth_login` | info | A member signed in with an existing connected OAuth identity (`provider`, `userId`) |
| `oauth_linked` | info | A member connected an OAuth provider to their account (`provider`, `userId`, `storedEmail`) |
| `oauth_unlinked` | info | A member disconnected an OAuth provider (`provider`, `userId`) |
| `oauth_failed` | warn | An OAuth callback or completion was refused or failed (`provider`, `reason`: `bad_state`, `expired_state`, `provider_error`, `email_missing`, `email_unverified`, `domain_refused`, `already_linked`, `email_in_use`, `admin_refused`, `timeout`, `server_error`, etc.) |
| `oauth_unconfigured` | warn | A visitor or member attempted to use an OAuth provider that is not configured or missing credentials (`route`) |
| `account_deleted` | info | A member deleted their own account (`confirmedWith`: `password`, or `username` for a member who has no password) |
| `admin_user_removed` | info | An admin removed a member (`admin`, `target`) |
| `admin_refresh` | info | An admin triggered a sync (`scope`: `member` or `all`) |
| `admin_message_sent` | info | An admin sent notifications (`to`, `recipients`) |
| `feedback_received` | info | Someone sent feedback (`userId` is null for a visitor, `category`, `length`; never the text) |
| `admin_feedback_deleted` | info | An admin deleted a piece of feedback (`feedbackId`) |
| `csrf_blocked` | warn | A cross-site or non-JSON write was rejected (`reason`) |
| `rate_limited` | warn | A rate limiter blocked a client (`limiter`) |

### What to alert on

Start with these thresholds and tune them to your real traffic.

| Signal | Suggested alert |
| --- | --- |
| Credential guessing | 10 or more `login_failed` from one `ip` in 10 minutes |
| Targeted account | any `account_locked`, or 5 or more `login_failed` for one `username` in 10 minutes |
| Account-takeover attempts | 5 or more `ownership_failed` for one `username` in an hour; any `ownership_verified` with `purpose":"reset"` that its owner doesn't recognise |
| LeetCode unreachable | a burst of `ownership_lookup_unavailable` (LeetCode may be blocking this server's IP, so password resets through LeetCode will fail until it clears) |
| OAuth flood or abuse | bursts of 10 or more `oauth_started` or `oauth_failed` from one `ip` in 10 minutes |
| Missing OAuth configuration | any `oauth_unconfigured`: someone tried to use a provider that is missing credentials or `PUBLIC_URL` |
| Account takeover / probing | repeated `oauth_failed` with `reason":"already_linked"` or `reason":"email_in_use"` |
| Unexpected provider connected | any `oauth_linked` on an account whose owner did not just connect one |
| Scraping / abuse | 20 or more `rate_limited` in 15 minutes, or any `admin_refresh` you didn't trigger |
| Request forgery | any burst of `csrf_blocked` |
| Privilege use | any `admin_*` event outside the times you were working |
| Infrastructure | a rise in 5xx responses, and in Turso rows read/written (a sudden jump can mean scraping or a leaked token) |

Alerts need a service that can run them on logs (a log drain into a tool with
alerting, or Vercel's own alerts if your plan includes them). Without one, make
a weekly habit of searching for `account_locked`, `ownership_failed` and
`admin_` events.

## 2. Incident response

Keep notes as you go (what you saw, when, what you changed). Preserve the logs
first: copy the relevant lines somewhere before they expire.

### Rotate compromised credentials

| What leaked | What to do |
| --- | --- |
| `JWT_SECRET` | Generate a new one (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`), set it in Vercel for the right environment, redeploy. **Every session is invalidated**, so everyone has to sign in again. |
| Turso auth token | Invalidate the old token (`turso db tokens invalidate <db>`), create a new one (`turso db tokens create <db>`), update `TURSO_AUTH_TOKEN` in Vercel, redeploy. Then check the data for tampering (see below). |
| A member's password or session | Have them reset it by proving ownership of an account they linked (`POST /api/auth/reset/start`, then `/verify`; the sign-in screen has no form for this yet), or set one with `npm run admin -- set-password <username>`. The reset is refused for admin accounts and for frozen accounts (see "Recycled LeetCode usernames" below). Setting a new password invalidates all of their existing sessions. |
| An admin account | Remove its id from `ADMIN_USER_IDS` (or its username from the deprecated `ADMIN_LEETCODE_USERNAMES`) in Vercel and redeploy, rotate `JWT_SECRET`, then review the admin log (below). Set a new password with `npm run admin -- set-password <username>`. |

Never paste a token or secret into an issue, a chat or a log. If one was, treat
it as leaked.

### Invalidate sessions

- **Everyone:** rotate `JWT_SECRET` (above).
- **One member:** a password change or reset invalidates their sessions. Deleting the account does too.
- **A member with no password** (created through Google or GitHub): their sessions are tied to the password hash, and they have none, so there is nothing to change that would sign them out. Their session ends by expiry (7 days), by deleting the account, or when everyone is signed out by rotating `JWT_SECRET`. This is a known limitation. If it ever matters, the fix is a per-member `session_version` column checked on every request; it is not built yet.

### Review recent administrator activity

Search the logs for `"event":"admin_` and check each `admin`, `ip` and time
against what you actually did. Also check `ownership_verified` events with
`"purpose":"reset"`, since those can hand over an account.

### Unauthorized score or account changes

1. Preserve the logs, then stop the bleeding: rotate `JWT_SECRET`, and rotate the Turso token if the database itself may be exposed.
2. Work out the window from the logs (`ownership_verified`, `admin_*`, `password_changed`) and from `users.last_updated` / the `history` table.
3. Recover from a backup **copy** (section 3): restore it into a new database, compare, and copy back only the rows that are wrong. Don't restore over production blindly.
4. An admin **Refresh all** re-reads genuine stats from LeetCode, which repairs scraped numbers; it can't repair profile text or ownership.
5. Tell affected members, and write down what let it happen and what you changed.

## 3. Backups and restore drills

The database holds password hashes, so treat a backup like production data:
store it encrypted, never commit it (the repository ignores `backups/`,
`*.dump.sql` and `*.db`), and delete copies you no longer need.

A backup is only proven when you have restored it. Do this drill after any
schema change and at least monthly:

```bash
# 1. Take a dump of production (needs the Turso CLI and access to the database).
turso db shell <production-db> .dump > backups/leeterboard-$(date +%F).dump.sql

# 2. Restore it into a NEW, throwaway database, never over production.
turso db create leeterboard-restore-test --from-dump backups/leeterboard-$(date +%F).dump.sql
#    (see `turso db create --help` for the options your CLI version supports; for
#     a purely local drill, `sqlite3 restored.db < backups/….dump.sql` works too)

# 3. Verify the copy. A remote copy needs its own token.
export RESTORE_TEST_AUTH_TOKEN=$(turso db tokens create leeterboard-restore-test)
npm run db:verify-backup -- --url libsql://<the-restore-test-db-url>
#    local copy:  npm run db:verify-backup -- --url file:./restored.db

# 4. Delete the throwaway database and the dump when you're done.
turso db destroy leeterboard-restore-test
```

`db:verify-backup` only reads. It checks the file's integrity, that every table
in `db/schema.sql` exists, that members and their password hashes came back, that
nothing points at a member that doesn't exist, and that the schema version is
recorded. It refuses to run against the database the app is configured to use.
If it reports a missing table on an older backup, run `npm run db:migrate` on
the **copy** and verify again.

Write the date and result of each drill down; an old, untested backup is not one
you can rely on.

## 4. Repository settings (not in the code)

These can't be switched on from a patch; enable them once in the GitHub
repository settings:

- **Code security:** Dependabot alerts and Dependabot security updates, secret scanning, and push protection (it blocks a commit that contains a recognised secret before it lands).
- **Branches:** protect `main` and require the `Security` and `CodeQL` checks to pass before merging.
- **CodeQL and CSRF:** `.github/codeql/codeql-config.yml` turns off one CodeQL rule, "Missing CSRF middleware" (`js/missing-token-validation`). It only recognises CSRF libraries like `csurf`, but leeterboard uses its own middleware (`csrf.ts`), so the rule flagged every route handler that reads `req.user`, and raised a new alert each time a route was added. The protection is verified by the CSRF tests in `tests/security.test.ts` (a required check) instead. Don't remove `csrf.ts`, or its `app.use("/api", csrfProtection)` line in `server.ts`, without putting equivalent protection and tests in its place.
- Pin third-party actions to a commit SHA once you're ready for that; `.github/dependabot.yml` already keeps the actions up to date.

## Forgot password, and recycled usernames

A member who can't sign in can reset their password by proving they own an
account they linked (LeetCode, Codeforces or CodinGame): the site gives a
one-time code, they put it in that account's public profile, and the site reads
it back. A member with nothing linked can't do this; they change their password
in their account settings (which asks for the old one), or an admin removes the
account and they sign up again.

A platform handle isn't a permanent identity: if its owner renames or deletes
that account, a stranger can register the name and pass the "put this code in
your profile" check. So the website refuses to reset:

- **admin accounts**, always. Admin rights follow the member's internal id
  (`ADMIN_USER_IDS`), never a username, and these accounts are recovered by you:
  `npm run admin -- set-password <username>` (hidden prompt, or
  `--password-stdin`; add `--confirm-remote` for a remote database).
- **through an account whose name stopped resolving.** The first time a sync
  gets "no such user" for a linked account, that account is frozen for password
  resets, and stays frozen even if the name later resolves again (that is exactly
  what a recycled name looks like). Each platform is frozen separately. Once you
  have checked the person is the original owner (ask them to message you from
  somewhere you already trust), lift it with
  `npm run admin -- approve-reset <username>`. If the name is still missing, the
  next failed sync freezes it again.
- **through an account whose syncs have failed for 7+ days**, until a sync
  succeeds.

The proof is always read from the account the *member* linked, never one the
requester names, and the new password is chosen at the start and held hashed on
the server, so nothing secret is sent twice. A successful reset signs out every
older session and leaves the owner a notice in the app.

Everyone sees one generic message ("can't be reset online") for every refusal,
so it can't be used to find out which usernames exist, who the admins are, or
which accounts are frozen.

**Alert on:** any `ownership_blocked` (someone tried), and any
`password_reset_via_ownership` for a member who didn't just ask for a reset.
Migrating admins: run `npm run admin -- show-id <username>` for each, set
`ADMIN_USER_IDS` to the ids, remove `ADMIN_LEETCODE_USERNAMES`, redeploy.

## OAuth sign-in and helping a member who lost access

Sign-up and authentication use Google and GitHub OAuth. Google or GitHub verifies the member's email address, so no email is ever sent by the server and no mail provider credentials are required.

- **PKCE & State**: Authorization requests use PKCE (`code_challenge` / `code_verifier`) and a cryptographically random, single-use `state` parameter (stored in an HttpOnly cookie and validated with constant-time equality). Expired or replayed state tokens are deleted and refused.
- **Strict Identity Matching**: A member is identified only by their provider's stable user ID (`oauth_identities`), never by email address. The server never links or signs into an existing member simply because an incoming OAuth profile shares an email.
- **Token Privacy**: Authorization codes, access tokens and client secrets are handled in memory on the server and are never persisted in the database, printed in logs, or exposed to the client.
- **Provider Setup**: A provider is enabled only when both its client ID and client secret are set, and `PUBLIC_URL` is set to the site origin (`https://...` in production). If a visitor attempts to use an unconfigured provider, the server logs `oauth_unconfigured` and redirects back to login with a friendly message. The dev-only fake provider (`OAUTH_DEV_PROVIDER_URL`) is blocked from booting in production.

**Helping a member who lost access:**

- *Has a connected provider (Google or GitHub)*: They click **Continue with Google** or **Continue with GitHub** on the sign-in modal to sign in directly.
- *Has a password (joined before OAuth)*: Normal login with username and password. If they forgot their password and have a linked account (LeetCode, Codeforces, or CodinGame), they can reset it via the proof-of-ownership challenge (`POST /api/auth/reset/start` and `/verify`).
- *Has neither, or cannot access their accounts*: Verify who they are through a channel you already trust (in person, campus directory, etc.), then set a new temporary password:
  ```bash
  npm run admin -- set-password <username>
  # For a remote production database:
  npm run admin -- set-password <username> --confirm-remote
  ```
  They can then sign in with that password, and connect Google or GitHub in **Account settings** (`#/account`).

## Verify a self-hosted deployment

Run these against the public URL after every deploy of a self-hosted copy
(Vercel serves the static files itself, see `vercel.json`):

```bash
# 1. Production mode: both headers must be present.
curl -sI https://YOUR-HOST/ | grep -i -E "content-security-policy|strict-transport-security"

# 2. The backend must not be downloadable: each of these must return the app's
#    HTML page (or 404), never JavaScript.
for p in server.cjs server.cjs.map server-dist/server.cjs dist/server.cjs; do
  curl -s -o /dev/null -w "$p -> %{http_code} %{content_type}\n" https://YOUR-HOST/$p
done
```

If (1) prints nothing, the app is running the dev server: start it with
`npm start` after `npm run build`. If (2) shows `javascript`, stop serving that
folder at once. The server bundle is only ever in `server-dist/`.
`npm run security:check` (also run in CI) fails if the build scripts put the
bundle where it would be served.
