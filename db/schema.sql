-- Leeterboard database schema (SQLite / Turso, via @libsql/client).
--
-- This file is documentation of the CURRENT schema. The source of truth for
-- changes is the MIGRATIONS list in db.ts; a fresh database is created from the
-- same statements in initDb(). Keep the three in step.
--
--   users ─┬─< history           (1 member : many daily snapshots)
--          ├─< notifications     (1 member : many notifications)
--          ├─< user_awards       (1 member : many already-announced awards)
--          ├─  sync_status       (1 member : 1 latest sync result)
--          ├─< platform_accounts (1 member : 0..2 linked Codeforces / CodinGame accounts)
--          ├─< platform_history  (1 member : many daily snapshots per linked platform)
--          ├─< platform_sync_status (1 member : 1 latest sync result per linked platform)
--          ├─< feedback          (0..1 member : many; NULL for visitors and deleted accounts)
--          ├─< pending_links     (1 member : open "prove you own this account" requests)
--          ├─< pending_resets    (1 member : open "forgot password" requests)
--          ├─< oauth_identities  (1 member : 0..2 Google / GitHub accounts they can sign in with)
--          └─< oauth_states      (0..1 member : sign-in attempts in flight; NULL user for a sign-in)
--   pending_oauth_signups        (standalone; a verified Google / GitHub identity waiting for a username)
--   pending_registrations        (standalone; UNUSED, kept empty for rollback; see below)
--   meta                         (standalone key/value)
--   schema_migrations            (standalone; migration bookkeeping)

-- One row per member. A new member signs up with Google or GitHub and a chosen
-- username, and the e-mail the provider verified is stored (members who joined
-- before that have a password and may have no e-mail); every
-- LeetCode column below stays empty until they link a LeetCode account (see
-- leetcode_username), and only members who linked it are on the LeetCode board.
CREATE TABLE users (
  id                 TEXT PRIMARY KEY,
  display_name       TEXT NOT NULL,
  login_username     TEXT,                         -- site login name, lowercase, unique (migration 13; backfilled from leetcode_username)
  leetcode_username  TEXT,                         -- NULL = no LeetCode linked (optional since migration 14); unique when set
  avatar_url         TEXT,
  school             TEXT NOT NULL DEFAULT '',     -- optional, member-edited; shown as a tag on the board
  bio                TEXT NOT NULL DEFAULT '',     -- optional short bio (profile page)
  github_url         TEXT NOT NULL DEFAULT '',     -- optional, validated https://github.com/... link
  linkedin_url       TEXT NOT NULL DEFAULT '',     -- optional, validated https://...linkedin.com/... link
  website_url        TEXT NOT NULL DEFAULT '',     -- optional http(s) link to a portfolio / site
  hide_leetcode_stats INTEGER NOT NULL DEFAULT 0,  -- 1 = LeetCode stats hidden on the profile (still on the board)

  -- Current stats, refreshed by every sync.
  all_time_solved    INTEGER NOT NULL DEFAULT 0,
  easy_solved        INTEGER NOT NULL DEFAULT 0,
  medium_solved      INTEGER NOT NULL DEFAULT 0,
  hard_solved        INTEGER NOT NULL DEFAULT 0,
  weekly_progress    INTEGER NOT NULL DEFAULT 0,   -- solved this calendar week (Mon-Sun, UTC)
  monthly_progress   INTEGER NOT NULL DEFAULT 0,   -- solved in the last 30 days
  contest_rating     INTEGER,                      -- NULL = unrated / not fetched
  contests_attended  INTEGER NOT NULL DEFAULT 0,
  current_streak     INTEGER,                      -- NULL = not fetched yet (distinct from 0)
  longest_streak     INTEGER,
  last_updated       TEXT,                         -- last successful LeetCode sync (ISO timestamp; NULL = never / not linked)

  -- Where tracking started. Progress is only counted on top of baseline_solved,
  -- from the UTC day tracking_start onwards. Both are set when LeetCode is
  -- linked (at sign-up for members who joined with LeetCode before it was
  -- optional); '' / 0 until then.
  tracking_start     TEXT NOT NULL DEFAULT '',     -- YYYY-MM-DD (UTC)
  baseline_solved    INTEGER NOT NULL DEFAULT 0,   -- all-time total when LeetCode was linked

  -- Credentials and brute-force protection. Never exposed through the API.
  password_hash      TEXT NOT NULL DEFAULT '',
  failed_logins      INTEGER NOT NULL DEFAULT 0,
  locked_until       TEXT,

  -- Private e-mail address (migration 17). Never part of the public member
  -- payload: read it only through a dedicated query. It is the address Google or
  -- GitHub verified. NULL for members who have not connected a provider; stored
  -- lowercase and unique ignoring case when set.
  email              TEXT,
  email_verified_at  TEXT                          -- ISO timestamp the provider verified it; NULL = none
);
CREATE UNIQUE INDEX idx_users_leetcode       ON users(leetcode_username);
CREATE UNIQUE INDEX idx_users_leetcode_lower ON users(lower(leetcode_username));
CREATE UNIQUE INDEX idx_users_login_username ON users(login_username);
CREATE UNIQUE INDEX idx_users_email          ON users(lower(email)) WHERE email IS NOT NULL;

-- One cumulative snapshot per member per UTC day: the totals as of that day's
-- last sync. The app keeps the newest 60 days per member.
CREATE TABLE history (
  user_id          TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date             TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  solved_count     INTEGER NOT NULL CHECK (solved_count >= 0),
  easy_solved      INTEGER NOT NULL DEFAULT 0,
  medium_solved    INTEGER NOT NULL DEFAULT 0,
  hard_solved      INTEGER NOT NULL DEFAULT 0,
  weekly_progress  INTEGER NOT NULL DEFAULT 0,     -- the weekly counter as of that day
  PRIMARY KEY (user_id, date)
) WITHOUT ROWID;
CREATE INDEX idx_history_date ON history(date);

-- Result of the latest sync attempt per member (admin dashboard).
CREATE TABLE sync_status (
  user_id        TEXT PRIMARY KEY,
  last_attempt   TEXT NOT NULL,
  state          TEXT NOT NULL,                    -- 'ok' | 'unavailable' | 'not_found'
  error          TEXT,
  failures       INTEGER NOT NULL DEFAULT 0,       -- consecutive failed attempts
  failing_since  TEXT,
  reset_frozen_at TEXT                             -- set when LeetCode said the name doesn't exist; sticky
                                                   -- (a later success does NOT clear it), lifted only by
                                                   -- an admin: `npm run admin -- approve-reset <user>`
);

-- UNUSED. Sign-up used to wait here until the person proved they own a LeetCode
-- account; it is now one step (username + password), and migration 15 emptied
-- this table. Kept so rolling back to the previous release still works. Drop it
-- in a later migration.
CREATE TABLE pending_registrations (
  id                 TEXT PRIMARY KEY,
  leetcode_username  TEXT NOT NULL,
  display_name       TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  code               TEXT NOT NULL,
  attempts           INTEGER NOT NULL DEFAULT 0,
  expires_at         TEXT NOT NULL
);

-- Small key/value store (e.g. 'weeklyWinners' archive, last full sync time).
CREATE TABLE meta (
  key    TEXT PRIMARY KEY,
  value  TEXT
);

-- Distributed leases for background and scheduled operations.
CREATE TABLE leases (
  name        TEXT PRIMARY KEY,
  holder      TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
) WITHOUT ROWID;

-- Which migrations have been applied (see MIGRATIONS in db.ts).
CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TEXT NOT NULL
);

-- One notification for one member. A broadcast from an admin is one row per
-- member sharing a broadcast_id, so every member has their own read state.
CREATE TABLE notifications (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('badge', 'achievement', 'admin')),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,                     -- ISO timestamp
  read_at       TEXT,                              -- NULL = unread
  dismissed_at  TEXT,                              -- soft delete: hidden from the member, still counted for admins
  sender_id     TEXT,                              -- admin who sent it (type 'admin')
  broadcast_id  TEXT                               -- shared by every row of one broadcast
);
CREATE INDEX idx_notifications_user   ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;

-- Ledger of badges / weekly wins a member has already been told about, so each
-- is announced exactly once. award_key examples: 'badge:solved-100',
-- 'badge:contest-tier:Knight', 'winner:2026-10-05'. The special key '_baseline'
-- marks a member whose existing awards were recorded silently (first pass).
CREATE TABLE user_awards (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  award_key   TEXT NOT NULL,
  awarded_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, award_key)
) WITHOUT ROWID;

-- Codeforces / CodinGame accounts a member links (all optional, like LeetCode,
-- which lives on the users row). Current stats live on the row; `extra` is platform-specific
-- JSON (e.g. Codeforces difficulty buckets).
CREATE TABLE platform_accounts (
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL CHECK (platform IN ('codeforces', 'codingame')),
  handle          TEXT NOT NULL,
  solved          INTEGER NOT NULL DEFAULT 0,
  weekly_solved   INTEGER NOT NULL DEFAULT 0,
  monthly_solved  INTEGER NOT NULL DEFAULT 0,
  rating          INTEGER,                         -- NULL = unrated
  max_rating      INTEGER,
  rank_title      TEXT,
  contests        INTEGER NOT NULL DEFAULT 0,
  avatar_url      TEXT,
  extra           TEXT NOT NULL DEFAULT '{}',
  linked_at       TEXT NOT NULL,
  last_updated    TEXT,                            -- last successful sync (NULL = never)
  hidden          INTEGER NOT NULL DEFAULT 0,      -- 1 = hidden from other members (owner and admins still see it)
  PRIMARY KEY (user_id, platform)
) WITHOUT ROWID;
-- A handle belongs to at most one member.
CREATE UNIQUE INDEX idx_platform_accounts_handle ON platform_accounts(platform, lower(handle));

-- Latest sync attempt per member per platform.
CREATE TABLE platform_sync_status (
  user_id        TEXT NOT NULL,
  platform       TEXT NOT NULL,
  last_attempt   TEXT NOT NULL,
  state          TEXT NOT NULL,                    -- 'ok' | 'unavailable' | 'not_found'
  error          TEXT,
  failures       INTEGER NOT NULL DEFAULT 0,
  failing_since  TEXT,
  reset_frozen_at TEXT,                            -- set when the platform said the handle doesn't exist; sticky (migration 16)
  PRIMARY KEY (user_id, platform)
) WITHOUT ROWID;

-- One snapshot per member per platform per UTC day.
CREATE TABLE platform_history (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform  TEXT NOT NULL,
  date      TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  solved    INTEGER NOT NULL CHECK (solved >= 0),
  rating    INTEGER,
  PRIMARY KEY (user_id, platform, date)
) WITHOUT ROWID;
CREATE INDEX idx_platform_history_date ON platform_history(date);

-- A request to link an account, waiting for the member to put `code` in the
-- profile of that account. One open request per member per platform. `platform`
-- is 'leetcode' (the account on the member's own row) or an extra platform.
CREATE TABLE pending_links (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL,
  handle      TEXT NOT NULL,
  code        TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, platform)
) WITHOUT ROWID;

-- A "forgot password" request, waiting for the person to put `code` in the
-- public profile of an account the member linked. The NEW password is chosen at
-- the start and held here, already hashed. `handle` is the linked account as it
-- was then; the reset is refused if it has changed since. The browser only ever
-- holds `id`.
CREATE TABLE pending_resets (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform       TEXT NOT NULL CHECK (platform IN ('leetcode', 'codeforces', 'codingame')),
  handle         TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  code           TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  expires_at     TEXT NOT NULL
);
CREATE INDEX idx_pending_resets_user ON pending_resets(user_id);
CREATE INDEX idx_pending_resets_expires ON pending_resets(expires_at);

-- Counters for the sensitive rate limiters (login, sign-up, verification,
-- account and refresh routes), kept in the database so the limits hold across
-- every serverless instance. One row per limiter + client; `reset_at` is the
-- end of the current window in epoch milliseconds. Expired rows are purged
-- opportunistically by the store.
CREATE TABLE rate_limits (
  key       TEXT PRIMARY KEY,
  hits      INTEGER NOT NULL DEFAULT 0,
  reset_at  INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX idx_rate_limits_reset ON rate_limits(reset_at);

-- Messages sent through the floating "Feedback" button, read by admins on the
-- Admin page. Anyone can send one, so user_id is NULL for a visitor who wasn't
-- signed in; it is also cleared (see deleteUserById) when a member deletes
-- their account, so the admins keep the message but lose the name. No IP
-- address is stored.
CREATE TABLE feedback (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  category    TEXT NOT NULL CHECK (category IN ('bug', 'idea', 'other')),
  message     TEXT NOT NULL,                       -- plain text, 3 to 1000 characters
  page        TEXT NOT NULL DEFAULT '',            -- URL hash the form was opened on, e.g. '#/profile/alice'
  created_at  TEXT NOT NULL,
  read_at     TEXT                                 -- NULL = unread
);
CREATE INDEX idx_feedback_created ON feedback(created_at DESC);

-- Which Google / GitHub account a member can sign in with (migration 18). The
-- key is the provider's own stable user id, NEVER the e-mail address: a member
-- is never found, signed in or linked because an e-mail matches. A provider
-- account belongs to at most one member, and a member has at most one account
-- per provider. No tokens are stored.
CREATE TABLE oauth_identities (
  provider          TEXT NOT NULL CHECK (provider IN ('github', 'google')),
  provider_user_id  TEXT NOT NULL,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at        TEXT NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);
CREATE UNIQUE INDEX idx_oauth_identities_user_provider ON oauth_identities(user_id, provider);

-- One Google / GitHub sign-in attempt in flight (migration 18). The browser only
-- holds `id`, in an HttpOnly cookie. `code_verifier` is the PKCE secret and
-- never leaves the server. Single use, expires after 10 minutes. user_id is
-- set only when a signed-in member is connecting a provider (intent 'link').
CREATE TABLE oauth_states (
  id             TEXT PRIMARY KEY,                 -- random, 128 bits
  provider       TEXT NOT NULL CHECK (provider IN ('github', 'google')),
  intent         TEXT NOT NULL CHECK (intent IN ('signin', 'link')),
  user_id        TEXT REFERENCES users(id) ON DELETE CASCADE,  -- link only
  code_verifier  TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL
);
CREATE INDEX idx_oauth_states_expires ON oauth_states(expires_at);

-- A provider-verified identity waiting for the new member to choose a username
-- (migration 18). The member does not exist yet. `email` is the address the
-- provider marked verified; it goes into users.email when the sign-up is
-- completed. Single use, expires after 15 minutes. The browser only holds `id`.
CREATE TABLE pending_oauth_signups (
  id                TEXT PRIMARY KEY,              -- random, 128 bits
  provider          TEXT NOT NULL CHECK (provider IN ('github', 'google')),
  provider_user_id  TEXT NOT NULL,
  email             TEXT NOT NULL,                 -- lowercase, provider-verified; goes away with the row
  display_name      TEXT,                          -- suggestion from the provider
  created_at        TEXT NOT NULL,
  expires_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_pending_oauth_signups_identity ON pending_oauth_signups(provider, provider_user_id);
CREATE INDEX idx_pending_oauth_signups_expires ON pending_oauth_signups(expires_at);
