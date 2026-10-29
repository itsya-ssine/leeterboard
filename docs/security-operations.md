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
| `ownership_started` | info | A sign-up / claim / reset challenge was issued (`purpose`) |
| `ownership_verified` | info | LeetCode ownership proven; account `create`d, `claim`ed or `reset` |
| `ownership_failed` | warn | Code not found, replayed challenge, or too many attempts (`reason`) |
| `ownership_lookup_unavailable` | warn | LeetCode didn't answer the ownership check, so the request was refused with a 503 (fail closed, no third-party fallback) |
| `ownership_blocked` | warn | A claim/reset was refused because the account is an admin or is frozen (`reason`: `admin`, `name_not_found`, `sync_failing`; `stage`) |
| `password_reset_via_ownership` | warn | An account that already had a password had it replaced after an ownership proof. The owner also gets an in-app notice |
| `platform_link_verified` / `platform_link_failed` | info / warn | Codeforces / CodinGame linking |
| `password_changed` | info | A member changed their password (all older sessions are now invalid) |
| `account_deleted` | info | A member deleted their own account |
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
| LeetCode unreachable | a burst of `ownership_lookup_unavailable` (LeetCode may be blocking this server's IP, so sign-ups and resets will fail until it clears) |
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
| A member's password or session | Have them reset it from the Sign up tab (it proves LeetCode ownership). This is refused for admin accounts and for frozen accounts (see "Recycled LeetCode usernames" below). Setting a new password invalidates all of their existing sessions. |
| An admin account | Remove its id from `ADMIN_USER_IDS` (or its username from the deprecated `ADMIN_LEETCODE_USERNAMES`) in Vercel and redeploy, rotate `JWT_SECRET`, then review the admin log (below). Set a new password with `npm run admin -- set-password <username>`. |

Never paste a token or secret into an issue, a chat or a log. If one was, treat
it as leaked.

### Invalidate sessions

- **Everyone:** rotate `JWT_SECRET` (above).
- **One member:** a password change or reset invalidates their sessions. Deleting the account does too.

### Review recent administrator activity

Search the logs for `"event":"admin_` and check each `admin`, `ip` and time
against what you actually did. Also check `ownership_verified` events with
`"purpose":"reset"` or `"claim"`, since those can hand over an account.

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

## Recycled LeetCode usernames

A LeetCode username isn't a permanent identity: if its owner renames or deletes
their LeetCode account, a stranger can register that name and pass the "put this
code in your summary" check. So the website refuses to claim or reset:

- **admin accounts**, always. Admin rights follow the member's internal id
  (`ADMIN_USER_IDS`), never a username, and these accounts are recovered by you:
  `npm run admin -- set-password <username>` (hidden prompt, or
  `--password-stdin`; add `--confirm-remote` for a remote database).
- **accounts whose LeetCode name stopped resolving.** The first time a sync gets
  "no such user", the account is frozen, and stays frozen even if the name later
  resolves again (that is exactly what a recycled name looks like). Once you have
  checked the person is the original owner (ask them to message you from
  somewhere you already trust), lift it with
  `npm run admin -- approve-reset <username>`. If the name is still missing, the
  next failed sync freezes it again.
- accounts whose syncs have failed for 7+ days are refused too, until a sync
  succeeds.

Members see one generic message ("contact a Leeterboard admin") for every case,
so it can't be used to find out who the admins are.

**Alert on:** any `ownership_blocked` (someone tried), and any
`password_reset_via_ownership` for a member who didn't just ask for a reset.
Migrating admins: run `npm run admin -- show-id <username>` for each, set
`ADMIN_USER_IDS` to the ids, remove `ADMIN_LEETCODE_USERNAMES`, redeploy.
