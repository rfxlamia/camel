# Better Auth — Google + GitHub OAuth Integration

**Date:** 2026-06-21
**Status:** approved
**Author:** brainstorm session (pocket-grinding)
**Spec path:** docs/pocket/spec/2026-06-21-better-auth-oauth-integration/oauth-integration.md

---

## Summary

Add Google and GitHub OAuth (SSO) to Camel Kanban using Better Auth, coexisting with the existing username/password auth. Email is captured **only** via OAuth (always provider-verified, no manual email entry) and used as the account-linking key. An email gate blocks any account without a verified email from the board until it links a provider. The work is additive: `users.id` stays integer-serial and existing password auth is preserved.

---

## Context

### Current State
- Auth (`server/src/auth.ts`): bcrypt password hashing; opaque random session token stored in `sessions` table; cookie `camel_session` (httpOnly, sameSite=strict, secure in prod, 30-day TTL). `requireAuth` joins `sessions`→`users`.
- Security: CSRF double-submit cookie (mutating `/api/*`); `/api/auth/login` & `/api/auth/register` are CSRF-exempt. Rate limiting (Redis + in-memory fallback) + per-username account lockout. Session-fixation protection: stale token deleted before minting a new one on login.
- `users` table (`db/schema.sql`): `id SERIAL PK`, `username TEXT NOT NULL UNIQUE`, `display_name TEXT NOT NULL`, `password_hash TEXT NOT NULL`, `created_at`. **No `email` column.**
- Registration is one transaction: insert user → create personal workspace → owner membership → consume `workspace_invites` (matched by username).
- Integer FKs to `users.id` from: `sessions`, `workspaces.owner_user_id`, `workspace_members`, `workspace_invites.invited_by`, `cards.assignee_id`, `card_events.actor_id`, `agent_boards.user_id`.
- Mounting (`index.ts`): `app.use(express.json())` is **global**; routes mounted after. `/api/auth` via `createAuthRouter`.
- Client: `components/AuthPage.tsx` (username/password form only); `api.ts` has `login/register/logout/me`.
- Migration: `make db-migrate` applies `schema.sql` + `agent-schema.sql`, idempotent (`IF NOT EXISTS`). No `migrations/` dir.

### Problem / Motivation
No one-click SSO; password-only signup allows email-less (potentially dummy) accounts. Research (`docs/pocket/research/2026-06-21-oauth-integration-options/research-report.md`) selected Better Auth as the clear 2026 winner (Passport.js abandoned, Auth.js deprecated/absorbed). The spike reported a "hard blocker" (Better Auth string nanoid IDs vs integer `users.id`) — **superseded by this spec's design** (see Design Decision: `advanced.database.generateId` returning `false` for the user model lets PostgreSQL serial generate integer IDs).

### Related Areas
`server/src/auth.ts`, `server/src/index.ts`, `server/src/db/schema.sql`, `server/src/db/migrate.ts`, `server/src/routes.ts` (requireAuth usage), `client/src/components/AuthPage.tsx`, `client/src/api.ts`, env/config.

---

## Scope

### In-Scope
- Google + GitHub OAuth via Better Auth, coexisting with existing password auth.
- Extend `users` with `email` + `email_verified`; add Better Auth `account` (OAuth identities) + `verification` tables. Identity model designed extensible for future provider-token storage.
- Email obtained **only** via OAuth link → always `email_verified=true`. No manual email entry.
- Account linking by verified email: OAuth email matching an existing account logs into / links to that account (Better Auth `accountLinking` + `trustedProviders`).
- Email gate: any account without a verified email is blocked from board access (server-enforced) until it links a provider. Applies to old password users AND new password signups.
- Pure OAuth signup provisions: user (no password) → pick-username screen → personal workspace + invite consumption → `camel_session` → board.
- Sessions recognized by existing `requireAuth` (OAuth bridged into `camel_session`).
- Set-password feature for accounts whose `password_hash` is NULL (fallback login / recovery).
- GitHub private-email handling: request `user:email` scope and fetch primary verified email via GitHub `/user/emails`.
- UI: Google/GitHub buttons on AuthPage; "link a provider to continue" gate screen; "pick username" screen.
- Localhost + production config (two redirect-URI sets / env-driven credentials).

### Out-of-Scope
- SMTP / email-link verification flow — deferred phase. (Anti-dummy on the password path is therefore partial; see Open Questions.)
- Manual email entry — by design, all email is provider-verified.
- Unlink provider — avoids lockout-rule + UI work; once linked, stays linked. Set-password covers recovery.
- Storing provider access/refresh tokens — login-only now; identity schema left extensible.
- Migrating `users.id` integer→string; replacing/removing password auth.
- Other providers; 2FA; SAML/SSO enterprise; account merge.

---

## Architecture Constraints

- **May touch:** `server/src/auth.ts`, `server/src/index.ts`, `server/src/db/schema.sql`, `server/src/db/migrate.ts`, `client/src/components/AuthPage.tsx`, `client/src/api.ts`, env/config, new auth-gate middleware + OAuth bridge module.
- **Must NOT touch:** `users.id` type (SERIAL integer) or any integer FK referencing it; existing password auth routes' behavior; destructive changes to existing rows.
- **Patterns that must be followed:** preserve `camel_session` cookie semantics + `requireAuth`; preserve CSRF protection, rate limiting, session-fixation rotation; ESM NodeNext (`.js` import suffixes); Biome (tabs + double quotes); idempotent schema (`IF NOT EXISTS`, additive `ALTER`).
- **Better-Auth-specific constraints (from docs):**
  - `express.json()` must NOT run before the Better Auth handler — mount Better Auth handler before global `express.json()`, or scope `express.json()` to non-Better-Auth routes.
  - Better Auth routes must be exempted from the existing CSRF middleware (Better Auth uses its own `trustedOrigins`/state).
  - `advanced.database.generateId` callback returns `false` for the `user`/`users` model (DB serial generates integer id); UUID/text for `session`/`account`/`verification`.
- **Architecture validation result:** PASS (migration of `username` + `password_hash` to nullable is additive/non-destructive).

---

## Stories + Scenarios

### Story: Pure OAuth signup
> As a new user, I want to sign up with Google/GitHub in one click, so that I don't need to create a password.

**Rule 1: New OAuth user (email not in system)**
- Example A: `ana@gmail.com` unused → new account, verified email, pick-username.
- Example B: GitHub profile hides email → fetch primary verified email via `/user/emails`.
- Example C: GitHub has no verified email at all → abort, message, no account created.

```gherkin
Scenario: New user signs in with Google, email unused
  Given no account has email "ana@gmail.com"
  When the user clicks "Sign in with Google" and picks ana@gmail.com
  Then a user row is created (password_hash NULL, email=ana@gmail.com, email_verified=true)
  And an account identity (provider=google, accountId) is stored
  And the user is taken to the "pick username" screen
  When the user submits a unique username "ana"
  Then a personal workspace is created, pending invites consumed, a camel_session is minted
  And the user lands on the board

Scenario: GitHub email is private
  Given a user with a verified-but-private primary email on GitHub
  When they sign in with GitHub (user:email scope granted)
  Then the primary verified email is fetched via GitHub /user/emails and used

Scenario: GitHub returns no verified email
  Given a GitHub account with no verified email
  When they sign in with GitHub
  Then login is aborted with "GitHub didn't provide a verified email — verify your GitHub email or use Google"
  And no account or session is created
```

### Story: OAuth login matching an existing account
> As a returning user, I want signing in with my provider to land me in my existing account, so that I don't create duplicates.

**Rule 2: Email matches an account that already owns it → auto-login**
- Example A: account `budi` owns `budi@gmail.com`; Sign in with Google for budi@gmail.com → logged in as budi.

```gherkin
Scenario: Provider email belongs to an existing account
  Given account "budi" has email_verified "budi@gmail.com"
  When someone clicks "Sign in with Google" picking budi@gmail.com
  Then they are logged in as "budi" (no duplicate account)
  And if google was not yet recorded for budi, the identity is linked
```

### Story: Email gate
> As the system, I want to block board access for accounts without a verified email, so that email-less/dummy accounts can't use the product.

**Rule 3: No verified email → gated until provider linked**
- Example A: old password user `lama` (email NULL) logs in → gated.
- Example B: at gate, links Google with unused `lama@gmail.com` → email attached, gate opens.

```gherkin
Scenario: Email-less account is gated server-side
  Given account "lama" has a password but email NULL
  When "lama" logs in with correct username+password
  Then a session is created
  And board API/UI access is blocked (server-enforced) with a needs-provider signal
  And the user is shown "link Google/GitHub to continue"

Scenario: Completing email via provider link opens the gate
  Given "lama" is at the gate
  When they click "Link Google" picking lama@gmail.com (unused by any account)
  Then email=lama@gmail.com, email_verified=true is attached to "lama"
  And the gate opens and they land on the board
```

### Story: Link collision while logged in
> As the system, I want consistent behavior when a linked provider email already belongs to another account.

**Rule 4: Linking email owned by another account → switch to owner**
```gherkin
Scenario: Account A links an email already owned by B
  Given the user is logged in as account "A" (no email)
  And account "B" already has email "shared@gmail.com"
  When A clicks "Link Google" picking shared@gmail.com
  Then linking to A is refused
  And A's session is ended and the user is auto-logged-in as "B"
  And account A remains email-less (orphaned) and the event is recorded in the activity/audit log
```

### Story: Set password (recovery fallback)
> As an OAuth-only user, I want to set a password, so that I have a backup way to sign in.

**Rule 5: Set password when none exists**
```gherkin
Scenario: OAuth-only user sets a password
  Given account "ana" has a verified email, password_hash NULL, username "ana"
  When ana opens settings and sets password "secret123" (>= 8 chars)
  Then password_hash is set (bcrypt)
  And ana can subsequently log in via username "ana" + password

Scenario: Set-password rejected for too-short password
  Given account "ana" with password_hash NULL
  When ana submits a password shorter than 8 chars
  Then it is rejected with "Password must be at least 8 characters"
```

### Story: Failure & concurrency
```gherkin
Scenario: OAuth callback fails or user denies consent
  Given the user clicks "Sign in with Google"
  When the user denies consent or the provider returns an error
  Then the user is returned to AuthPage with "Login cancelled — try again"
  And no account or session is created

Scenario: Chosen username already taken
  Given a new OAuth user on the "pick username" screen
  When they submit "budi" which already exists
  Then it is rejected with "Username already taken" and they pick another

Scenario: Two new OAuth users pick the same username concurrently
  Given two new OAuth users submit username "max" at the same time
  When both inserts race
  Then the DB UNIQUE(username) constraint lets exactly one succeed
  And the loser is asked to pick a different username
```

---

## Acceptance Criteria

```
Rule: Pure OAuth signup
  ✓ Given email unused, When Sign in with Google, Then new user (password_hash NULL,
    email_verified=true) + identity row + pick-username screen
  ✓ Given username chosen unique, When submitted, Then personal workspace + invites
    consumed + camel_session + board
  ✓ Given GitHub email private, When sign in, Then primary verified email fetched via
    /user/emails (user:email scope)
  ✗ Given GitHub has no verified email, When sign in, Then aborted with message,
    no account/session created

Rule: Email-match auto-login
  ✓ Given account owns the provider email, When sign in with that provider,
    Then logged in as that account, no duplicate; identity linked if absent

Rule: Email gate (server-enforced)
  ✓ Given email NULL, When authenticated request to board API, Then blocked with
    needs-provider signal (not UI-only)
  ✓ Given at gate links provider with unused email, Then email_verified attached,
    gate opens

Rule: Link collision
  ✓ Given email owned by account B, When account A links it, Then refuse link to A,
    end A's session, auto-login as B, record orphan event

Rule: Set password
  ✓ Given password_hash NULL, When set password >= 8 chars, Then bcrypt hash stored,
    username+password login works
  ✗ Given password < 8 chars, When set, Then rejected

Rule: Failure handling
  ✗ Given consent denied / provider error, When callback, Then back to AuthPage with
    "Login cancelled", no account/session
  ✗ Given username taken, When submitted at pick-username, Then rejected
  ✓ Given concurrent identical username submits, Then UNIQUE(username) admits one only
```

---

## Design Decision

**Chosen option:** Option A — Better Auth uses the existing integer `users` table (`generateId` false for user model); OAuth bridged into the existing `camel_session`.

**Summary:** Configure Better Auth with `user.modelName="users"` and `advanced.database.generateId` returning `false` for the user model so PostgreSQL serial keeps generating integer ids; Better Auth manages its own `account`/`verification` tables (text ids). Provisioning (personal workspace + invite consumption) runs in `databaseHooks.user.create.after`. After OAuth sign-in, a bridge mints the existing `camel_session` (with stale-token rotation) so `requireAuth` is unchanged. Custom password routes are preserved. Account linking by verified email uses Better Auth `accountLinking.enabled` + `trustedProviders`.

**Rejected options:**
- Option B (Better Auth with its own separate user table, mapped by email): duplicate user tables + sync glue, loses built-in account linking; no benefit once the integer-id blocker is solved.
- Option C (full migration to Better Auth as sole auth authority): violates scope (removes password auth), touches all existing users + session migration, high risk.

**Key tradeoffs accepted:**
- `users.username` and `users.password_hash` become **nullable** (additive, non-destructive) to allow OAuth-only users and the pick-username/set-password flows.
- `express.json()` ordering and CSRF exemption must be adjusted for the Better Auth handler.
- Two session representations exist transiently (Better Auth's own session vs `camel_session`); app auth authority remains `camel_session`.

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Anti-dummy on password path without SMTP verification | Accepted: email is mandatory but only provider-verified; password-only accounts are gated until they link a provider, so they cannot reach the board email-less | Determined dummy could still create a gated, board-less account; low impact (no board access, no traffic load) |
| Orphaned account A after link collision (Rule 4) | Assumed: A persists email-less + gated; event recorded to activity/audit log; no notification (no SMTP) | A's owner may be confused; mitigated by audit log + generic gate screen |
| Better Auth `account`/`verification` table ids | Assumed: text/UUID ids via `generateId` callback (only user model returns false) | Wrong config re-introduces id mismatch; covered by spike-style verification step |
| Set-password when a password already exists | Assumed: endpoint only allows setting when `password_hash` IS NULL; change-password is separate/out-of-scope | Users wanting to change an existing password aren't served this phase |
| Provider-token storage | Assumed: not stored now; identity schema reserves room | Future token feature needs a follow-up migration (acceptable) |

---

## Implementation Notes

- Schema migration (idempotent, additive): `ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`, `... email_verified BOOLEAN NOT NULL DEFAULT false`, `ALTER COLUMN username DROP NOT NULL`, `ALTER COLUMN password_hash DROP NOT NULL`, add `UNIQUE` on `email` (partial / nullable-aware). Create Better Auth `account` + `verification` tables (text ids) via `CREATE TABLE IF NOT EXISTS`. Keep existing `sessions`/`camel_session` as app session authority.
- Mount order in `index.ts`: Better Auth handler before global `express.json()`; add Better Auth route prefix to CSRF-exempt allowlist; ensure rate limiter also covers the OAuth callback path.
- Email gate enforced in a server middleware layered with/after `requireAuth` (e.g., return 403 + `{ needsEmailVerification: true }`), with the client redirecting to the gate screen on that signal. Allow the gate/link + set-username/set-password endpoints through the gate.
- OAuth bridge: in Better Auth `after` hook (or callback wrapper), resolve the Camel integer user, rotate any presented `camel_session`, mint a fresh `camel_session`. New users routed to pick-username before provisioning completes (username nullable until chosen).
- GitHub: request `user:email`; if profile email absent, call GitHub `/user/emails`, select primary+verified; if none, abort per Rule 1 failure.
- Env: `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`, base URL per environment; register localhost + prod redirect URIs (e.g. `/api/auth/callback/google`, `/api/auth/callback/github`).
- Verification step (recommended): minimal spike confirming `generateId:false` yields integer `users.id` on OAuth-created rows before building the full flow.

---

## Rollback Plan

- Feature is additive and env-gated: if `GOOGLE_/GITHUB_*` credentials are absent or a `OAUTH_ENABLED` flag is off, OAuth buttons/routes are inert and password auth is unaffected — no deploy needed to disable.
- Schema changes are additive (nullable columns + new tables); no destructive change to existing rows. Rollback = stop using new columns/tables; they can remain in place harmlessly.
- The email gate should ship behind its own flag so it can be disabled independently if it blocks legitimate users unexpectedly.
