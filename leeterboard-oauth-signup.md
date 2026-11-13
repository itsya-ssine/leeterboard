# Leeterboard: Sign in with Google / GitHub (replaces emailed codes)

Repo: https://github.com/itsya-ssine/leeterboard
Branch: **`feat/email-signup`** (same branch, continue after the 18 steps of `leeterboard-email-signup.md`)
Stack: React 19 + Vite + Tailwind 4 (frontend), Express + TypeScript (backend), SQLite/libSQL (local file or Turso), deployed on Vercel at https://leaderboard-leet.vercel.app

## Why this plan exists

The emailed-code sign-up needs a mail provider, and a mail provider needs a domain you own. There is no domain, so Resend can only mail the account owner. Instead of mailing codes, we let **Google or GitHub prove the email address**: the provider already verified it. When the sign-in succeeds, the server **stores that verified email in `users.email`** (with `email_verified_at`). No mail is ever sent, so the whole mail and code machinery from the previous plan is removed in this same branch.

---

## How to use this file (instructions for the AI assistant)

This document is a hand-off plan. The user will give it to you repeatedly, saying which step they are on. Rules:

1. **Do only the step(s) the user names.** Do not jump ahead.
2. **Read the real code first.** Names marked *(confirm)* are guesses. Open the files named in the step and fix any mismatch before editing.
3. **Keep these three in sync** whenever the schema changes: `db/schema.sql`, the `MIGRATIONS` list in `db.ts`, and `initDb()`. `tests/schema-sync.test.ts` enforces it.
4. **Never edit an old migration.** Always append a new one. The latest is version 17 (`email_verification`), so the next are **18** and **19** *(confirm in `db.ts`)*.
5. **Gate on the server.** Hiding UI is not security. Every new route must be classified in `tests/gating.test.ts` (`PUBLIC_ROUTES` for visitors, `requireAuth` for members).
6. After each step, run `npm run lint` and `npm test`, and report what changed, which files were touched and what the user should test manually.
7. **Return a patch.** After each step, commit on `feat/email-signup` and give the change as a file: `git format-patch -1 --stdout > auth-oauth-step-N.patch` (check it applies on the previous step with `git apply --check`).
8. Update the checklist at the bottom of this file in your reply. Do not claim a step is done unless lint and tests pass.
9. **Never touch a production database.** Use throwaway databases in tests and a local `local.db` for development. **Never call the real Google or GitHub in tests**: use the fake provider from Step 3.
10. **Do not invent product decisions.** If a decision in the table below is "OPEN", ask the user before building the part that depends on it.
11. **Clean as you go.** When a step makes code, a test, an env variable or a doc line obsolete, remove it in that step or in the cleanup steps named here. At the end, nothing from the emailed-code flow may remain (Step 17 checks this).

---

## Goal

### Current behavior (on the branch)
- Sign-up = username + password + email, verified with a 6-digit code **mailed by Resend**. Forgot password also works by emailed code. Members can add an email in Account settings with a code.
- This cannot be deployed: no domain, so no verified sender, so no real member can receive a code.

### Target behavior
1. **New members sign up with Google or GitHub.** The provider proves the email. The member then chooses a public **username** (and optional display name). No password is needed.
2. The verified email is **stored in `users.email`** with `email_verified_at` the moment sign-up (or linking) succeeds. Emails stay private.
3. **Existing members keep working unchanged** (username + password). They can **connect** Google and/or GitHub in Account settings. They are never forced to.
4. Signing in with a connected provider logs the member in. This is also the password-recovery path for members who connected one.
5. **Nothing is ever matched by email alone** (see "Account takeover rules"). A provider identity (`provider` + the provider's stable user id) is the only thing that identifies a member.
6. Sign-up abuse is limited per IP. Each Google/GitHub account can create only one member.
7. All mail code is deleted: `mailer.ts`, `emailCodes.ts`, `emailLimit.ts`, the code routes, pending code table, Resend variables, UI and tests.

### How the sign-in works (Authorization Code flow with PKCE)
1. The browser goes to `GET /api/auth/oauth/:provider/start`. The server creates a one-time **state** row (random id, provider, PKCE verifier, intent, optional user id), sets an HttpOnly `oauth_state` cookie holding the state id, and answers **302** to the provider with `state`, `code_challenge` (S256) and a fixed `redirect_uri`.
2. The member approves at Google/GitHub. The provider redirects to `GET /api/auth/oauth/:provider/callback?code=...&state=...`.
3. The server checks that the cookie equals `state`, atomically consumes the state row, exchanges the `code` for the member's profile **server-to-server**, and requires a **verified** email. Tokens are used once and thrown away. They are never stored or logged.
4. Then one of three things happens:
   - **Known identity** (provider + provider user id already stored) → sign that member in.
   - **Link intent** (a signed-in member connecting a provider) → attach the identity to that member and store the email if they have none.
   - **New identity** → store a short-lived pending sign-up (provider, provider user id, verified email), set an HttpOnly `oauth_signup` cookie, and send the browser to the "choose your username" screen. `POST /api/auth/oauth/complete` creates the member, **stores the email**, stores the identity and signs them in.

### Account takeover rules (the important part)
- **Never sign someone in, or attach an identity, because an email matches.** Only `(provider, provider_user_id)` or an explicit signed-in link action does that.
- Only accept an email the provider marks **verified** (`email_verified` for Google, primary + verified entry from `/user/emails` for GitHub). Otherwise refuse.
- If a new identity's email is **already used by another member**, refuse with a clear message ("An account already uses this email. Sign in the way you did before, then connect this provider in Account settings."). The visitor proved they own that email, so this reveals nothing to a stranger.
- Connecting a provider needs the signed-in session **and, for members who have a password, their current password** (reuse `checkCurrentPassword`).
- Disconnecting is allowed only if the member keeps another way to sign in (a password or another provider).
- Admin accounts: see D5.

### Key design decisions
| Topic | Decision |
|---|---|
| Login for existing members | Unchanged: **username + password**. |
| New sign-ups | **Google or GitHub only** (D3). The username is chosen after the provider step, because usernames are public on profiles. |
| Passwords for OAuth-created members | None (`password_hash` stays empty, which the code already supports for "no password yet" accounts). They sign in with the provider. |
| Email | Comes from the provider, **never typed by the member**, so it is always verified. Stored lowercase, unique on `lower(email)`. Private: never in `/api/users`, boards, profiles, admin tables, logs. |
| Library | **No new dependency.** Plain `fetch` with a timeout. The code exchange goes over TLS straight to the provider's token endpoint, so reading the profile from the provider's own userinfo endpoint is enough (no JWT verification library). |
| Redirects | Fixed targets only. **No `next`/return URL parameter** (open-redirect risk). Failures redirect to `/#/login` with an error code from a fixed list. |
| `redirect_uri` | Built from the **`PUBLIC_URL`** env variable, never from the `Host` header. |
| State storage | In the database (Vercel runs many instances). Cookie: HttpOnly, Secure in production, **SameSite=Lax** (Lax cookies are sent on the provider's top-level redirect back). |
| Rate limits | New `oauthLimiter` (per IP, in `DbRateLimitStore`) on start, callback and complete. Pending rows expire (10 minutes for state, 15 for pending sign-up) and are pruned opportunistically. |
| Unconfigured | A provider is **enabled only if both its id and secret are set**. If none is enabled in production, new sign-up shows "Sign-up is temporarily unavailable" and logs `oauth_unconfigured`. Existing password login keeps working. |
| Dev and tests | A **fake provider** (`tests/fake-oauth.mjs`) plus a dev-only endpoint override, **refused in production** (same pattern as the old `outbox` guard). |
| Domain restriction | Existing `ALLOWED_EMAIL_DOMAINS` is kept: a new identity whose email is outside the list is refused. Empty = any (D2). |

### Decisions the user must still make (ask before the dependent step)
| # | Question | Default if the user has no preference | Needed by |
|---|---|---|---|
| D1 | Which providers: GitHub only, Google only, or both? | **Both**, GitHub built first (simplest to set up for a coding community) | Step 3 and deployment |
| D2 | Restrict sign-up to certain email domains? Which? | No restriction | Step 6 |
| D3 | Keep a password sign-up route as well, or **OAuth only** for new members? | **OAuth only** (one account per Google/GitHub identity is the whole point) | Step 6 |
| D4 | How do members **without a password** confirm "delete my account"? | **Type their username** to confirm (alternative: sign in again with the provider) | Step 9 |
| D5 | Can **admin accounts** use or connect OAuth? | **No**: admins keep password login only, like the admin password-reset rule | Step 8 |
| D6 | Squash migration 17 (never reached production) or append 18/19? | **Append** (keeps rule 4; the extra create-then-drop of an empty table is harmless) | Step 1 |
| D7 | Require existing members to connect a provider by some date? | **No, optional** | Step 13 |

---

## Relevant code map (from reading the repo)

- `server.ts` (3053 lines): routes. To remove: `POST /api/auth/register/start`, `/register/verify`, `/api/auth/reset/email/start`, `/reset/email/verify`, `POST /api/account/email/start`, `/email/verify`, the `SIGNUP_COOKIE`/`RESET_EMAIL_COOKIE` cookies and message constants. To keep: login, session, `/api/auth/reset/start` and `/verify` (proof-of-ownership reset), `checkCurrentPassword` (drop the `"email_change"` action), `viewerOf`, `SESSION_REQUIRED_BODY`.
- `db.ts`: `MIGRATIONS` (latest 17), `initDb()`, `rowToUser` (**must not map `email`**), `getUserEmail`, `setUserEmail`, `getUserByEmail`, `emailTaken`, `insertUser`, plus the pending-code helpers to delete (`createPendingEmailCode`, `startPendingEmailCode`, `consumePendingEmailCode`, ... *(confirm names)*).
- `emails.ts`: keep `normalizeEmail`, `maskEmail`, `parseAllowedDomains` and the domain check; delete `checkEmail` parts only the typed-email flow used *(confirm what is still used)*.
- To delete: `mailer.ts`, `emailCodes.ts`, `emailLimit.ts`.
- `securityLog.ts`: events and the redaction regex (`^email$`, `code`, `token` stay redacted).
- `rateLimit.ts`, `rateLimitStore.ts`: add `oauthLimiter`.
- `csrf.ts`: GET routes pass untouched; `POST /api/auth/oauth/complete` must be same-origin JSON like the others. `securityHeaders.ts`/`vercel.json`: **no change needed** (full-page redirects are not blocked by `connect-src` or `form-action`; use a link or `location.assign`, never a `<form>` post to the provider).
- Frontend: `src/LoginModal.tsx` (615 lines, two-step code UI to replace), `src/AuthContext.tsx`, `src/authApi.ts`, `src/signup.ts`, `src/signupFlow.ts`, `src/AccountPage.tsx` (`EmailCard`), `src/SessionGate.tsx`.
- Tests that go away or get rewritten: `account-email`, `email-card`, `email-codes`, `email-db` (partly), `email-limit`, `emails` (partly), `fake-mail*`, `mail-boot`, `mailer`, `migration-email` (keep: it tests migration 17), `register*`, `reset-email`, parts of `auth-api`, `email-privacy`, `schema-sync`, `gating`, `signup-flow`, `signup-form`.

---

## Provider setup (the user does this, outside the code)

Do this before Step 5 (local) and before deployment (production). Keep every client secret server-side only (never a `VITE_` variable, never in chat, issues or logs).

**GitHub**
1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**.
2. Homepage URL: your site URL. Authorization callback URL: exactly `<PUBLIC_URL>/api/auth/oauth/github/callback`.
3. A GitHub OAuth app has **one** callback URL, so create **two apps**: "Leeterboard (dev)" with `http://localhost:3000/api/auth/oauth/github/callback`, and "Leeterboard" with `https://leaderboard-leet.vercel.app/api/auth/oauth/github/callback`.
4. Generate a client secret and copy it once.

**Google**
1. https://console.cloud.google.com → create a project → **APIs & Services → OAuth consent screen**: user type External, app name, support email, scopes `openid`, `email`, `profile`. **Publish the app**; in "Testing" mode only listed test users can sign in. These basic scopes do not need Google's verification review.
2. **Credentials → Create credentials → OAuth client ID → Web application.** Authorized redirect URIs: `http://localhost:3000/api/auth/oauth/google/callback` and `https://leaderboard-leet.vercel.app/api/auth/oauth/google/callback`.
3. Copy the client id and secret.

Preview deployments on Vercel have changing URLs. Leave the OAuth variables unset for Preview (the feature is then simply off there) or give Preview its own apps.

### New environment variables
| Variable | Required | Description |
|---|---|---|
| `PUBLIC_URL` | Yes in production | The site's public origin, for example `https://leaderboard-leet.vercel.app` (no trailing slash). Used to build `redirect_uri`. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | To enable GitHub | From the GitHub OAuth app. Both or neither. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | To enable Google | From the Google OAuth client. Both or neither. |
| `ALLOWED_EMAIL_DOMAINS` | No | Kept from before: comma-separated domains allowed to sign up. Empty = any. |
| `OAUTH_DEV_PROVIDER_URL` | Dev and tests only | Base URL of the fake provider. **The server refuses to start with it in production.** |

Removed: `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_OUTBOX_DIR`. The Resend account and the unverified domain can be deleted.

---

## Phase 1: Database and pure helpers

### Step 1. Migration 18: OAuth tables
Add, in `initDb()`, `db/schema.sql` and a new migration (v18). **Additive only.** Do not drop anything yet (the old code still uses `pending_email_codes` until Step 10).

```sql
-- Who a member can sign in as. The provider's stable user id, never the email.
CREATE TABLE oauth_identities (
  provider          TEXT NOT NULL CHECK (provider IN ('github', 'google')),
  provider_user_id  TEXT NOT NULL,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at        TEXT NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);
CREATE UNIQUE INDEX idx_oauth_identities_user_provider ON oauth_identities(user_id, provider);

-- One row per sign-in attempt in flight. The browser only holds `id` (cookie).
CREATE TABLE oauth_states (
  id             TEXT PRIMARY KEY,                -- random, 128 bits
  provider       TEXT NOT NULL CHECK (provider IN ('github', 'google')),
  intent         TEXT NOT NULL CHECK (intent IN ('signin', 'link')),
  user_id        TEXT REFERENCES users(id) ON DELETE CASCADE,  -- link only
  code_verifier  TEXT NOT NULL,                   -- PKCE secret, never sent to the browser
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL
);
CREATE INDEX idx_oauth_states_expires ON oauth_states(expires_at);

-- A verified identity waiting for the member to choose a username.
CREATE TABLE pending_oauth_signups (
  id                TEXT PRIMARY KEY,             -- random, 128 bits (cookie)
  provider          TEXT NOT NULL CHECK (provider IN ('github', 'google')),
  provider_user_id  TEXT NOT NULL,
  email             TEXT NOT NULL,                -- lowercase, provider-verified
  display_name      TEXT,                         -- suggestion from the provider, cleaned
  created_at        TEXT NOT NULL,
  expires_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_pending_oauth_signups_identity ON pending_oauth_signups(provider, provider_user_id);
CREATE INDEX idx_pending_oauth_signups_expires ON pending_oauth_signups(expires_at);
```

Add `tests/migration-oauth.test.ts` following `migration-email.test.ts` (old-shaped database, rows kept, runs once). `schema-sync.test.ts` must still pass.

### Step 2. `oauth.ts`: pure helpers (no I/O)
Unit-tested like `usernames.ts`:
- `generatePkce()` → `{ verifier, challenge }` (verifier from `crypto.randomBytes`, challenge = base64url SHA-256, method S256).
- `newStateId()` (128-bit random, hex) and `stateMatches(cookieValue, queryValue)` using `crypto.timingSafeEqual` on equal-length buffers; false on malformed input instead of throwing.
- `readOAuthConfig(env)` → which providers are enabled (both id and secret set), the validated `PUBLIC_URL`, and `redirectUri(provider)`. Refuses a `PUBLIC_URL` that is not `https://` in production, has a path, or a trailing slash.
- `buildAuthorizeUrl(provider, { state, challenge, redirectUri, clientId })`: GitHub `https://github.com/login/oauth/authorize` with scope `read:user user:email`; Google `https://accounts.google.com/o/oauth2/v2/auth` with `response_type=code`, scope `openid email profile`, `prompt=select_account`.
- `pickGithubEmail(list)`: the entry that is `primary` **and** `verified`, else `null`.
- `parseGoogleUserinfo(json)`: requires `sub` and `email_verified === true`.
- `OAUTH_ERROR_CODES`: the fixed allow-list of codes the callback may put in the redirect (`cancelled`, `failed`, `unverified_email`, `email_in_use`, `domain_not_allowed`, `expired`, `unavailable`, `admin_refused`, `already_linked`).
- `checkEmailDomain(email, allowedDomains)`.

Ask the user D1 (providers) and D2 (domains) before wiring env handling.

---

## Phase 2: Server

### Step 3. Provider calls and the fake provider
- `oauthProviders.ts`: `exchangeAndFetchProfile(provider, code, verifier, config)` → `{ providerUserId, email, displayName }` or throws `OAuthError(kind)`. GitHub: `POST https://github.com/login/oauth/access_token` (header `Accept: application/json`), then `GET https://api.github.com/user` and `/user/emails` with `User-Agent` set. Google: `POST https://oauth2.googleapis.com/token`, then `GET https://openidconnect.googleapis.com/v1/userinfo`. *(Confirm endpoints against each provider's current docs.)*
- 8 second timeout on every call, **no retries**, no redirects followed to other hosts. Never log the code, tokens, secrets or the email. Treat a non-2xx or malformed answer as `OAuthError("failed")`; a timeout as `"unavailable"`.
- `OAUTH_DEV_PROVIDER_URL`: when set (non-production only), all four endpoints are read from that base so the fake provider can stand in. **Refuse to boot in production with it set**, and test that guard (copy `mail-boot.test.ts`).
- `tests/fake-oauth.mjs` (like `fake-leetcode.mjs`): a tiny HTTP server that can act as GitHub and Google, with switches for "unverified email", "no primary email", "wrong state", "slow", "bad token". Add a helper in `tests/f2-seed.ts` returning `{ env, setProfile, cleanup }`.

### Step 4. DB functions
In `db.ts`: `createOAuthState`, `consumeOAuthState` (**atomic**: delete and return only if it still exists and is unexpired, following the `consumePendingLink` pattern), `createPendingOAuthSignup` (replaces an open row for the same identity), `getPendingOAuthSignup`, `consumePendingOAuthSignup` (atomic), `getUserIdByOAuthIdentity`, `listOAuthProviders(userId)`, `addOAuthIdentity` (unique violation → typed error), `removeOAuthIdentity`, `countSignInMethods(userId)` (password present + providers), `deleteExpiredOAuthRows`, and `insertUserWithIdentity` that creates the user (`email`, `email_verified_at = now`, no password, no LeetCode) **and** its identity in one transaction/batch so a failure leaves neither.

`rowToUser` must still **not** map `email`. Reuse `getUserEmail`.

### Step 5. `GET /api/auth/oauth/:provider/start` and `GET /callback`: known identity sign-in
Public. Middleware: `oauthLimiter` (add to `rateLimit.ts`, `DbRateLimitStore("oauth")`, 30 per 15 minutes per IP).
- `start`: provider not in the enabled set → redirect `/#/login?oauth_error=unavailable` (and `oauth_unconfigured` event when none is enabled). Else prune expired rows, create the state row (`intent = signin`), set the `oauth_state` cookie (HttpOnly, SameSite=Lax, Secure in production, `maxAge` 10 min, `path=/api/auth/oauth`), **302** to the provider.
- `callback`: provider returned `error=access_denied` → `cancelled`. Check the cookie against `state` (constant time), consume the state row (one use), exchange the code, require a verified email. Then:
  - identity known → `setSessionCookie`, clear the state cookie, redirect to `/#/`. Log `oauth_login`.
  - identity unknown and intent `signin` → continue in Step 6.
  - Every failure clears the cookie and redirects to `/#/login?oauth_error=<code from the allow-list>`. Never echo provider text.
- Log events (no email, no code): `oauth_started`, `oauth_login`, `oauth_failed` (with `reason`), `oauth_unconfigured`. Add them to `securityLog.ts`.
- Update `tests/gating.test.ts` (`PUBLIC_ROUTES`).

### Step 6. New member: pending sign-up and `complete`
- In `callback`, for a new identity: refuse if `checkEmailDomain` fails (`domain_not_allowed`), refuse if `emailTaken(email)` (`email_in_use`), else create the pending sign-up, set the `oauth_signup` cookie (same options, `maxAge` 15 min, `path=/api/auth`) and redirect to `/#/signup/username`.
- `GET /api/auth/oauth/pending` (public, `oauthLimiter`): returns `{ provider, maskedEmail, suggestedDisplayName }` for the cookie's pending row, or 400 "This sign-up has expired. Please start again."
- `POST /api/auth/oauth/complete` (public, `oauthLimiter`): body `{ username, displayName? }`. Validate with the existing `usernames.ts` rules and display-name cleaning. Taken username (any case) → **409**. Consume the pending row atomically, call `insertUserWithIdentity` (email stored lowercase, `email_verified_at` set), set the session cookie, answer 201 with the member. Unique-index races (username or email) answer 409 with a clear message. Log `account_created` with the masked email and provider.
- D3: if the user wants password sign-up kept as well, ask before this step and add it as a separate step.

### Step 7. Connect and disconnect (existing members)
- `POST /api/account/oauth/:provider/start` (`requireAuth`, `accountLimiter`): body `{ currentPassword }` when the member has a password (use `checkCurrentPassword`, new action name `"oauth_link"`); no password needed for members who have none. Creates a state row with `intent = link` and `user_id`, sets the cookie, answers `{ url }` (the provider authorize URL). The frontend then does `window.location.assign(url)`.
- `callback` with intent `link`: the session cookie must still belong to `state.user_id` (else `failed`). If the identity already belongs to **another** member → `already_linked`. If the member has no email, store the provider's verified email (`setUserEmail`, `email_verified_at`); if the email belongs to a different member, `email_in_use`. If the member already has an email, keep it (do not overwrite). Redirect to `/#/account?connected=<provider>`. Log `oauth_linked`.
- `DELETE /api/account/oauth/:provider` (`requireAuth`, `accountLimiter`): refuse with 409 if it is the member's last way to sign in (`countSignInMethods`). Log `oauth_unlinked`.

### Step 8. Session payload and admin rule
- `GET /api/auth/session` returns, for the signed-in member, **their own** `email` (masked fields are the UI's job), `emailVerified`, `signInMethods: { password: boolean, providers: string[] }`, and for everyone the `oauthProviders` list of enabled providers (so the UI only shows configured buttons). No other response includes an email. Add a test that `/api/users` for another member has neither an `email` key nor the address string.
- D5: when the user confirms the default, an admin account (`isAdminUser`) cannot sign in with OAuth or connect a provider. The answer is the same `admin_refused` redirect/message. Mirror the way the old email reset refused admins.

### Step 9. Accounts without a password
- `checkCurrentPassword` currently answers 409 "no password yet ... use Forgot password". Rewrite that path: **delete account** for a member with no password follows D4 (default: they must type their exact username in `{ confirmUsername }`). **Change password** is not offered to a member with no password (the UI hides it). Keep every other rule (lockout, `reauth_failed` log).
- Add tests for: OAuth-created member cannot log in with an empty password, cannot be locked out into a bad state, can delete their account, and deleting removes identities, email and pending rows through `ON DELETE CASCADE`.
- Known limitation, document it (do not fix here): sessions are bound to the password hash, so a member without a password cannot be "signed out everywhere" except by expiry (7 days). A `session_version` column is a possible later change.

---

## Phase 3: Remove the emailed-code flow (backend and database)

### Step 10. Delete the mail and code backend
Remove, and fix every import:
- Files: `mailer.ts`, `emailCodes.ts`, `emailLimit.ts`.
- `server.ts`: `POST /api/auth/register/start`, `/register/verify`, `POST /api/auth/reset/email/start`, `/reset/email/verify`, `POST /api/account/email/start`, `/email/verify`, the `SIGNUP_COOKIE`, `RESET_EMAIL_COOKIE`, TTL constants, message constants, `getMailer()` boot warning and the `"email_change"` action.
- `db.ts`: all pending-email-code functions and types.
- `securityLog.ts`: the mail/code events (`signup_code_*`, `signup_notice_sent`, `email_code_*`, `email_notice_sent`, `email_verified` as a code event, `reset_email_blocked`, `password_reset_via_email`, `mail_unconfigured`, `mail_send_failed`) and the matching header comment. Keep `account_created`.
- **Migration 19** `drop_pending_email_codes`: `DROP TABLE IF EXISTS pending_email_codes` (it never held production data because migration 17 never reached production). Update `db/schema.sql` and `initDb()` so a fresh database does not create it, and keep `schema-sync.test.ts` green. Test it with an old-shaped database that still has the table.
- `.env.example`: remove the mail block, add the OAuth variables.
- `tests/gating.test.ts`: remove the old routes from `PUBLIC_ROUTES`.

### Step 11. Delete and rewrite the old tests
Delete: `mailer`, `mail-boot` (keep the idea for `OAUTH_DEV_PROVIDER_URL`), `fake-mail.test.ts`, `fake-mail.mjs`, `email-codes`, `email-limit`, `register-start`, `register-verify`, `reset-email`, `account-email`. Rewrite `register.test.ts`, `signup-flow`, `auth-api`, `email-privacy`, `email-db`, `emails` to the new behavior. Replace the `registerViaApi` helper in `tests/helpers.ts` with `signUpViaOAuth(api, fakeOAuth, { provider, email, username })` that runs start → callback → complete and returns the cookie. Tests that insert members with `db.insertUser` need no change.

---

## Phase 4: Frontend

### Step 12. `authApi.ts`, `AuthContext`, `signup.ts`
- Remove `requestSignupCode`, `submitSignupCode`, `requestEmailCode`, `submitEmailCode`, `requestResetCode`, `submitResetCode` and their types (`EmailCodeChallenge`, `EmailVerifiedResult`, `PasswordResetChallenge` if unused).
- Add: `startOAuthSignIn(provider)` (`window.location.assign('/api/auth/oauth/<provider>/start')`), `fetchPendingOAuthSignup()`, `completeOAuthSignup(username, displayName?)`, `startOAuthLink(provider, currentPassword?)`, `unlinkOAuth(provider)`. Keep the 401 and `session_required` behavior untouched.
- `src/signup.ts`: keep `checkSignup`/username checks, drop email/password sign-up checks that are no longer used.
- Expose `oauthProviders`, `email`, `emailVerified` and `signInMethods` from the session state.

### Step 13. `LoginModal` and the username step
- **Log in tab:** username + password (existing members) and, under a divider, "Continue with GitHub" / "Continue with Google" (only for providers in `oauthProviders`). Replace the old "Forgot password?" email form by one line: "Forgot your password? If you connected GitHub or Google, use that button. Otherwise ask an admin." (The proof-of-ownership reset stays available through the API.)
- **Sign up tab:** just the provider buttons and a short explanation ("We use Google or GitHub to confirm your email. We never see your password for them."). No password field. If no provider is enabled, show "Sign-up is temporarily unavailable."
- **Username step** (shown on `#/signup/username` when `GET /api/auth/oauth/pending` succeeds): shows "Signed in with GitHub as a***@example.com", the username field with the existing inline checks and 409 message, optional display name, **Create account**. On success go to `#/account` with the existing `AFTER_SIGNUP_PROMPT`. Expired → back to the sign-up tab with a clear message.
- Read `?oauth_error=<code>` from the hash on `#/login`, map each allow-listed code to a friendly message (never display the raw value), then remove it from the URL. Keep keyboard and screen-reader behavior (focus the first field, errors with `role="alert"`).
- Delete the two-step code UI, the resend cooldown helper and the forgot-password-by-email form.

### Step 14. "Sign-in methods" card in Account settings
Replace `EmailCard` in `AccountPage.tsx`:
- Shows the masked email and "Verified" (or "No email yet. Connect GitHub or Google to add a verified one.").
- One row per provider: **Connect** (asks for the current password first when the member has one, then redirects) or **Disconnect** (disabled with a hint when it is their last way to sign in).
- Shows a notice after returning from a connect (`?connected=github`) and the same friendly error messages as the login screen.
- Hide the change-password and delete-with-password parts that do not apply to members without a password; show the D4 confirmation instead.
- Never show an email to anyone else (profile, board, admin tables).

### Step 15. Frontend cleanup
Delete `src/signupFlow.ts` (or reduce it to what is still used), the code-entry component, `email-card.test.ts`, and any CSS only they used. Rewrite `signup-form.test.ts` and `signup-flow.test.ts` for the new helpers (provider button visibility, `oauth_error` mapping, "last sign-in method" rule), plus a source check that `LoginModal` no longer calls any removed route.

---

## Phase 5: Tests, cleanup, docs, deployment

### Step 16. Tests to have (names are suggestions)
- `oauth.test.ts`: PKCE, state compare (timing-safe, malformed input), config (enabled only with id **and** secret, bad `PUBLIC_URL`), authorize URLs, `pickGithubEmail`, `parseGoogleUserinfo`, error code allow-list.
- `oauth-db.test.ts`: state and pending rows are single use and expire; atomic consume (two simultaneous consumes, one wins); `insertUserWithIdentity` leaves nothing behind on a username or email conflict.
- `oauth-signin.test.ts` (with the fake provider): known identity signs in; wrong or missing `state` cookie → rejected; replayed `state` → rejected; provider says cancelled → friendly redirect; unverified email → refused; GitHub with no primary verified email → refused; provider timeout → `unavailable`; the redirect never contains a user-controlled URL.
- `oauth-signup.test.ts`: full new-member flow stores the email lowercase with `email_verified_at`; pending expires; username taken (any case) → 409 at complete; email already used by another member → refused without creating anything; domain outside `ALLOWED_EMAIL_DOMAINS` refused; the same provider identity cannot create two members; rate limit applies.
- `oauth-link.test.ts`: connect needs a session and the current password; identity owned by another member refused; email stored only when the member had none; disconnect refused as the last method; admin refused (D5).
- `oauth-takeover.test.ts`: a provider account with the same email as an existing member **cannot** sign in as, or attach to, that member.
- `oauth-privacy.test.ts` (extends `email-privacy`): `/api/users`, `/api/auth/session` for another member, admin tables and every log line contain no email, no `code`, no token.
- `oauth-boot.test.ts`: `OAUTH_DEV_PROVIDER_URL` refuses to boot in production; production without any provider enabled logs `oauth_unconfigured` and keeps password login working.
- Update `gating.test.ts` for every new route and the rate-limit assertions.

### Step 17. Dead-code sweep
- `grep -rniE "mailer|emailCodes|emailLimit|pending_email_codes|resend|EMAIL_PROVIDER|EMAIL_API_KEY|EMAIL_FROM|EMAIL_OUTBOX|outbox|signup_code|email_code|registerViaApi" --exclude-dir=node_modules --exclude-dir=.git .` must return nothing, except the history lines inside `MIGRATIONS` (migration 17/19 names) and old comments you decide to keep.
- Run `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` once and remove what it flags in files this branch touched. Do **not** add a new dependency for dead-code detection.
- Remove unused exports from `emails.ts`, `db.ts` and `src/`.
- `npm run lint`, `npm test`, `npm run audit:prod`, `npm run build`. Run `npm run security:check` only if `index.html`, `securityHeaders.ts` or `vercel.json` were touched (they should not be).

### Step 18. Docs
- `README.md`: Accounts (sign-up with Google/GitHub, username step, existing members, connecting providers, password recovery), Account settings, Configuration (new variables, removed ones), Security (OAuth rules: PKCE, state, no email matching, tokens never stored, emails private), API table, Rate limits table, Project structure (remove `emails`/`emailCodes`/`emailLimit`/`mailer`, add `oauth.ts`, `oauthProviders.ts`). Fix the intro line and the Getting started note about `EMAIL_PROVIDER=outbox` (replace with how to run with the fake provider or real dev OAuth apps).
- `db/schema.sql`: new tables with comments, `pending_email_codes` gone.
- `docs/security-operations.md`: replace the email-code events and the "Email codes and helping a member who lost access" section with the OAuth events and the help steps (see below).
- `.env.example` finalized.

**Alerts to document:** bursts of `oauth_started` or `oauth_failed` from one IP; any `oauth_unconfigured`; repeated `already_linked` / `email_in_use` refusals (someone probing); any `oauth_linked` on an account the owner did not just change.
**Helping a member who lost access:** has a connected provider → sign in with it. Has a password → normal login or proof-of-ownership reset. Has neither → verify who they are somewhere you already trust, then `npm run admin -- set-password <username>` (add `--confirm-remote` for a remote database).

### Deployment order
1. Create the OAuth apps (see "Provider setup"). Test locally with the dev apps first.
2. In Vercel → Settings → Environment Variables (Production): `PUBLIC_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and/or the Google pair. Remove the `EMAIL_*` variables if you ever added them. Leave Preview empty unless it has its own OAuth apps.
3. Snapshot Turso, then run `npm run db:migrate -- --confirm-remote`. Migrations 17 and 18 are additive; 19 drops a table that never held data.
4. Merge `feat/email-signup` into `main` (frontend and API deploy together; open tabs need a refresh).
5. Test on the live site: sign up with a fresh GitHub (or Google) account and check the email is stored (as the admin, or in the database); sign out and back in with the provider; sign in as an existing password member; connect a provider in Account settings; disconnect one.
6. Tell existing members: nothing changes for them, and they can connect GitHub or Google in Account settings.

---

## Do not (security checklist for every step)

- Do not match, sign in or link an account **by email**. Only the provider identity or an explicit signed-in link action.
- Do not accept an email the provider does not mark verified.
- Do not skip the `state` check, the PKCE verifier or the one-use consumption of state rows.
- Do not build `redirect_uri` from the `Host` header, and do not accept a return URL from the request.
- Do not store, return or log authorization codes, access tokens, client secrets or full email addresses.
- Do not add `email` to the `User` mapping used by `/api/users`, boards, profiles or admin tables.
- Do not put a client secret in a `VITE_` variable or in the frontend bundle.
- Do not let `OAUTH_DEV_PROVIDER_URL` work in production.
- Do not call the real Google or GitHub in tests.
- Do not leave removed mail or code files, routes, tests, env variables or doc lines behind.
- Do not forget the server-side checks: the UI hiding a button is not security.

---

## Suggested commit grouping

1. **Database and helpers** (Steps 1-4).
2. **OAuth routes** (Steps 5-9).
3. **Cleanup of the mail flow** (Steps 10-11).
4. **Frontend** (Steps 12-15).
5. **Tests, sweep, docs, deployment notes** (Steps 16-18).

---

## Progress checklist

Replace `[ ]` with `[x]` as steps are verified. (Steps 1-18 of the previous plan are done; the old code is removed by Steps 10-15 below.)

- [x] 1. Migration 18: OAuth tables, schema-sync test, migration test
- [x] 2. `oauth.ts` pure helpers and tests
- [x] 3. `oauthProviders.ts`, fake provider, production guard
- [x] 4. DB functions for states, pending sign-ups and identities
- [x] 5. `/start` and `/callback`: sign in with a known identity
- [x] 6. New member: pending sign-up, `/pending`, `/complete` (stores the verified email)
- [x] 7. Connect and disconnect for existing members
- [x] 8. Session payload (own email, sign-in methods, enabled providers) and admin rule
- [x] 9. Members without a password (delete confirmation, no change-password)
- [x] 10. Delete mailer, code routes and the pending-code table (migration 19)
- [x] 11. Old tests deleted, rewritten tests and helper
- [x] 12. `authApi.ts`, `AuthContext`, `signup.ts`
- [x] 13. `LoginModal`: provider buttons and username step
- [x] 14. "Sign-in methods" card in Account settings
- [x] 15. Frontend cleanup and tests
- [x] 16. All new tests in place
- [x] 17. Dead-code sweep, lint / test / audit / build pass
- [x] 18. README, schema, `.env.example` and security docs updated
- [ ] OAuth apps created, Vercel variables set
- [ ] Deployment done

---

## Prompt templates the user can paste with this file

**Start a step:**
> Here is `leeterboard-oauth-signup.md`. I am on **Step N** on branch `feat/email-signup`. Read the real code first, do only that step, run lint and tests, tell me what I should test manually, update the checklist, and give me the change as a `.patch` file.

**Resume after a break:**
> Here is `leeterboard-oauth-signup.md`. Steps 1 to N are done on `feat/email-signup`. Check `git log` to confirm, then do **Step N+1** only.

**Review a step:**
> Review the change for **Step N** of `leeterboard-oauth-signup.md` against the "Do not" checklist. List anything that matches accounts by email, leaks an email, a code or a token, skips the state check, or any route missing from `tests/gating.test.ts`, and any leftover code from the emailed-code flow.

**Hit a decision:**
> Step N depends on decision D1 to D7. Ask me what I want, record my answer at the top of this file, then continue.
