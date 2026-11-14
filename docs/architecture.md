# Leeterboard Architecture & Technical Documentation

This document describes the refactored architecture of **Leeterboard**, a competitive-programming leaderboard platform tracking LeetCode, Codeforces, and CodinGame metrics for competitive programming communities.

---

## 1. Architectural Overview & Design Principles

The refactored Leeterboard architecture separates concerns into clean, modular layers following modern software engineering principles:

- **Single Responsibility Principle (SRP)**: Modules, components, and controllers encapsulate one business capability or presentation concern.
- **Feature-Based Frontend**: Frontend code is grouped by feature domain (`leaderboard`, `profile`, `compare`, `auth`, `account`, `platforms`, `admin`, `legal`, `share-card`, `statistics`, `notifications`) rather than grouping all components into a single directory.
- **Modular Controller-Service-Domain Backend**: Express routes delegate to controllers or dedicated service layers, with business rules isolated into pure domain modules.
- **Platform Adapter Pattern**: Extensible, standardized interface (`PlatformAdapter`) for external platforms (LeetCode, Codeforces, CodinGame).
- **Strict Typing & Zero-Drift Type Safety**: Shared domain models and validated runtime schemas ensure seamless client-server contract enforcement.
- **Backwards Compatibility**: Transparent re-export shims preserve historical import paths and AST/regex test suites.

```
┌─────────────────────────────────────────────────────────────┐
│                       Client (React)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  App & Gates │  │ Feature-Based│  │  UI / Common /    │  │
│  │  & Providers │  │   Modules    │  │ Navigation Shared │  │
│  └──────┬───────┘  └──────┬───────┘  └─────────┬─────────┘  │
└─────────┼─────────────────┼────────────────────┼────────────┘
          │                 │                    │
          ▼                 ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                      HTTP / API Layer                       │
│      CSRF Guard ── Rate Limiters ── Security Headers         │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Server Modular Architecture                │
│  ┌───────────────────────┐       ┌───────────────────────┐  │
│  │   Feature Modules     │       │     Domain Layer      │  │
│  │ (Auth, Users, Sync,   │──────▶│ (Ranking, Progress,   │  │
│  │  Admin, Health, etc.) │       │  Streaks, Awards)     │  │
│  └───────────┬───────────┘       └───────────────────────┘  │
│              │                                              │
│              ▼                                              │
│  ┌───────────────────────┐       ┌───────────────────────┐  │
│  │   Platform Adapters   │       │    Database Layer     │  │
│  │ (LeetCode, Codeforces,│       │ (SQLite / Turso /     │  │
│  │  CodinGame)           │       │  Migrations)          │  │
│  └───────────────────────┘       └───────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Directory Structure

```text
leeterboard/
├── db/                             # Database schema & migrations
│   └── schema.sql                  # Annotated master schema
├── docs/                           # Architectural & operations documentation
│   ├── architecture.md             # This document
│   └── security-operations.md      # Security & incident response guidelines
├── platforms/                      # Root platform adapter modules & registry
├── scripts/                        # Database migrations & security verification scripts
├── server/                         # Modular Server Architecture
│   ├── app.ts                      # Express app factory with middleware mounting
│   ├── server.ts                   # Server entrypoint & HTTP listener
│   ├── config/                     # Centralized configuration & environment constants
│   │   ├── constants.ts            # Rate limits, timeouts, intervals, cookies
│   │   ├── env.ts                  # Environment validation & runtime mode
│   │   ├── security.ts             # Security constants & configuration
│   │   └── index.ts                # Configuration barrel
│   ├── domain/                     # Pure business domain logic
│   │   ├── ranking.ts              # Board ranking algorithms (weekly, all-time, rating)
│   │   ├── progress.ts             # Progress calculations, sprints & deltas
│   │   ├── streaks.ts              # Submission calendar streak calculation
│   │   └── index.ts                # Domain barrel
│   ├── middleware/                 # Request middleware pipeline
│   │   ├── auth.ts                 # Session verification & admin authorization
│   │   ├── csrf.ts                 # Cross-origin request forgery mitigation
│   │   ├── error.ts                # Centralized error handler & status mapping
│   │   ├── rateLimit.ts            # In-memory & DB-backed rate limiters
│   │   ├── securityHeaders.ts      # CSP, HSTS, and HTTP response headers
│   │   └── index.ts                # Middleware barrel
│   ├── modules/                    # Feature-oriented backend modules
│   │   ├── admin/                  # Admin dashboard, sync status, maintenance
│   │   ├── auth/                   # Password auth, reset workflows, session gating
│   │   ├── health/                 # Health check & uptime telemetry
│   │   ├── leaderboard/            # Board rankings, hall of fame, weekly winners
│   │   ├── oauth/                  # OAuth provider integrations (GitHub, Google, Dev)
│   │   ├── platforms/              # Platform linking, verification, and trends
│   │   ├── sync/                   # Stale member syncing, cron sync, leases
│   │   └── users/                  # User accounts, profiles, data export & deletion
│   ├── platforms/                  # Platform adapter contracts & integrations
│   │   ├── adapter.interface.ts    # Standardized PlatformAdapter interface
│   │   ├── leetcode/               # LeetCode GraphQL & scraper adapter
│   │   ├── codeforces/             # Codeforces API adapter
│   │   ├── codingame/              # CodinGame API adapter
│   │   └── index.ts                # Platform adapter registry & factory
│   └── utils/                      # Reusable utilities & helpers
│       ├── avatar.ts               # Tier frame and avatar utilities
│       ├── emails.ts               # Email validation, masking, and domain policies
│       ├── logger.ts               # Redacted, structured security logger
│       ├── usernames.ts            # Username validation & reservation checks
│       └── index.ts                # Utilities barrel
├── src/                            # Feature-Based Frontend (React + Vite)
│   ├── app/                        # Application core
│   │   ├── App.tsx                 # Core App component re-export
│   │   ├── gates/                  # Routing & authentication gates
│   │   │   ├── Gate.tsx            # Landing vs app entry gate
│   │   │   ├── LegalGate.tsx       # /terms, /privacy, /faq routing gate
│   │   │   ├── SessionGate.tsx     # Authenticated session boundary gate
│   │   │   └── index.ts
│   │   └── providers/              # React context providers
│   │       ├── AuthProvider.tsx    # AuthContext wrapper
│   │       ├── ThemeProvider.tsx   # Light/dark theme provider
│   │       ├── I18nProvider.tsx    # Internationalization provider
│   │       ├── ToastProvider.tsx   # Toast notification provider
│   │       └── index.ts
│   ├── components/                 # Shared presentation components
│   │   ├── ui/                     # Generic, unopinionated UI primitives
│   │   │   ├── Modal.tsx           # Accessible modal dialog
│   │   │   ├── Skeleton.tsx        # Loading skeleton place-holders
│   │   │   ├── AnimatedNumber.tsx  # Smooth animated counter
│   │   │   ├── TierAvatar.tsx      # Framed tier avatar
│   │   │   ├── SearchInput.tsx     # Debounced search bar
│   │   │   └── DifficultyBar.tsx   # Split difficulty progress bar
│   │   ├── common/                 # Reusable cross-feature components
│   │   │   ├── PageHeader.tsx      # Consistent section page header
│   │   │   ├── SchoolTag.tsx       # School/organization badge
│   │   │   ├── EmptyState.tsx      # Empty list placeholder
│   │   │   └── Landing.tsx         # Public landing page shell
│   │   ├── navigation/             # Navigation controls
│   │   │   ├── NavLinks.tsx        # Top navigation tabs
│   │   │   ├── ThemeToggle.tsx     # Theme toggle button
│   │   │   ├── LanguageSelector.tsx# Locale selector dropdown
│   │   │   └── SiteFooter.tsx      # Shared site footer
│   │   └── feedback/               # User feedback components
│   │       ├── FeedbackWidget.tsx  # Floating feedback button & dialog
│   │       └── Toast.tsx           # In-app toast alerts
│   ├── features/                   # Domain features
│   │   ├── leaderboard/            # Rankings, podium, round timers, ticker
│   │   ├── profile/                # User profile, activity heatmap, badge lists
│   │   ├── compare/                # Head-to-head comparison & PNG card generation
│   │   ├── auth/                   # Login modal, signup flow, OAuth callback handling
│   │   ├── account/                # Account settings, platform linking, password
│   │   ├── admin/                  # Admin dashboard, sync health, member management
│   │   ├── platforms/              # Platform boards (Codeforces, CodinGame)
│   │   ├── notifications/          # Notification bell & award alerts
│   │   ├── legal/                  # Privacy policy, terms, FAQ pages
│   │   ├── share-card/             # Canvas-drawn social share cards
│   │   └── statistics/             # Group growth charts & platform trends
│   └── tests/                      # Frontend unit & integration tests
├── tests/                          # Full server regression test suites
├── server.ts                       # Root server entry with static route definitions
├── vite.config.ts                  # Vite build configuration
└── package.json                    # Project scripts & dependencies
```

---

## 3. Frontend Architecture

### 3.1 Feature-Based Modularization
Instead of sprawling single files, each feature domain is self-contained in `src/features/<feature>/`:
- **Components**: Focused UI views (e.g. `Podium.tsx`, `RoundTimer.tsx`, `SubmissionTicker.tsx`).
- **Hooks & Services**: API communication and query state.
- **Utils & Calculations**: Pure transformations (e.g. `movement.ts`, `winners.ts`, `activity.ts`).
- **Barrel Exports (`index.ts`)**: Clean public API surface for each feature.

### 3.2 Component Responsibilities & De-bloating
- **Decomposed App.tsx**: The monolithic `App.tsx` (~1,500 lines) was decomposed by extracting:
  - `NavLinks`: Header navigation tabs with responsive mobile dropdown.
  - `RoundTimer`: Live countdown timer to Monday 00:00 UTC.
  - `SubmissionTicker`: Real-time marquee ticker of recent submissions.
  - `DifficultyBar`: Reusable stacked progress bar.
  - `GroupGrowthChart`: Group stats time-series visualization.
- **Shared Primitives**: Generic UI controls (`Modal`, `Skeleton`, `AnimatedNumber`, `TierAvatar`, `SearchInput`) live in `src/components/ui/` without domain coupling.

### 3.3 State Management & Providers
- **Providers Pipeline**: Application contexts are neatly organized under `src/app/providers/`:
  - `AuthProvider`: Session management, OAuth sign-in state, and credential workflows.
  - `ThemeProvider`: Synchronized dark/light theme with CSS variable mapping.
  - `I18nProvider`: Multi-language dictionary and localized string formatting.
  - `ToastProvider`: Global non-blocking alert queue.
- **Security & Route Gates** (`src/app/gates/`):
  - `Gate`: Switches between visitor landing page and main app.
  - `LegalGate`: Resolves statutory routes (`/privacy`, `/terms`, `/faq`) before app initialization.
  - `SessionGate`: Ensures visitors only see authentication dialogs while members access authorized views.

---

## 4. Backend Architecture

### 4.1 Modular Server Organization
The backend is organized into clearly separated modules under `server/modules/`:
- **Admin**: Sync status inspections, member management, feedback moderation.
- **Auth**: Password authentication, password resets with profile proof codes, session token issuance.
- **OAuth**: Standardized OAuth 2.0 PKCE flow for GitHub, Google, and local dev mock provider.
- **Users**: Account settings, public profile data, profile concealment, JSON GDPR data export.
- **Platforms**: Platform linking verification, visibility toggles, platform-specific trends.
- **Sync**: Stale member synchronization, distributed database leases, scheduled cron execution.
- **Leaderboard**: Live ranking generation, hall of fame archiving, podium sorting.

### 4.2 Pure Domain Layer
Business calculations are decoupled from HTTP request handling and isolated in `server/domain/`:
- `ranking.ts`: Deterministic ranking rules for LeetCode weekly, all-time, and rating leaderboards with secondary tie-breakers.
- `progress.ts`: Calculation of weekly and monthly deltas based on UTC midnight snapshots.
- `streaks.ts`: Bitmask and calendar parsing for LeetCode submission history and current streak counting.

### 4.3 Standardized Platform Adapters
External platform interactions implement `PlatformAdapter` (`server/platforms/adapter.interface.ts`):
- `fetchUser(handle: string)`: Retrieves normalized profile, avatar, rating, and solved count.
- `fetchVerificationText(handle: string)`: Retrieves member profile summary or bio for verification code checks.
- `fetchTrends()`: Aggregates historical metrics for group-wide trends.

---

## 5. Database Organization & Migrations

### 5.1 Architecture & Compatibility
- **Dual SQLite / Turso Compatibility**: Works seamlessly with local SQLite (`better-sqlite3`) for development and Turso (`@libsql/client`) for serverless deployments.
- **Automated Versioned Migrations**: 22 ordered SQL migrations run idempotently on startup.
- **Schema Parity Enforcement**: `npm run db:check-schema` enforces exact structural parity between `db/schema.sql` and `initDb()` migrations.

### 5.2 Key Tables
- `users`: Member credentials, session versioning, display settings, and LeetCode stats.
- `history`: Daily snapshot history for progress calculations and weekly contest tracking.
- `platform_accounts`: Linked secondary platforms (Codeforces, CodinGame) with JSON extras.
- `oauth_identities`: Linked OAuth providers (GitHub, Google) per member.
- `rate_limits`: Database-backed distributed sliding-window rate limiting counters.
- `leases`: Distributed mutual exclusion lock for cron syncing across multi-instance clusters.
- `notifications` & `feedback`: In-app announcements, achievement awards, and user feedback.

---

## 6. Security Architecture

1. **Authentication & Session Tokens**:
   - Cryptographically signed HMAC-SHA256 session cookies.
   - Session versioning (`session_version`) enables instant revocation across all devices on password change.
2. **Account Lockout & Targeted DoS Protection (SEC-08)**:
   - Tracks failed attempts by IP and known-good device cookies.
   - Locks out untrusted devices after 5 failures without locking out the genuine user on a known device.
3. **Password Reset Cooldown (SEC-06)**:
   - Enforces a mandatory 24-hour cooldown between successful password resets.
4. **CSRF Protection**:
   - Strict `SameSite=Lax` cookies, origin validation, and custom header checks on state-changing endpoints.
5. **Content Security Policy (CSP)**:
   - Strict script-src hashes, style directives, and object-src restrictions mirrored identically between Node headers and `vercel.json`.

---

## 7. Verification & Quality Assurance

The architecture refactoring was validated with a comprehensive testing suite:
- **TypeScript**: `npm run typecheck` (`tsc --noEmit`) passes with 0 errors.
- **ESLint**: `npm run lint` passes with 0 warnings/errors.
- **Production Build**: `npm run build` bundles client (Vite) and server (esbuild) cleanly in ~1.1s.
- **Schema Integrity**: `npm run db:check-schema` verifies all 22 migrations match `schema.sql`.
- **Security Check**: `npm run security:check` validates CSP hashes, response headers, and bundle isolation.
- **Legal Check**: `npm run legal:check` validates all legal disclosures.
- **Full Test Suite**: `npm test` runs 659 tests across 180 suites with 100% pass rate.
