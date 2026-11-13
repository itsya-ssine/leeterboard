# Changelog

All notable changes to the Leeterboard project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Standard community and governance files (`SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue/PR templates).
- Centralized request correlation tracking via `x-request-id` headers.
- Regression test suite for centralized error handling and driver data isolation (`tests/error-handling.test.ts`).

### Fixed
- Fixed raw error message leakage across API endpoints (`GET /api/users`, `POST /api/sync-if-stale`, admin feedback, and notification handlers).
- Ensured 5xx responses never expose internal SQL queries, file paths, or driver text.

## [1.0.0] - 2026-11-13

### Added
- Multi-platform competitive programming tracking (LeetCode, Codeforces, and CodinGame).
- OAuth sign-in and account linking for Google and GitHub identities.
- Account data export feature allowing members to download full account archives.
- Public FAQ page explaining scoring, rankings, rounds, and streak calculations.
- Comprehensive security architecture including CSRF protection, rate limiting, and scrypt password hashing.
- Open Graph and Twitter Card social preview metadata.
- Shared site layout with accessible navigation and legal footer.
- Privacy Policy and Terms of Service pages.
