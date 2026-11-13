# Contributing to Leeterboard

Thank you for your interest in contributing to Leeterboard! This document outlines our development workflows, coding standards, and pull request guidelines.

## Code of Conduct

All contributors and maintainers are expected to adhere to our [Code of Conduct](CODE_OF_CONDUCT.md). Please report any unacceptable behavior privately to the maintainers.

## Getting Started

### Prerequisites

- **Node.js**: Version 20 or later (`node -v`)
- **npm**: Version 9 or later (`npm -v`)
- **SQLite / Turso**: Local SQLite file (`local.db`) is used by default for local development.

### Local Setup

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/itsya-ssine/leeterboard.git
   cd leeterboard
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure your local environment:
   ```bash
   cp .env.example .env
   ```
   Generate a secure `JWT_SECRET` (at least 32 characters) in `.env`:
   ```bash
   node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

5. (Optional) Seed test members for local development:
   ```bash
   npx tsx scripts/seed-dev-users.ts
   ```

## Development & Git Workflow

### Branch Strategy

- Never commit directly to `main`.
- Create a focused branch for your changes:
  - `fix/<issue-name>` for bug fixes and security corrections
  - `feat/<feature-name>` for new capabilities
  - `refactor/<refactor-name>` for code cleanup without behavior changes
  - `docs/<doc-name>` for documentation updates

### Conventional Commits

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat(...)`: A new user-facing or platform feature
- `fix(...)`: A bug fix or security patch
- `refactor(...)`: Code refactoring without behavior change
- `test(...)`: Adding or correcting tests
- `docs(...)`: Documentation updates
- `chore(...)`: Tooling, dependency, or configuration updates

Examples:
- `fix(security): prevent database error leakage on 500 responses`
- `feat(auth): add session revocation support`
- `docs: update contributing guide and script reference`

### Code Quality & Testing Requirements

Before committing or submitting a pull request, ensure all checks pass:

1. **Type Checking:**
   ```bash
   npm run lint
   ```
2. **Regression & Unit Tests:**
   ```bash
   npm test
   ```
3. **Security Configuration Guard:**
   ```bash
   npm run security:check
   ```
4. **Legal Consistency Guard:**
   ```bash
   npm run legal:check
   ```
5. **Production Build:**
   ```bash
   npm run build
   ```

### Security Considerations

- **Never commit secrets:** Never commit API keys, tokens, production credentials, or real passwords.
- **Fail closed:** Verify and fail closed on upstream outages. Never introduce unauthenticated proxy fallbacks for account ownership proofs.
- **Parameterized SQL:** All queries against SQLite / Turso must use parameterized statements.
- **Zero Information Leakage:** Never leak stack traces, SQL error fragments, or private account data (emails, lockout states) to client responses.

## Submitting a Pull Request

1. Push your branch to your GitHub fork.
2. Open a Pull Request targeting `main`.
3. Complete the PR template, describing your changes and referencing any related issues.
4. Ensure all CI checks (typecheck, tests, CodeQL, security audit) are passing.
5. Address review feedback from maintainers.
