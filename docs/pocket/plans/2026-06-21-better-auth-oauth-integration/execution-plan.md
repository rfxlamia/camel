# EXECUTION PLAN — Better Auth — Google + GitHub OAuth Integration

**Date:** 2026-06-21
**Spec:** docs/pocket/spec/2026-06-21-better-auth-oauth-integration/oauth-integration.md
**Status:** draft
**Total tasks:** 5

---

### Test-Architect Summary

Tasks enriched: 4 (T2, T3, T4, T5 — T1 is `[no-tdd]`, verify via `make db-migrate`)
Integration test tasks added: 3
  - IT-1 `[depends: T2]` — complete-oauth bridge (email-match + link-collision + orphan event + camel_session mint)
  - IT-2 `[depends: T3]` — email gate end-to-end on a real board route (email NULL → 403; verified → 200)
  - IT-3 `[depends: T4]` — set-username workspace provisioning + UNIQUE race; set-password → login (Rules 1, 5)
TDD order corrections made: 0 — all tasks already follow test → fail → implement → pass order
Test framework used: Vitest (describe/it/expect, vi.mock(), vi.fn(), vi.hoisted())
Coverage areas:
  - T2: pure functions `getGitHubPrimaryEmail` and `isOAuthPendingUser` (no DB/network)
  - T3: `requireEmailVerified` middleware request/response contract (no DB)
  - T4: POST /api/auth/set-username and POST /api/auth/set-password route contracts (pool mocked)
  - T5: PickUsernamePage form submit + error display; EmailGatePage OAuth button presence; AuthPage OAuth button presence (api mocked, no navigation)
  - IT-1 to IT-3: cross-unit flows with real DB (gated behind `RUN_OAUTH_IT=1` env var)
Intentionally not tested (automated):
  - Real Google/GitHub provider OAuth round-trip (manual + spike only)
  - `make db-migrate` schema correctness (structural — verified by running migration twice)
  - T2 spike step (integer user.id from SERIAL) — manual one-time verification during T2

---

## Execution Overview

### Recommended Order
```
T1 → T2 → T3, T4, T5 (parallel)
```

> Dependency order above is **recommended** — pocket skill enforces actual
> parallelism and sequencing based on its routing logic.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T3, T4, T5 | T2 completes |

### Constraints Reminder
**Architecture:** Must NOT touch users.id type (SERIAL integer) or any integer FK referencing it; preserve camel_session semantics + requireAuth; preserve CSRF protection, rate limiting, session-fixation rotation; ESM NodeNext (.js import suffixes); Biome (tabs + double quotes); idempotent schema (IF NOT EXISTS, additive ALTER)
**Out-of-scope:** SMTP/email-link verification, manual email entry, unlink provider, storing provider tokens, migrating users.id to string, replacing password auth, other providers, 2FA, SAML
**Assumptions at risk:** Better Auth generateId callback API may need verification (spike step mandated in T2); BA session → camel_session bridge mechanism needs runtime verification
**Sequencing:** Dependency order shown is recommended only — pocket enforces actual blocking rules. Do not treat `[depends: TN]` as a hard lock unless the task cannot logically proceed without the prerequisite's output.

### File Structure Map

```
Rule: DB Schema Migration (prereq for all rules)
  Modify: server/src/db/schema.sql
  Test:   none (structural — verify via make db-migrate)

Rule: Pure OAuth Signup (Rule 1) + Email-match auto-login (Rule 2) + Link collision (Rule 4)
  Create: server/src/oauth-bridge.ts                                      (created by: T2)
  Modify: server/src/auth.ts
  Modify: server/src/index.ts
  Modify: server/src/config.ts
  Test:   server/src/oauth-bridge.test.ts                                 (created by: T2)

Rule: Email gate (Rule 3)
  Create: server/src/middleware/email-gate.ts                             (created by: T3)
  Modify: server/src/routes.ts
  Test:   server/src/middleware/__tests__/email-gate.test.ts              (created by: T3)

Rule: Set-Username (Rule 1 provisioning) + Set-Password (Rule 5)
  Create: server/src/routes/oauth.ts                                      (created by: T4)
  Modify: server/src/index.ts
  Test:   server/src/routes/oauth.test.ts                                 (created by: T4)

Rule: Client UI (all rules — client side)
  Modify: client/src/types.ts
  Modify: client/src/api.ts
  Modify: client/src/components/AuthPage.tsx
  Create: client/src/components/PickUsernamePage.tsx                      (created by: T5)
  Create: client/src/components/EmailGatePage.tsx                         (created by: T5)
  Create: client/src/components/PickUsernamePage.test.tsx                 (created by: T5)
  Create: client/src/components/EmailGatePage.test.tsx                    (created by: T5)
  Create: client/src/components/AuthPage.test.tsx                         (created by: T5)
  Modify: client/src/App.tsx
  Modify: client/src/pages/SettingsPage.tsx
```

---

## Pocket Packets

---

### Task 1: DB Schema Migration [prereq]

## OBJECTIVE

Apply additive SQL changes to `server/src/db/schema.sql` to enable OAuth users: make `username` and `password_hash` nullable, add `email` / `email_verified` / `updated_at` columns to `users`, create partial unique index on `email`, and create Better Auth auxiliary tables (`ba_accounts`, `ba_verifications`, `ba_sessions`).

Files:
- Modify: `server/src/db/schema.sql`

Steps:
1. Append the following SQL block to `server/src/db/schema.sql` after the final existing statement:
   ```sql
   -- OAuth integration: Better Auth support (2026-06: additive, non-destructive)
   -- Make username / password_hash nullable to support OAuth-only users.
   ALTER TABLE users ALTER COLUMN username DROP NOT NULL;
   ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

   -- Email is captured ONLY via OAuth (always provider-verified).
   ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
   ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
   -- updated_at required by Better Auth user model adapter.
   ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
   -- NOTE: NO backfill. Per spec (Scope + Rule 3), existing password users have
   -- email_verified=false and ARE intentionally gated until they link a provider.
   -- Do not flip email_verified for password users — that defeats the email gate.

   -- Partial unique index: multiple NULL emails allowed; non-NULL emails must be unique.
   CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

   -- Better Auth OAuth identity table (one row per provider-link per user).
   CREATE TABLE IF NOT EXISTS ba_accounts (
     id                        TEXT PRIMARY KEY,
     account_id                TEXT NOT NULL,
     provider_id               TEXT NOT NULL,
     user_id                   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     access_token              TEXT,
     refresh_token             TEXT,
     id_token                  TEXT,
     access_token_expires_at   TIMESTAMPTZ,
     refresh_token_expires_at  TIMESTAMPTZ,
     scope                     TEXT,
     password                  TEXT,
     created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   CREATE INDEX IF NOT EXISTS idx_ba_accounts_user ON ba_accounts(user_id);
   CREATE UNIQUE INDEX IF NOT EXISTS idx_ba_accounts_provider ON ba_accounts(provider_id, account_id);

   -- Better Auth verification tokens (OAuth state, PKCE, etc.).
   CREATE TABLE IF NOT EXISTS ba_verifications (
     id           TEXT PRIMARY KEY,
     identifier   TEXT NOT NULL,
     value        TEXT NOT NULL,
     expires_at   TIMESTAMPTZ NOT NULL,
     created_at   TIMESTAMPTZ DEFAULT now(),
     updated_at   TIMESTAMPTZ DEFAULT now()
   );

   -- Better Auth internal sessions (separate from camel_session authority → sessions table).
   CREATE TABLE IF NOT EXISTS ba_sessions (
     id          TEXT PRIMARY KEY,
     expires_at  TIMESTAMPTZ NOT NULL,
     token       TEXT NOT NULL UNIQUE,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
     ip_address  TEXT,
     user_agent  TEXT,
     user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
   );
   CREATE INDEX IF NOT EXISTS idx_ba_sessions_user ON ba_sessions(user_id);

   -- Account-level auth/security audit log. Distinct from card_events (which is the
   -- card activity log, FK to cards + workspace_id NOT NULL). Used for events that
   -- have no card/workspace context — e.g. the Rule 4 link-collision orphan event.
   CREATE TABLE IF NOT EXISTS auth_audit (
     id          SERIAL PRIMARY KEY,
     actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
     event_type  TEXT NOT NULL,
     payload     JSONB NOT NULL DEFAULT '{}',
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   CREATE INDEX IF NOT EXISTS idx_auth_audit_actor ON auth_audit(actor_id);
   ```

2. Verify idempotency by running migration twice:
   ```
   make db-migrate
   make db-migrate
   ```
   Expected: Both runs complete without error.

3. Commit:
   `git add server/src/db/schema.sql`
   `git commit -m "feat(schema): add OAuth columns and Better Auth auxiliary tables"`

## REFERENCES LOADED
`docs/pocket/spec/2026-06-21-better-auth-oauth-integration/oauth-integration.md` — Architecture Constraints; Implementation Notes (schema migration section)
`server/src/db/schema.sql:1-204` — idempotent pattern: IF NOT EXISTS, additive ALTER TABLE, DO $$ blocks
`server/src/db/migrate.ts:1-36` — single-transaction migration applying schema.sql

## WHY THIS APPROACH
Justification: Purely additive — no DROP, no TRUNCATE, no UPDATE, no destructive changes to existing rows (per spec Architecture Constraints: "destructive changes to existing rows" are forbidden). Existing password users keep email_verified=false and are gated by T3 until they link a provider — this is the intended anti-dummy behavior, NOT a regression to backfill away. Partial unique index handles PostgreSQL NULL semantics correctly (NULLs are non-unique by default so multiple email-less rows are fine). Separate ba_* table names avoid collision with the existing sessions table. The new auth_audit table holds account-level events (Rule 4 orphan) that don't fit card_events. updated_at added per Better Auth adapter requirement.
Note: the existing `UNIQUE (username)` constraint is intentionally left in place. After `DROP NOT NULL`, PostgreSQL treats NULLs as distinct, so multiple OAuth-only users with NULL username coexist fine under the UNIQUE constraint — do NOT drop or alter it.
Complexity: lightweight

## SANDWICH CONTEXT
[CRITICAL: No DROP COLUMN, DROP TABLE, DROP INDEX, TRUNCATE, DELETE, or UPDATE of existing rows — migration must be purely additive; do NOT backfill email_verified]
You are implementing DB Schema Migration for Better Auth — Google + GitHub OAuth Integration.
Spec: docs/pocket/spec/2026-06-21-better-auth-oauth-integration/oauth-integration.md
Design decision: Option A — Better Auth with existing integer users table; PostgreSQL SERIAL generates integer IDs.
Files in scope: `server/src/db/schema.sql` only
Available after: none (prereq)
Architecture rule: users.id type (SERIAL integer) must not change. All SQL must be idempotent (IF NOT EXISTS, additive ALTER). ALTER COLUMN username DROP NOT NULL and ALTER COLUMN password_hash DROP NOT NULL are the only non-guarded statements — they are safe repeated because PostgreSQL does not error on DROP NOT NULL when already nullable.
[RESTATE: No DROP COLUMN, DROP TABLE, DROP INDEX, TRUNCATE, DELETE, or UPDATE of existing rows — purely additive; do NOT backfill email_verified]

## DELIVERABLE
[derived] Given a fresh DB, When `make db-migrate` runs, Then users.username nullable, users.password_hash nullable, users.email exists, users.email_verified exists, ba_accounts/ba_verifications/ba_sessions/auth_audit tables exist
[derived] Given a DB with existing users rows (username + password_hash set), When migration runs, Then existing rows are completely unchanged — including email_verified, which stays false (NO backfill)
[derived] Given migration already applied, When `make db-migrate` runs again, Then idempotent — no error, no duplicate tables or indexes
[must-not] Given existing users rows, When migration runs, Then no row modified or deleted

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Partial unique index on email: `WHERE email IS NOT NULL` (not a plain UNIQUE — NULLs must be non-unique)
  - ba_* table names differ from the existing `sessions` table (no collision)
  - auth_audit table created (account-level audit log, distinct from card_events)
  - Both `make db-migrate` runs complete without error
  - [no-tdd — structural task]

Must-not-have:
  - Any DROP TABLE, DROP COLUMN, DROP INDEX, TRUNCATE, or DELETE statement
  - Any UPDATE of existing rows — in particular NO email_verified backfill (spec gates password users on purpose)
  - NOT NULL constraint added to any existing column
  - Renaming existing column or table

Open question risks:
  - Better Auth may require additional columns on ba_accounts or ba_sessions → T2 spike will verify; amend schema.sql and re-run migration if needed
  - Better Auth may default to different table names → confirmed by configuring modelName in T2

Rollback note:
  - New tables and columns remain harmlessly if OAUTH_ENABLED is off
  - Full rollback requires DROP of ba_* tables and DROP COLUMN on users additions (destructive — confirm before doing)

## STOP CONDITIONS
Done when: `make db-migrate` runs twice without error; psql `\d users` shows email, email_verified, updated_at; username and password_hash are nullable; ba_accounts, ba_verifications, ba_sessions, auth_audit tables exist; existing users.email_verified is still false (no backfill)
Uncertain when: Better Auth needs different column names → surface in T2 spike and report NEEDS_CONTEXT
Escalate when: Migration causes existing row constraint violations OR existing server tests fail after migration

---

### Task 2: Better Auth OAuth Bridge [depends: T1]

## OBJECTIVE

Install `better-auth`, create `server/src/oauth-bridge.ts` (Better Auth instance, Google+GitHub social providers, field mapping, account linking, GitHub /user/emails fallback, no-verified-email abort, workspace provisioning deferral, camel_session bridge, link-collision event logging), update `server/src/auth.ts` (extend AuthUser, update requireAuth query, export mintCamelSession), update `server/src/index.ts` (Better Auth handler before express.json, CSRF exemption prefix), and update `server/src/config.ts` (OAuth env vars).

Files:
- Install: `better-auth` (server workspace)
- Create: `server/src/oauth-bridge.ts`
- Modify: `server/src/auth.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/config.ts`
- Test: `server/src/oauth-bridge.test.ts`

Steps:
1. Write failing tests for testable pure functions in oauth-bridge.ts:
   File: `server/src/oauth-bridge.test.ts`

   IMPORTANT: `oauth-bridge.ts` calls `betterAuth(...)` and imports `pool` + `config` at module
   load time. Mock all three boundaries BEFORE the import so the pure functions can be
   extracted without triggering real network / DB / env-parse side effects.

   ```typescript
   import { describe, expect, it, vi } from "vitest";

   // ── Module-level mocks (hoisted before any import) ──────────────────────────
   // oauth-bridge.ts calls betterAuth() at top level; mock the lib so import succeeds.
   vi.mock("better-auth", () => ({
   	betterAuth: vi.fn(() => ({
   		api: { getSession: vi.fn() },
   		handler: vi.fn(),
   	})),
   }));
   vi.mock("better-auth/node", () => ({
   	toNodeHandler: vi.fn(() => vi.fn()),
   }));
   // Pool + config imports must be mocked before oauth-bridge.ts is evaluated.
   vi.mock("./db/pool.js", () => ({
   	pool: { query: vi.fn(), connect: vi.fn() },
   }));
   vi.mock("./config.js", () => ({
   	config: {
   		GOOGLE_CLIENT_ID: undefined,
   		GOOGLE_CLIENT_SECRET: undefined,
   		GITHUB_CLIENT_ID: undefined,
   		GITHUB_CLIENT_SECRET: undefined,
   		BETTER_AUTH_SECRET: "test-secret",
   		APP_BASE_URL: "http://localhost:3001",
   		OAUTH_ENABLED: "false",
   	},
   }));

   // Now safe to import the module under test.
   import {
   	getGitHubPrimaryEmail,
   	isOAuthPendingUser,
   } from "./oauth-bridge.js";

   // ── getGitHubPrimaryEmail ────────────────────────────────────────────────────
   describe("getGitHubPrimaryEmail", () => {
   	it("returns null for an empty emails array", () => {
   		expect(getGitHubPrimaryEmail([])).toBeNull();
   	});

   	it("returns the primary verified email when one exists", () => {
   		const emails = [
   			{ email: "secondary@gh.com", primary: false, verified: true },
   			{ email: "primary@gh.com", primary: true, verified: true },
   		];
   		expect(getGitHubPrimaryEmail(emails)).toBe("primary@gh.com");
   	});

   	it("returns null when primary email is not verified", () => {
   		const emails = [
   			{ email: "unverified@gh.com", primary: true, verified: false },
   		];
   		expect(getGitHubPrimaryEmail(emails)).toBeNull();
   	});

   	it("returns null when no entry is both primary AND verified", () => {
   		const emails = [
   			{ email: "a@gh.com", primary: false, verified: true },
   			{ email: "b@gh.com", primary: true, verified: false },
   		];
   		expect(getGitHubPrimaryEmail(emails)).toBeNull();
   	});
   });

   // ── isOAuthPendingUser ───────────────────────────────────────────────────────
   describe("isOAuthPendingUser", () => {
   	it("returns true when username is null (new OAuth user before pick-username)", () => {
   		expect(isOAuthPendingUser(null)).toBe(true);
   	});

   	it("returns false when username is a non-null string", () => {
   		expect(isOAuthPendingUser("ana")).toBe(false);
   	});

   	it("returns false for an empty string (not null)", () => {
   		expect(isOAuthPendingUser("")).toBe(false);
   	});
   });
   ```

2. Run test — verify FAIL:
   `npx vitest run server/src/oauth-bridge.test.ts`
   Expected failure: `Cannot find module './oauth-bridge.js'`

3. Install Better Auth:
   `npm install better-auth --workspace=server`

4. Update `server/src/config.ts` — add to the zod envSchema:
   ```typescript
   GOOGLE_CLIENT_ID: z.string().optional(),
   GOOGLE_CLIENT_SECRET: z.string().optional(),
   GITHUB_CLIENT_ID: z.string().optional(),
   GITHUB_CLIENT_SECRET: z.string().optional(),
   BETTER_AUTH_SECRET: z.string().default("dev-secret-change-in-production"),
   APP_BASE_URL: z.string().default("http://localhost:3001"),
   OAUTH_ENABLED: z.enum(["true", "false"]).default("false"),
   // Dedicated, independent flag for the email gate (spec Rollback Plan) so it can
   // be toggled separately from OAuth. Defaults off so no one is gated until an
   // operator deliberately enables it (after OAuth is live).
   EMAIL_GATE_ENABLED: z.enum(["true", "false"]).default("false"),
   ```

5. Update `server/src/auth.ts`:
   - Change `AuthUser.username` from `string` to `string | null`
   - Add `email: string | null`, `emailVerified: boolean`, and `needsUsername: boolean` to `AuthUser` interface
   - Update `toUser()` helper to map:
     `email: row.email ?? null, emailVerified: row.email_verified ?? false, needsUsername: row.username === null`
   - Update `requireAuth` SQL query to also SELECT `u.email, u.email_verified`
   - Rename private `createSession` to `mintCamelSession` and export it (so oauth-bridge and oauth routes can call it)
   - Export the `SESSION_COOKIE` constant so `oauth-bridge.ts` can import it
   - Export `USERNAME_RE` and `BCRYPT_ROUNDS` so the OAuth routes (T4) reuse them instead of redeclaring (single source of truth)

6. Create `server/src/oauth-bridge.ts`:
   ```typescript
   import { randomUUID } from "node:crypto";
   import { betterAuth } from "better-auth";
   import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
   import { pool } from "./db/pool.js";
   import { config } from "./config.js";

   // Pure: extract primary verified email from GitHub /user/emails API response.
   export function getGitHubPrimaryEmail(
     emails: Array<{ email: string; primary: boolean; verified: boolean }>,
   ): string | null {
     return emails.find((e) => e.primary && e.verified)?.email ?? null;
   }

   // Pure: true for new OAuth users who haven't yet picked a username.
   export function isOAuthPendingUser(username: string | null): boolean {
     return username === null;
   }

   const socialProviders: Record<string, unknown> = {};
   if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
     socialProviders.google = {
       clientId: config.GOOGLE_CLIENT_ID,
       clientSecret: config.GOOGLE_CLIENT_SECRET,
     };
   }
   if (config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET) {
     socialProviders.github = {
       clientId: config.GITHUB_CLIENT_ID,
       clientSecret: config.GITHUB_CLIENT_SECRET,
       scope: ["user:email"],
       mapProfileToUser: (profile: { email?: string | null }) => {
         // Better Auth fetches /user/emails when scope includes user:email
         // and merges the primary verified email into profile.email.
         // Abort if still null after fetch.
         if (!profile.email) {
           throw new Error(
             "GitHub didn't provide a verified email — verify your GitHub email or use Google",
           );
         }
         return { email: profile.email };
       },
     };
   }

   export const auth = betterAuth({
     database: pool,
     secret: config.BETTER_AUTH_SECRET,
     baseURL: config.APP_BASE_URL,
     basePath: "/api/auth",
     user: {
       modelName: "users",
       fields: {
         name: "display_name",
         emailVerified: "email_verified",
         updatedAt: "updated_at",
       },
     },
     session: {
       modelName: "ba_sessions",
     },
     account: {
       modelName: "ba_accounts",
       accountLinking: {
         enabled: true,
         trustedProviders: ["google", "github"],
       },
     },
     verification: {
       modelName: "ba_verifications",
     },
     advanced: {
       database: {
         generateId: (options: { model: string }) => {
           // Return false for user model so PostgreSQL SERIAL generates integer IDs.
           if (options.model === "user") return false as unknown as string;
           return randomUUID();
         },
       },
     },
     socialProviders,
     databaseHooks: {
       user: {
         create: {
           after: async (_user: { id: unknown }) => {
             // Workspace provisioning is deferred to the set-username route (T4)
             // because username is NULL here for new OAuth users.
             // set-username provisions the workspace after the user picks a name.
           },
         },
       },
     },
   });

   export const betterAuthHandler = toNodeHandler(auth);
   ```

   **SPIKE STEP — MANDATORY before step 7**: After creating oauth-bridge.ts, verify TWO things:

   Spike A — integer IDs: After OAuth sign-in, run:
   ```sql
   SELECT id, pg_typeof(id) FROM users ORDER BY id DESC LIMIT 1;
   ```
   Expected: id is integer type. If string/UUID → generateId is misconfigured, fix before proceeding.

   Spike B — route passthrough: Confirm `toNodeHandler` passes unrecognized routes to Express `next()` rather than intercepting them. Test by calling `/api/auth/login` (existing route) after Better Auth is mounted — it must still return 200/401, NOT 404. If Better Auth intercepts it: change mounting strategy to use specific paths (`app.all("/api/auth/sign-in/*splat", ...)`, `app.all("/api/auth/callback/*splat", ...)`) instead of the wildcard catch-all, and update the CSRF exemption accordingly.

   Spike C — display_name NOT NULL: `users.display_name` is `NOT NULL`. Better Auth maps `name → display_name`. After an OAuth sign-in run `SELECT display_name FROM users ORDER BY id DESC LIMIT 1` and confirm it is non-null. If a provider profile can lack `name`, add a fallback so the insert never violates NOT NULL — e.g. in each provider's `mapProfileToUser` return a `name` derived from the email local-part (`profile.email.split("@")[0]`) when `profile.name` is empty.

6b. Add `createOAuthBridgeRouter()` to `server/src/oauth-bridge.ts` — the camel_session bridge endpoint and link-collision audit handler:
   ```typescript
   import { randomBytes } from "node:crypto";
   import { Router } from "express";
   import { mintCamelSession, SESSION_COOKIE } from "./auth.js"; // SESSION_COOKIE exported from auth.ts

   // GET /api/auth/complete-oauth
   // Called after Better Auth's OAuth callback. Reads the BA session, mints a
   // camel_session, detects link collision (Rule 4), then redirects to frontend.
   export function createOAuthBridgeRouter(): Router {
     const router = Router();

     router.get("/complete-oauth", async (req, res) => {
       // Read Better Auth session via auth.api.getSession. Express req.headers is a
       // plain IncomingHttpHeaders object, not a Web `Headers` instance — convert it
       // with Better Auth's fromNodeHeaders helper (a bare `as Headers` cast compiles
       // but fails at runtime).
       const baSession = await auth.api.getSession({
         headers: fromNodeHeaders(req.headers),
       });
       if (!baSession?.user) {
         // No BA session — OAuth failed or was denied
         res.redirect("/?oauth_error=cancelled");
         return;
       }

       const baUserId = Number(baSession.user.id);

       // Detect link collision (Rule 4): if the browser had a camel_session for
       // a different user, that user's identity was orphaned in favour of baUserId.
       const oldToken = req.cookies?.[SESSION_COOKIE] as string | undefined;
       if (oldToken) {
         const { rows: oldRows } = await pool.query<{ user_id: number }>(
           "SELECT user_id FROM sessions WHERE token = $1 AND expires_at > now()",
           [oldToken],
         );
         const oldUserId = oldRows[0]?.user_id;
         if (oldUserId && oldUserId !== baUserId) {
           // Account A (oldUserId) linked an email owned by B (baUserId) → collision.
           // End A's session and persist the orphan event to the audit log
           // (spec Rule 4: "the event is recorded in the activity/audit log").
           // Write to auth_audit, NOT card_events: card_events is the card activity
           // log (FK to cards, workspace_id NOT NULL) and has no valid
           // card_id/workspace_id for an account-level auth event — an INSERT there
           // would throw a NOT NULL violation and abort the callback.
           await pool.query("DELETE FROM sessions WHERE token = $1", [oldToken]);
           await pool.query(
             `INSERT INTO auth_audit (actor_id, event_type, payload)
              VALUES ($1, 'account_orphaned', $2)`,
             [
               oldUserId,
               JSON.stringify({ orphanedUserId: oldUserId, linkedToUserId: baUserId }),
             ],
           );
           res.clearCookie(SESSION_COOKIE, { path: "/" });
         }
       }

       // Mint fresh camel_session for the BA-authenticated user.
       await mintCamelSession(res, baUserId);

       // Route based on user state.
       const { rows: userRows } = await pool.query<{ username: string | null }>(
         "SELECT username FROM users WHERE id = $1",
         [baUserId],
       );
       const username = userRows[0]?.username ?? null;
       if (!username) {
         // New OAuth user — needs to pick a username.
         res.redirect("/?oauth=pick-username");
       } else {
         res.redirect("/");
       }
     });

     return router;
   }
   ```
   Also add `export const SESSION_COOKIE = "camel_session";` (or re-export it) from `server/src/auth.ts` so oauth-bridge.ts can import it.

7. Update `server/src/index.ts`:
   - Add import: `import { betterAuthHandler, createOAuthBridgeRouter } from "./oauth-bridge.js";`
   - Mount Better Auth handler BEFORE `express.json()` — move it to be the FIRST route:
     ```typescript
     // Better Auth handler must precede express.json() per Better Auth docs
     if (config.OAUTH_ENABLED === "true") {
       app.all("/api/auth/*splat", betterAuthHandler);
     }
     app.use(express.json()); // existing — stays here
     app.use(cookieParser()); // existing — stays here
     ```
   - Update CSRF exempt logic to cover ONLY the bootstrap routes plus Better Auth's
     own OAuth routes — do NOT exempt the whole `/api/auth/` prefix. set-username,
     set-password and logout are authenticated, state-changing POSTs and must keep
     CSRF (the client already fetches a CSRF token). Better Auth's own routes carry
     their own CSRF via the OAuth state param (and are mounted before this middleware
     anyway), so listing them is defense-in-depth, not the load-bearing protection:
     ```typescript
     // Before: const csrfExemptPaths = ["/api/auth/login", "/api/auth/register"];
     // After: bootstrap paths + Better Auth sign-in/callback subpaths only.
     const csrfExemptPaths = ["/api/auth/login", "/api/auth/register"];
     const isBetterAuthOAuthRoute =
       req.path.startsWith("/api/auth/sign-in/") ||
       req.path.startsWith("/api/auth/callback/");
     if (csrfExemptPaths.includes(req.path) || isBetterAuthOAuthRoute) {
       return next();
     }
     return csrfProtection(req, res, next);
     ```
   - Mount the OAuth bridge router (complete-oauth endpoint) AFTER express.json() and cookieParser():
     ```typescript
     app.use("/api/auth", createOAuthBridgeRouter()); // camel_session bridge + collision handler
     ```
   - Existing `app.use("/api/auth", createAuthRouter(delegatingLimiter))` stays — handles login/register/logout/me as passthrough from Better Auth for unrecognized routes

8. Run tests — verify PASS:
   `npx vitest run server/src/oauth-bridge.test.ts`
   Expected: PASS

9. Run existing auth tests to verify no regressions:
   `npx vitest run server/src/auth.test.ts`
   Expected: PASS (AuthUser type change to string | null may require minor test updates — fix if needed)

10. Commit:
    `git add server/src/oauth-bridge.ts server/src/oauth-bridge.test.ts server/src/auth.ts server/src/index.ts server/src/config.ts server/package.json package-lock.json`
    `git commit -m "feat(oauth): install Better Auth, add Google/GitHub bridge and camel_session minting"`

## REFERENCES LOADED
`docs/pocket/spec/2026-06-21-better-auth-oauth-integration/oauth-integration.md` — Rules 1, 2, 4; Design Decision; Architecture Constraints; Implementation Notes
`server/src/auth.ts:20-28, 231-247, 313-336` — AuthUser interface, createSession (→ mintCamelSession), requireAuth
`server/src/index.ts:1-118` — Express 5 mount order, CSRF middleware pattern, delegating rate limiter
`server/src/config.ts` — zod env validation pattern for optional env vars
Better Auth docs: Express 5 uses `/*splat`; `toNodeHandler`; `generateId: false` for SERIAL; `user.fields` for column mapping; `account.accountLinking.trustedProviders`; `databaseHooks.user.create.after`

## WHY THIS APPROACH
Justification: Pure functions (getGitHubPrimaryEmail, isOAuthPendingUser) extracted for testability without DB or HTTP mocks. Workspace provisioning deferred to set-username route because username is NULL at user.create time — workspace name requires a username. OAUTH_ENABLED flag gates handler mounting so existing tests are unaffected when flag is off.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Better Auth handler (app.all("/api/auth/*splat", ...)) must be mounted BEFORE app.use(express.json()) — violating this ordering breaks Better Auth's body parsing]
You are implementing the Better Auth OAuth Bridge for Better Auth — Google + GitHub OAuth Integration.
Spec: docs/pocket/spec/2026-06-21-better-auth-oauth-integration/oauth-integration.md
Design decision: Option A — Better Auth with existing integer users table; generateId returns false for user model so PostgreSQL SERIAL generates IDs; OAuth bridged into existing camel_session.
Files in scope: server/src/oauth-bridge.ts (create), server/src/oauth-bridge.test.ts (create), server/src/auth.ts (modify), server/src/index.ts (modify), server/src/config.ts (modify)
Available after: T1 (ba_* tables and nullable columns exist in schema)
Architecture rule: users.id must remain SERIAL integer — verify via spike. Preserve existing camel_session and requireAuth. CSRF exempt covers ONLY login/register + Better Auth sign-in/callback subpaths — NOT the whole /api/auth/ prefix; set-username/set-password/logout keep CSRF. Express 5 wildcard: /api/auth/*splat NOT /api/auth/*.
[RESTATE: Better Auth handler must be mounted BEFORE app.use(express.json())]

## DELIVERABLE
Given email "ana@gmail.com" not in system, When sign-in with Google picks ana@gmail.com and browser hits /api/auth/complete-oauth, Then users row created (password_hash NULL, email=ana@gmail.com, email_verified=true), ba_accounts identity row exists, user.id is integer, camel_session cookie set, browser redirected to /?oauth=pick-username
Given GitHub account has no verified primary email (no verified entry in /user/emails), When sign in with GitHub, Then sign-in aborts with "GitHub didn't provide a verified email — verify your GitHub email or use Google", no user/session created
Given account "budi" owns email "budi@gmail.com", When sign in with Google picking budi@gmail.com and browser hits /api/auth/complete-oauth, Then camel_session minted for budi, browser redirected to /, google identity linked in ba_accounts if absent
Given account A (no email, active camel_session) links email owned by B via OAuth, When /api/auth/complete-oauth runs, Then A's camel_session deleted, an orphan event persisted to auth_audit (event_type='account_orphaned', payload {orphanedUserId:A, linkedToUserId:B}), camel_session minted for B, browser redirected to /
All oauth-bridge.test.ts tests PASS. Commit exists with message matching `feat(oauth): *`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Better Auth handler mounted BEFORE express.json() in index.ts (mandatory per Better Auth docs)
  - Express 5 wildcard: `/api/auth/*splat` (NOT `/*` — Express 4 syntax)
  - generateId returns false (JavaScript false, not string "false") for the user model
  - GitHub provider has `scope: ["user:email"]`
  - mapProfileToUser for GitHub throws when profile.email is null/empty
  - CSRF exempt covers ONLY login, register, and Better Auth sign-in/callback subpaths — set-username, set-password, and logout keep CSRF protection
  - `/api/auth/complete-oauth` endpoint mints camel_session via mintCamelSession() (exported from auth.ts)
  - `/api/auth/complete-oauth` detects link collision by comparing old camel_session user_id with BA session user_id
  - Link collision persists the orphan event to auth_audit (event_type='account_orphaned') — NOT a card_events INSERT (card_events.workspace_id is NOT NULL); satisfies spec Rule 4 "recorded in the activity/audit log"
  - SESSION_COOKIE constant exported from auth.ts so oauth-bridge.ts can import it
  - Spike step executed and integer ID confirmed before step 7
  - Tests written BEFORE implementation (TDD)

Must-not-have:
  - Storing Google/GitHub access/refresh tokens in users table (out of scope)
  - Replacing or removing existing password auth routes
  - Changing users.id type
  - SMTP verification flow

Open question risks:
  - Better Auth generateId callback exact API — spike confirms; if wrong, report NEEDS_CONTEXT
  - camel_session bridge mechanism: BA creates its own session; client may need to call /api/auth/complete-oauth to mint camel_session — verify during spike and document the approach

Rollback note:
  - OAUTH_ENABLED flag absent/false: handler not mounted, OAuth routes inert, existing auth unchanged

## STOP CONDITIONS
Done when: Spike confirms integer IDs; oauth-bridge.test.ts PASS; auth.test.ts PASS (fix AuthUser type references as needed); existing server tests pass
Uncertain when: generateId returns non-integer IDs → escalate to NEEDS_CONTEXT with findings
Escalate when: Better Auth handler intercepts and blocks /api/auth/login (existing route) — investigate passthrough behavior

---

### Task 3: Email Gate Middleware [depends: T2]

## OBJECTIVE

Create `server/src/middleware/email-gate.ts` with `requireEmailVerified` middleware that checks `req.user.emailVerified` and responds 403 + `{ needsEmailVerification: true }` if false. Mount it in `server/src/routes.ts` immediately after `requireAuth`. The gate must not apply to set-username, set-password, or link-provider routes (which are on a separate router in index.ts, not on the `api` Router).

Files:
- Create: `server/src/middleware/email-gate.ts`
- Modify: `server/src/routes.ts`
- Test: `server/src/middleware/__tests__/email-gate.test.ts`

Steps:
1. Write failing tests:
   File: `server/src/middleware/__tests__/email-gate.test.ts`

   No module mocks needed — `email-gate.ts` has zero side-effectful imports (just Express types).
   Fake req/res/next objects suffice; make `res.status` chainable.

   ```typescript
   import { describe, expect, it, vi } from "vitest";
   import { requireEmailVerified } from "../email-gate.js";
   import type { NextFunction, Request, Response } from "express";

   function makeRes() {
   	const res = {
   		status: vi.fn(),
   		json: vi.fn(),
   	} as unknown as Response;
   	// Make status() chainable so `.status(403).json(...)` works.
   	(res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
   	return res;
   }

   describe("requireEmailVerified middleware", () => {
   	it("responds 403 with needsEmailVerification:true when emailVerified is false", () => {
   		const req = {
   			user: {
   				id: 1,
   				username: "lama",
   				displayName: "Lama",
   				email: null,
   				emailVerified: false,
   				needsUsername: false,
   			},
   		} as unknown as Request;
   		const res = makeRes();
   		const next = vi.fn() as unknown as NextFunction;

   		requireEmailVerified(req, res, next);

   		expect(res.status).toHaveBeenCalledWith(403);
   		expect(res.json).toHaveBeenCalledWith({ needsEmailVerification: true });
   		expect(next).not.toHaveBeenCalled();
   	});

   	it("calls next() and sends no response when emailVerified is true", () => {
   		const req = {
   			user: {
   				id: 2,
   				username: "ana",
   				displayName: "Ana",
   				email: "ana@gmail.com",
   				emailVerified: true,
   				needsUsername: false,
   			},
   		} as unknown as Request;
   		const res = makeRes();
   		const next = vi.fn() as unknown as NextFunction;

   		requireEmailVerified(req, res, next);

   		expect(next).toHaveBeenCalledOnce();
   		expect(res.status).not.toHaveBeenCalled();
   		expect(res.json).not.toHaveBeenCalled();
   	});

   	it("calls next() without blocking when req.user is undefined (requireAuth handles 401)", () => {
   		const req = {} as Request;
   		const res = makeRes();
   		const next = vi.fn() as unknown as NextFunction;

   		requireEmailVerified(req, res, next);

   		expect(next).toHaveBeenCalledOnce();
   		expect(res.status).not.toHaveBeenCalled();
   	});
   });
   ```

2. Run test — verify FAIL:
   `npx vitest run server/src/middleware/__tests__/email-gate.test.ts`
   Expected failure: `Cannot find module '../email-gate.js'`

3. Implement `server/src/middleware/email-gate.ts`:
   ```typescript
   import type { NextFunction, Request, Response } from "express";

   export function requireEmailVerified(
     req: Request,
     res: Response,
     next: NextFunction,
   ): void {
     if (!req.user) {
       next();
       return;
     }
     if (!req.user.emailVerified) {
       res.status(403).json({ needsEmailVerification: true });
       return;
     }
     next();
   }
   ```

4. Modify `server/src/routes.ts` — add `requireEmailVerified` after `requireAuth`, behind its OWN flag:
   ```typescript
   import { requireEmailVerified } from "./middleware/email-gate.js";
   import { config } from "./config.js";

   export const api = Router();

   api.use(requireAuth);
   // Spec (Rollback Plan): "The email gate should ship behind its own flag so it
   // can be disabled independently if it blocks legitimate users unexpectedly."
   // This is a DEDICATED flag, separate from OAUTH_ENABLED — an operator can run
   // OAuth without the gate, or stage the gate after OAuth is live. When the gate
   // is ON it DOES block existing password users (email_verified=false) until they
   // link a provider — that is the intended anti-dummy behavior per spec Scope +
   // Rule 3, NOT a regression.
   if (config.EMAIL_GATE_ENABLED === "true") {
     api.use(requireEmailVerified); // ← after requireAuth, before route mounts
   }
   // ... existing route mounts unchanged
   ```

   Operational note for rollout: enabling EMAIL_GATE_ENABLED with OAuth not yet
   configured WILL gate every existing password user (by design). Enable the gate
   only once OAuth credentials are live so gated users have a working EmailGatePage
   to escape through. There is NO email_verified backfill — the gate, not a data
   mutation, is the control.

5. Run tests — verify PASS:
   `npx vitest run server/src/middleware/__tests__/email-gate.test.ts`
   Expected: PASS

6. Run full server test suite:
   `npm run test --workspace=server`
   Expected: PASS (existing integration tests mock requireAuth — gate will be bypassed via the mock)

7. Commit:
   `git add server/src/middleware/email-gate.ts server/src/middleware/__tests__/email-gate.test.ts server/src/routes.ts`
   `git commit -m "feat(auth): add server-enforced email-verified gate on board API routes"`

## REFERENCES LOADED
`docs/pocket/spec/2026-06-21-better-auth-oauth-integration/oauth-integration.md` — Rule 3: Email gate (server-enforced)
`server/src/routes.ts:36-38` — requireAuth usage on api Router
`server/src/middleware/csrf.ts` — Express middleware pattern: Request, Response, NextFunction
`server/src/auth.ts:20-28` — AuthUser interface (will have emailVerified: boolean after T2)

## WHY THIS APPROACH
Justification: Single pure middleware function, easy to test, explicit error shape for client detection. Mounted at router level after requireAuth so all board API routes are covered without per-route modification. OAuth routes (set-username, set-password, link-provider) are on a separate router in index.ts and are NOT behind this gate.
Complexity: lightweight

## SANDWICH CONTEXT
[CRITICAL: Gate must respond with 403 JSON (not redirect) — server-enforced, not UI-only]
You are implementing Email Gate Middleware for Better Auth — Google + GitHub OAuth Integration.
Spec: docs/pocket/spec/2026-06-21-better-auth-oauth-integration/oauth-integration.md
Design decision: Option A — email gate via server middleware on the /api Router (board API routes).
Files in scope: `server/src/middleware/email-gate.ts` (create), `server/src/middleware/__tests__/email-gate.test.ts` (create), `server/src/routes.ts` (modify)
Available after: T2 (requireAuth populates req.user.emailVerified)
Architecture rule: Gate must be server-side (not UI-only), mounted inside `if (config.EMAIL_GATE_ENABLED === "true")` after `api.use(requireAuth)` — its own dedicated flag per spec Rollback Plan, NOT tied to OAUTH_ENABLED. When ON, the gate blocks ALL email-less users including existing password users (spec Scope: "Applies to old password users AND new password signups"); there is NO email_verified backfill. Set-username, set-password, and link-provider routes bypass this gate because they are mounted on /api/auth (not on the `api` Router).
[RESTATE: Gate must respond with 403 JSON (not redirect) — server-enforced, not UI-only]

## DELIVERABLE
Given account "lama" has email NULL (emailVerified=false), When authenticated request to GET /api/workspaces, Then 403 `{ needsEmailVerification: true }`
Given "lama" links Google picking lama@gmail.com (email unused), When link OAuth completes (email_verified=true set on user), Then subsequent GET /api/workspaces returns 200
Given account with emailVerified=true, When authenticated request to /api/workspaces, Then passes through (no gate)
[must-not] Given unauthenticated request, When request to /api/workspaces, Then requireAuth returns 401 (NOT email gate 403)

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Response body: `{ needsEmailVerification: true }` exact key (client detects this)
  - Mounted AFTER requireAuth in routes.ts, wrapped in `if (config.EMAIL_GATE_ENABLED === "true")` — its own dedicated flag (spec Rollback Plan), independent of OAUTH_ENABLED
  - NO email_verified backfill: existing password users ARE gated when the flag is on, by design (spec Scope + Rule 3)
  - Set-username, set-password, and link-provider routes bypass gate (they are on /api/auth in index.ts, NOT on the `api` Router)
  - Tests written BEFORE implementation

Must-not-have:
  - 302 redirect (must be 403 JSON)
  - Blocking unauthenticated requests (requireAuth handles 401)
  - Modifications outside listed files

Open question risks:
  - If T2 incomplete (emailVerified not on AuthUser) → gate cannot check it → NEEDS_CONTEXT; wait for T2
  - Existing integration tests that mock requireAuth: gate middleware runs after the mock, so `req.user.emailVerified` may be undefined → fix mock to include `emailVerified: true` if existing tests fail

Rollback note:
  - Remove `api.use(requireEmailVerified)` from routes.ts to instantly disable gate

## STOP CONDITIONS
Done when: All DELIVERABLE scenarios pass; email-gate.test.ts PASS; npm run test (server) PASS
Uncertain when: T2 incomplete (emailVerified not on AuthUser) → report NEEDS_CONTEXT
Escalate when: Gate accidentally blocks set-username or set-password routes

---

### Task 4: OAuth Routes — Set-Username & Set-Password [depends: T2]

## OBJECTIVE

Create `server/src/routes/oauth.ts` with POST `/api/auth/set-username` (pick username for new OAuth users, provisions personal workspace + consumes pending invites: grant membership then delete invite per spec Rule 1) and POST `/api/auth/set-password` (set password for accounts where password_hash IS NULL). Mount both in `server/src/index.ts` on the `/api/auth` prefix AFTER express.json() and OUTSIDE the email gate (not on the `api` Router).

Files:
- Create: `server/src/routes/oauth.ts`
- Modify: `server/src/index.ts`
- Test: `server/src/routes/oauth.test.ts`

Steps:
1. Write failing tests:
   File: `server/src/routes/oauth.test.ts`

   Strategy: mock `../db/pool.js` (fake client with sequenced `query` calls), mock `../auth.js`
   partially so `requireAuth` injects `req.user` but `createSignupWorkspacePlan` / `PendingInvite`
   stay real, and mount `oauthRouter` via supertest on a minimal Express app.

   ```typescript
   import {
   	afterEach,
   	beforeEach,
   	describe,
   	expect,
   	it,
   	vi,
   } from "vitest";
   import express from "express";
   import request from "supertest";

   // ── Module-level mocks ───────────────────────────────────────────────────────
   // Hoist shared state so vi.mock factories can reference it.
   const { mockTestUser, mockClient } = vi.hoisted(() => {
   	const mockClient = {
   		query: vi.fn(),
   		release: vi.fn(),
   	};
   	return {
   		mockTestUser: {
   			id: 42,
   			username: null as string | null,
   			displayName: "Ana",
   			email: "ana@gmail.com",
   			emailVerified: true,
   			needsUsername: true,
   		},
   		mockClient,
   	};
   });

   // Pool: pool.connect() returns the fake client; pool.query() for non-transactional queries.
   vi.mock("../db/pool.js", () => ({
   	pool: {
   		query: vi.fn(),
   		connect: vi.fn(() => Promise.resolve(mockClient)),
   	},
   }));

   // Auth: partial mock — keep real createSignupWorkspacePlan, replace requireAuth.
   vi.mock("../auth.js", async (importOriginal) => {
   	const actual = await importOriginal<typeof import("../auth.js")>();
   	return {
   		...actual,
   		requireAuth: (req: any, _res: any, next: any) => {
   			req.user = { ...mockTestUser };
   			next();
   		},
   	};
   });

   // bcryptjs: prevent real hashing in tests — return a deterministic fake hash.
   vi.mock("bcryptjs", () => ({
   	default: { hash: vi.fn(async () => "hashed_password") },
   }));

   // Now safe to import routes under test.
   import { oauthRouter } from "../routes/oauth.js";
   import { pool } from "../db/pool.js";

   // ── Test app ─────────────────────────────────────────────────────────────────
   function createApp() {
   	const app = express();
   	app.use(express.json());
   	app.use("/api/auth", oauthRouter);
   	return app;
   }
   const app = createApp();

   // ── Helpers ───────────────────────────────────────────────────────────────────
   /** Set up the fake transactional client for a successful set-username flow. */
   function setupSuccessfulSetUsernameClient() {
   	mockClient.query
   		.mockResolvedValueOnce(undefined) // BEGIN
   		.mockResolvedValueOnce(undefined) // UPDATE users SET username
   		.mockResolvedValueOnce({ rows: [] }) // SELECT workspace_invites (no pending)
   		.mockResolvedValueOnce({ rows: [{ id: 99 }] }) // INSERT workspaces RETURNING id
   		.mockResolvedValueOnce(undefined) // INSERT workspace_members
   		.mockResolvedValueOnce(undefined); // COMMIT
   }

   // ── set-username tests ────────────────────────────────────────────────────────
   describe("POST /api/auth/set-username", () => {
   	beforeEach(() => {
   		vi.clearAllMocks();
   		mockTestUser.username = null; // default: user hasn't picked a username yet
   	});
   	afterEach(() => vi.clearAllMocks());

   	it("200 — creates username and workspace when username is null and name is unique", async () => {
   		setupSuccessfulSetUsernameClient();

   		const res = await request(app)
   			.post("/api/auth/set-username")
   			.send({ username: "ana" });

   		expect(res.status).toBe(200);
   		expect(res.body).toEqual({ ok: true });
   		// BEGIN + UPDATE + SELECT invites + INSERT workspace + INSERT member + COMMIT
   		expect(mockClient.query).toHaveBeenCalledTimes(6);
   		expect(mockClient.release).toHaveBeenCalledOnce();
   	});

   	it("409 — 'Username already taken' when DB throws unique violation (23505)", async () => {
   		mockClient.query
   			.mockResolvedValueOnce(undefined) // BEGIN
   			.mockRejectedValueOnce({ code: "23505" }); // UPDATE throws unique violation

   		const res = await request(app)
   			.post("/api/auth/set-username")
   			.send({ username: "budi" });

   		expect(res.status).toBe(409);
   		expect(res.body.error).toMatch(/username already taken/i);
   		expect(mockClient.release).toHaveBeenCalledOnce();
   	});

   	it("400 — validation error when username is shorter than 3 characters", async () => {
   		const res = await request(app)
   			.post("/api/auth/set-username")
   			.send({ username: "ab" });

   		expect(res.status).toBe(400);
   		expect(res.body.error).toMatch(/3/); // mentions 3 char minimum
   		// No DB calls should have been made
   		expect(mockClient.query).not.toHaveBeenCalled();
   	});

   	it("409 — 'Username already set' when req.user.username is not null", async () => {
   		mockTestUser.username = "existing_name"; // simulate user already has username

   		const res = await request(app)
   			.post("/api/auth/set-username")
   			.send({ username: "newname" });

   		expect(res.status).toBe(409);
   		expect(res.body.error).toMatch(/username already set/i);
   		expect(mockClient.query).not.toHaveBeenCalled();
   	});
   });

   // ── set-password tests ────────────────────────────────────────────────────────
   describe("POST /api/auth/set-password", () => {
   	beforeEach(() => {
   		vi.clearAllMocks();
   		mockTestUser.username = "ana"; // set-password requires existing username
   	});
   	afterEach(() => vi.clearAllMocks());

   	it("200 — sets password_hash when password_hash is currently null", async () => {
   		// pool.query is called directly (not via client.connect) for read + update
   		(pool.query as ReturnType<typeof vi.fn>)
   			.mockResolvedValueOnce({ rows: [{ password_hash: null }] }) // SELECT password_hash
   			.mockResolvedValueOnce(undefined); // UPDATE users SET password_hash

   		const res = await request(app)
   			.post("/api/auth/set-password")
   			.send({ password: "secret123" });

   		expect(res.status).toBe(200);
   		expect(res.body).toEqual({ ok: true });
   	});

   	it("400 — rejects password shorter than 8 characters", async () => {
   		const res = await request(app)
   			.post("/api/auth/set-password")
   			.send({ password: "short" });

   		expect(res.status).toBe(400);
   		expect(res.body.error).toMatch(/at least 8 characters/i);
   		expect(pool.query).not.toHaveBeenCalled();
   	});

   	it("409 — 'Password already set' when password_hash is not null", async () => {
   		(pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
   			rows: [{ password_hash: "$2a$10$existing_hash" }],
   		});

   		const res = await request(app)
   			.post("/api/auth/set-password")
   			.send({ password: "secret123" });

   		expect(res.status).toBe(409);
   		expect(res.body.error).toMatch(/password already set/i);
   	});
   });
   ```

2. Run test — verify FAIL:
   `npx vitest run server/src/routes/oauth.test.ts`
   Expected failure: `Cannot find module '../routes/oauth.js'`

3. Implement `server/src/routes/oauth.ts`:
   ```typescript
   import bcrypt from "bcryptjs";
   import { Router } from "express";
   import {
     requireAuth,
     createSignupWorkspacePlan,
     type PendingInvite,
     USERNAME_RE,
     BCRYPT_ROUNDS,
   } from "../auth.js";
   import { pool } from "../db/pool.js";
   import { validateUsername } from "../validators/input-length.js";

   // USERNAME_RE and BCRYPT_ROUNDS are imported from auth.js (single source of
   // truth) — do NOT redeclare them here. T2 must export both from auth.ts.

   export const oauthRouter = Router();

   // POST /api/auth/set-username
   // For new OAuth users to pick a username. Also provisions personal workspace.
   oauthRouter.post("/set-username", requireAuth, async (req, res) => {
     if (!req.user) return res.status(401).json({ error: "authentication required" });
     if (req.user.username !== null) {
       return res.status(409).json({ error: "Username already set." });
     }
     const { username, displayName } = req.body ?? {};
     const validation = validateUsername(username ?? "");
     if (!validation.valid || !USERNAME_RE.test(validation.trimmed ?? "")) {
       return res.status(400).json({
         error: "Username must be 3–32 characters: letters, numbers, underscore.",
       });
     }
     const normalizedUsername = validation.trimmed!.toLowerCase();
     const displayNameFinal =
       typeof displayName === "string" && displayName.trim()
         ? displayName.trim()
         : normalizedUsername;

     const client = await pool.connect();
     try {
       await client.query("BEGIN");
       await client.query(
         "UPDATE users SET username = $1, display_name = $2 WHERE id = $3",
         [normalizedUsername, displayNameFinal, req.user.id],
       );
       const pendingRes = await client.query<{
         id: number;
         workspace_id: number;
         username: string;
         role: string;
       }>(
         "SELECT id, workspace_id, username, role FROM workspace_invites WHERE username = $1",
         [normalizedUsername],
       );
       const pendingInvites: PendingInvite[] = pendingRes.rows.map((r) => ({
         id: r.id,
         workspaceId: r.workspace_id,
         username: r.username,
         role: r.role,
       }));
       const plan = createSignupWorkspacePlan({
         user: {
           id: req.user.id,
           username: normalizedUsername,
           displayName: displayNameFinal,
         },
         pendingInvites,
       });
       const wsRes = await client.query<{ id: number }>(
         "INSERT INTO workspaces (name, owner_user_id, is_personal) VALUES ($1, $2, $3) RETURNING id",
         [
           plan.personalWorkspace.name,
           plan.personalWorkspace.ownerUserId,
           plan.personalWorkspace.isPersonal,
         ],
       );
       const workspaceId = wsRes.rows[0].id;
       for (const m of plan.memberships) {
         await client.query(
           "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)",
           [workspaceId, m.userId, m.role],
         );
       }
       // Consume pending invites (spec Rule 1: "pending invites consumed").
       // For EACH invite, grant the membership AND delete the invite in the same
       // transaction — mirroring the explicit accept flow in invites.ts. NEVER
       // delete an invite without first inserting its membership (the original
       // plan's delete-only version silently dropped users from invited
       // workspaces). Iterating per invite keeps membership.role correct per
       // invite. The happy path (no invites) runs zero of these queries, so the
       // unit test's 6-query sequence is unchanged.
       for (const invite of pendingInvites) {
         await client.query(
           "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)",
           [invite.workspaceId, req.user.id, invite.role],
         );
         await client.query("DELETE FROM workspace_invites WHERE id = $1", [
           invite.id,
         ]);
       }
       await client.query("COMMIT");
       res.json({ ok: true });
     } catch (err) {
       await client.query("ROLLBACK");
       if ((err as { code?: string }).code === "23505") {
         return res
           .status(409)
           .json({ error: "Username already taken — try another." });
       }
       throw err;
     } finally {
       client.release();
     }
   });

   // POST /api/auth/set-password
   // For OAuth-only users (password_hash IS NULL) to add a recovery password.
   oauthRouter.post("/set-password", requireAuth, async (req, res) => {
     if (!req.user) return res.status(401).json({ error: "authentication required" });
     const { password } = req.body ?? {};
     if (typeof password !== "string" || password.length < 8) {
       return res
         .status(400)
         .json({ error: "Password must be at least 8 characters." });
     }
     const { rows } = await pool.query<{ password_hash: string | null }>(
       "SELECT password_hash FROM users WHERE id = $1",
       [req.user.id],
     );
     if (rows[0]?.password_hash !== null) {
       return res
         .status(409)
         .json({ error: "Password already set. Use change-password instead." });
     }
     const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
     await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
       hash,
       req.user.id,
     ]);
     res.json({ ok: true });
   });
   ```

4. Mount oauth routes in `server/src/index.ts`:
   Add import and mount AFTER express.json() and BEFORE `app.use("/api", api)`:
   ```typescript
   import { oauthRouter } from "./routes/oauth.js";
   // ... after cookieParser():
   app.use("/api/auth", oauthRouter); // set-username, set-password (outside email gate)
   ```

5. Run tests — verify PASS:
   `npx vitest run server/src/routes/oauth.test.ts`
   Expected: PASS

6. Run full server test suite:
   `npm run test --workspace=server`
   Expected: PASS

7. Commit:
   `git add server/src/routes/oauth.ts server/src/routes/oauth.test.ts server/src/index.ts`
   `git commit -m "feat(auth): add set-username and set-password OAuth completion routes"`

## REFERENCES LOADED
`docs/pocket/spec/2026-06-21-better-auth-oauth-integration/oauth-integration.md` — Rule 1 (username selection + workspace provisioning), Rule 5 (set password)
`server/src/auth.ts:40-55, 375-434` — createSignupWorkspacePlan, register route workspace provisioning pattern
`server/src/validators/input-length.js` — validateUsername pattern reused from register
`server/src/routes.ts` — Router pattern, requireAuth usage

## WHY THIS APPROACH
Justification: Separate oauthRouter mounted at /api/auth avoids the email gate on the `api` Router (T3). set-username reuses createSignupWorkspacePlan so workspace provisioning logic stays DRY. set-password strictly guards against overwriting existing password_hash (change-password is out of scope for this phase).

DRY note: the BEGIN → INSERT workspace → INSERT members → COMMIT transaction here is
nearly identical to the one in `auth.ts` register (lines ~374–433). Extract a shared
`provisionPersonalWorkspace(client, user)` helper in `auth.ts`, export it, and call it
from BOTH register and set-username. The helper must preserve the exact query order
(BEGIN, UPDATE/INSERT user, INSERT workspace, INSERT member(s), COMMIT) so the T4 unit
test's sequenced mock (6 client.query calls) still matches. createSignupWorkspacePlan
covers only the plan object — the transaction itself is what needs de-duplicating.

Invite consumption (spec Rule 1): set-username grants membership + deletes the invite
per pending invite, mirroring the accept endpoint in invites.ts. NOTE a pre-existing
discrepancy — the current `register` route does NOT consume invites inline (it leaves
them for the explicit accept flow), even though the spec's Current State claims it
does. This plan makes the OAuth path spec-compliant; if you want both signup paths
identical, fold the same consumption into the shared helper and apply it to register
too. Flag to the spec author rather than silently leaving the two paths divergent.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: oauthRouter must be mounted on /api/auth in index.ts — NOT on the `api` Router — so it bypasses the email gate middleware (T3)]
You are implementing OAuth Routes (set-username + set-password) for Better Auth — Google + GitHub OAuth Integration.
Spec: docs/pocket/spec/2026-06-21-better-auth-oauth-integration/oauth-integration.md
Design decision: Option A — OAuth users have NULL username until they call set-username; set-username provisions workspace using createSignupWorkspacePlan (same as register).
Files in scope: `server/src/routes/oauth.ts` (create), `server/src/routes/oauth.test.ts` (create), `server/src/index.ts` (mount only)
Available after: T2 (requireAuth updated for AuthUser with username: string|null; mintCamelSession exported; createSignupWorkspacePlan and PendingInvite exported from auth.ts)
Architecture rule: set-username and set-password are NOT behind email gate. set-password is strictly "set when NULL" — no change-password logic. Reuse createSignupWorkspacePlan; do NOT duplicate workspace provisioning logic.
[RESTATE: oauthRouter must be mounted on /api/auth in index.ts — NOT on the `api` Router — so it bypasses the email gate middleware (T3)]

## DELIVERABLE
Given account with username=null (new OAuth user), When POST /api/auth/set-username {"username": "ana"} (unique), Then 200 ok, username="ana" in DB, personal workspace created, and each pending invite for "ana" consumed (workspace_members row inserted + invite row deleted)
Given POST /api/auth/set-username {"username": "budi"} where "budi" already exists, Then 409 "Username already taken"
Given account with username already set, When POST /api/auth/set-username, Then 409 "Username already set"
Given account with password_hash=null, When POST /api/auth/set-password {"password": "secret123"}, Then 200 ok, password_hash set (bcrypt), user can subsequently log in with username + password
Given POST /api/auth/set-password {"password": "short"} (< 8 chars), Then 400 "Password must be at least 8 characters"
Given account with existing password_hash, When POST /api/auth/set-password, Then 409 "Password already set"
Given two concurrent POST /api/auth/set-username submissions with "max", Then DB UNIQUE(username) admits exactly one, the other gets 409

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - set-username validates username format (3-32 chars, letters/numbers/underscore) via validateUsername
  - set-username only succeeds if current username IS NULL
  - set-password only succeeds if password_hash IS NULL
  - Workspace provisioning runs inside a DB transaction (BEGIN/COMMIT/ROLLBACK)
  - createSignupWorkspacePlan reused (no duplication)
  - Pending invites consumed: for each invite, INSERT workspace_members THEN DELETE the invite (membership always granted before deletion) — spec Rule 1

Must-not-have:
  - change-password logic (only set-password when NULL — change-password is out of scope)
  - Deleting a workspace_invite without first inserting its membership (the original delete-only bug)
  - Mounting oauthRouter on the `api` Router (would put it behind email gate)
  - Email gate on these routes

Open question risks:
  - T2 must export createSignupWorkspacePlan and PendingInvite (already exported in current auth.ts — verify in T2 output)
  - requireAuth must work for users with username=null (verified in T2)

Rollback note:
  - These are new routes; removing oauthRouter mount restores prior state

## STOP CONDITIONS
Done when: All DELIVERABLE scenarios pass; oauth.test.ts PASS; full server test suite PASS
Uncertain when: T2 incomplete (createSignupWorkspacePlan not exported or requireAuth broken for null username) → NEEDS_CONTEXT
Escalate when: set-username route is accidentally behind email gate (returns 403)

---

### Task 5: Client Auth UI — OAuth Buttons, PickUsername & EmailGate Screens [depends: T2]

## OBJECTIVE

Extend the client to support the OAuth user journey: add Google/GitHub sign-in buttons to `AuthPage.tsx`; extend `User` type with `emailVerified`, `needsUsername` fields; add `setUsername`/`setPassword`/`startOAuth` functions to `api.ts`; create `PickUsernamePage.tsx` (post-OAuth username selection) and `EmailGatePage.tsx` (link-provider screen); update `App.tsx` state machine to route to these pre-auth screens; add set-password section to `SettingsPage.tsx`.

**MANDATORY: Load `docs/pocket/rule/creative-brief.md` before making any design decisions for new components.**

Files:
- Modify: `client/src/types.ts`
- Modify: `client/src/api.ts`
- Modify: `client/src/components/AuthPage.tsx`
- Create: `client/src/components/PickUsernamePage.tsx`
- Create: `client/src/components/EmailGatePage.tsx`
- Create: `client/src/components/PickUsernamePage.test.tsx`
- Create: `client/src/components/EmailGatePage.test.tsx`
- Create: `client/src/components/AuthPage.test.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/pages/SettingsPage.tsx`

Steps:
1. Write failing tests (run with `npm run test --workspace=client`):

   IMPORTANT: OAuth redirects use `window.location.href` (full navigation). jsdom throws
   "Not implemented: navigation" on that. Asserting against `api.startOAuth` mock is the
   correct approach — the component routes through `api.startOAuth`, so verifying the call
   with the right provider argument is both accurate and safe in jsdom.

   Run client tests exclusively with `npm run test --workspace=client`, NOT raw `npx vitest`.

   ---

   File: `client/src/components/PickUsernamePage.test.tsx`

   ```tsx
   // @vitest-environment jsdom
   import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
   import { afterEach, describe, expect, it, vi } from "vitest";

   // Mock ../api so tests never hit the network.
   const mockSetUsername = vi.fn();
   vi.mock("../api", () => ({
   	api: {
   		setUsername: (...a: unknown[]) => mockSetUsername(...a),
   		me: vi.fn(),
   	},
   	ApiError: class ApiError extends Error {
   		status: number;
   		constructor(msg: string, status = 400) {
   			super(msg);
   			this.status = status;
   		}
   	},
   }));

   import PickUsernamePage from "./PickUsernamePage";

   afterEach(() => {
   	cleanup();
   	vi.clearAllMocks();
   });

   describe("PickUsernamePage", () => {
   	it("calls api.setUsername with the submitted username", async () => {
   		mockSetUsername.mockResolvedValue({ ok: true });
   		const onComplete = vi.fn();

   		render(<PickUsernamePage onComplete={onComplete} />);

   		// Find username input and submit button (flexible label match)
   		const input = screen.getByRole("textbox");
   		fireEvent.change(input, { target: { value: "ana" } });
   		fireEvent.click(screen.getByRole("button", { name: /submit|choose|confirm|continue/i }));

   		// Assert on first arg only — displayName is optional, may or may not be passed.
   		await waitFor(() => expect(mockSetUsername.mock.calls[0]?.[0]).toBe("ana"));
   	});

   	it("invokes onComplete callback after api.setUsername resolves ok", async () => {
   		const updatedUser = {
   			id: 1,
   			username: "ana",
   			displayName: "Ana",
   			emailVerified: true,
   			needsUsername: false,
   		};
   		mockSetUsername.mockResolvedValue({ ok: true });
   		// api.me() is called to refresh user after setUsername
   		const { api } = await import("../api");
   		(api.me as ReturnType<typeof vi.fn>).mockResolvedValue({ user: updatedUser });
   		const onComplete = vi.fn();

   		render(<PickUsernamePage onComplete={onComplete} />);

   		const input = screen.getByRole("textbox");
   		fireEvent.change(input, { target: { value: "ana" } });
   		fireEvent.click(screen.getByRole("button", { name: /submit|choose|confirm|continue/i }));

   		await waitFor(() => expect(onComplete).toHaveBeenCalledWith(updatedUser));
   	});

   	it("shows 'Username already taken' error when api.setUsername rejects with that message", async () => {
   		const { ApiError } = await import("../api");
   		mockSetUsername.mockRejectedValue(new ApiError("Username already taken", 409));
   		const onComplete = vi.fn();

   		render(<PickUsernamePage onComplete={onComplete} />);

   		const input = screen.getByRole("textbox");
   		fireEvent.change(input, { target: { value: "budi" } });
   		fireEvent.click(screen.getByRole("button", { name: /submit|choose|confirm|continue/i }));

   		await waitFor(() =>
   			expect(screen.getByText(/username already taken/i)).toBeTruthy(),
   		);
   		expect(onComplete).not.toHaveBeenCalled();
   	});
   });
   ```

   ---

   File: `client/src/components/EmailGatePage.test.tsx`

   ```tsx
   // @vitest-environment jsdom
   import { cleanup, fireEvent, render, screen } from "@testing-library/react";
   import { afterEach, describe, expect, it, vi } from "vitest";

   // Mock ../api — EmailGatePage calls api.startOAuth() on button click.
   const mockStartOAuth = vi.fn();
   vi.mock("../api", () => ({
   	api: {
   		startOAuth: (...a: unknown[]) => mockStartOAuth(...a),
   	},
   }));

   import EmailGatePage from "./EmailGatePage";

   const GATED_USER = {
   	id: 5,
   	username: "lama",
   	displayName: "Lama",
   	emailVerified: false,
   	needsUsername: false,
   };

   afterEach(() => {
   	cleanup();
   	vi.clearAllMocks();
   });

   describe("EmailGatePage", () => {
   	it("renders both Link Google and Link GitHub buttons", () => {
   		render(<EmailGatePage user={GATED_USER} onComplete={vi.fn()} />);
   		expect(screen.getByRole("button", { name: /link google/i })).toBeTruthy();
   		expect(screen.getByRole("button", { name: /link github/i })).toBeTruthy();
   	});

   	it("calls api.startOAuth('google') when Link Google is clicked", () => {
   		render(<EmailGatePage user={GATED_USER} onComplete={vi.fn()} />);
   		fireEvent.click(screen.getByRole("button", { name: /link google/i }));
   		expect(mockStartOAuth).toHaveBeenCalledWith("google");
   	});

   	it("calls api.startOAuth('github') when Link GitHub is clicked", () => {
   		render(<EmailGatePage user={GATED_USER} onComplete={vi.fn()} />);
   		fireEvent.click(screen.getByRole("button", { name: /link github/i }));
   		expect(mockStartOAuth).toHaveBeenCalledWith("github");
   	});
   });
   ```

   ---

   File: `client/src/components/AuthPage.test.tsx`

   ```tsx
   // @vitest-environment jsdom
   import { cleanup, fireEvent, render, screen } from "@testing-library/react";
   import { afterEach, describe, expect, it, vi } from "vitest";

   // Mock ../api — AuthPage calls api.startOAuth() for OAuth buttons.
   const mockStartOAuth = vi.fn();
   vi.mock("../api", () => ({
   	api: {
   		login: vi.fn(),
   		startOAuth: (...a: unknown[]) => mockStartOAuth(...a),
   	},
   	ApiError: class ApiError extends Error {
   		status: number;
   		constructor(status: number) {
   			super("api error");
   			this.status = status;
   		}
   	},
   }));

   import AuthPage from "./AuthPage";

   afterEach(() => {
   	cleanup();
   	vi.clearAllMocks();
   });

   describe("AuthPage — OAuth buttons", () => {
   	it("renders 'Sign in with Google' and 'Sign in with GitHub' buttons", () => {
   		render(<AuthPage onAuth={vi.fn()} />);
   		expect(screen.getByRole("button", { name: /sign in with google/i })).toBeTruthy();
   		expect(screen.getByRole("button", { name: /sign in with github/i })).toBeTruthy();
   	});

   	it("calls api.startOAuth('google') when Sign in with Google is clicked", () => {
   		render(<AuthPage onAuth={vi.fn()} />);
   		fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
   		expect(mockStartOAuth).toHaveBeenCalledWith("google");
   	});

   	it("calls api.startOAuth('github') when Sign in with GitHub is clicked", () => {
   		render(<AuthPage onAuth={vi.fn()} />);
   		fireEvent.click(screen.getByRole("button", { name: /sign in with github/i }));
   		expect(mockStartOAuth).toHaveBeenCalledWith("github");
   	});

   	it("shows 'Login cancelled' message when oauthError prop is 'cancelled'", () => {
   		render(<AuthPage onAuth={vi.fn()} oauthError="cancelled" />);
   		expect(screen.getByText(/login cancelled/i)).toBeTruthy();
   	});
   });
   ```

2. Run tests — verify FAIL:
   `npm run test --workspace=client`
   Expected failure: module not found for new components; AuthPage missing OAuth buttons

3. Update `client/src/types.ts`:
   ```typescript
   export interface User {
     id: number;
     username: string | null;      // null for new OAuth users before username selection
     displayName: string;
     emailVerified: boolean;
     needsUsername: boolean;       // true after OAuth signup, before set-username completes
   }
   ```

4. Update `client/src/api.ts` — add to the `api` object:
   ```typescript
   setUsername: (username: string, displayName?: string) =>
     request<{ ok: boolean }>("/auth/set-username", {
       method: "POST",
       body: JSON.stringify({ username, displayName }),
     }),
   setPassword: (password: string) =>
     request<{ ok: boolean }>("/auth/set-password", {
       method: "POST",
       body: JSON.stringify({ password }),
     }),
   startOAuth: (provider: "google" | "github", callbackURL = "/auth/complete") => {
     window.location.href = `/api/auth/sign-in/social?provider=${provider}&callbackURL=${encodeURIComponent(callbackURL)}`;
   },
   ```

5. Load `docs/pocket/rule/creative-brief.md` — apply OKLCH colors, Work Sans typography, spacing, and component patterns from the brief to all new UI components.

6. Update `client/src/components/AuthPage.tsx` — add OAuth buttons below the form:
   Add a divider + two buttons ("Sign in with Google", "Sign in with GitHub") that call `api.startOAuth("google")` and `api.startOAuth("github")`. Style per creative-brief.md. Also handle the `?error=cancelled` query param to show "Login cancelled — try again" if present in the URL (after OAuth redirect).

7. Create `client/src/components/PickUsernamePage.tsx`:
   Form with username input (and optional display name). Calls `api.setUsername()` on submit.
   On success: calls `onComplete(updatedUser)` where `updatedUser` is fetched via `api.me()` to refresh the user state.
   Shows validation errors (format, taken).
   Style per creative-brief.md.

8. Create `client/src/components/EmailGatePage.tsx`:
   Screen shown to users where `emailVerified: false`.
   Shows "Link Google" and "Link GitHub" buttons that call `api.startOAuth(provider)`.
   Shows which account is currently signed in (user.displayName).
   Explains why linking is required.
   Style per creative-brief.md.

9. Update `client/src/App.tsx` — extend state machine and handle OAuth redirect signals:
   The server `/api/auth/complete-oauth` redirects to `/?oauth=pick-username` or `/?oauth_error=cancelled` after OAuth completes. App.tsx reads these URL params and clears them:
   ```typescript
   useEffect(() => {
     const params = new URLSearchParams(window.location.search);
     const oauthError = params.get("oauth_error"); // "cancelled" if denied
     if (params.has("oauth") || params.has("oauth_error")) {
       window.history.replaceState({}, "", window.location.pathname);
     }
     // camel_session already minted by /api/auth/complete-oauth — just call me()
     api.me()
       .then(({ user }) => { setUser(user); if (oauthError) setOauthError(oauthError); })
       .catch(() => setUser(null))
       .finally(() => setAuthChecked(true));
   }, []);

   // State machine:
   if (!authChecked) return <LoadingScreen />;
   if (!user) return <AuthPage onAuth={setUser} oauthError={oauthError} />;
   if (user.needsUsername) return <PickUsernamePage onComplete={setUser} />;
   if (!user.emailVerified) return <EmailGatePage user={user} onComplete={setUser} />;
   return (
     <BoardProvider user={user} onSignedOut={() => setUser(null)}>
       <AuthenticatedApp />
     </BoardProvider>
   );
   ```
   This effect REPLACES the existing session-check `useEffect` in App.tsx (the one that
   already calls `api.me()` on mount) — do not add a second one, or `me()` fires twice.
   Declare `const [oauthError, setOauthError] = useState<string | null>(null);` alongside
   the existing `user`/`authChecked` state, and pass it to AuthPage to show
   "Login cancelled — try again" when `oauthError === "cancelled"`.

10. Update `client/src/pages/SettingsPage.tsx` — add set-password section:
    Show a "Set a recovery password" section when `user.emailVerified === true` AND password status is unknown (derive: show it if user has no password; backend returns 409 if already set).
    Form: password input (>= 8 chars). Calls `api.setPassword()`. Shows success/error.

11. Run tests — verify PASS:
    `npm run test --workspace=client`
    Expected: PASS

12. Run typecheck:
    `make typecheck`
    Expected: no unused imports, no TypeScript errors (noUnusedLocals + noUnusedParameters enforced)

13. Commit:
    `git add client/src/types.ts client/src/api.ts client/src/components/AuthPage.tsx client/src/components/AuthPage.test.tsx client/src/components/PickUsernamePage.tsx client/src/components/PickUsernamePage.test.tsx client/src/components/EmailGatePage.tsx client/src/components/EmailGatePage.test.tsx client/src/App.tsx client/src/pages/SettingsPage.tsx`
    `git commit -m "feat(client): add OAuth buttons, pick-username, email-gate, and set-password UI"`

## REFERENCES LOADED
`docs/pocket/spec/2026-06-21-better-auth-oauth-integration/oauth-integration.md` — Rules 1 (PickUsernamePage), 3 (EmailGatePage), 5 (set-password), 6 (failure handling)
`docs/pocket/rule/creative-brief.md` — design system authority: OKLCH colors, Work Sans, spacing, components
`client/src/components/AuthPage.tsx` — existing form patterns, Tailwind classes, inputClass style patterns
`client/src/App.tsx` — state machine pattern (user → AuthPage or AuthenticatedApp)
`client/src/api.ts` — request() wrapper pattern, existing api object
`client/src/types.ts` — User interface

## WHY THIS APPROACH
Justification: App.tsx state machine (null → AuthPage; needsUsername → PickUsernamePage; !emailVerified → EmailGatePage; else → board) avoids complex routing for pre-auth flows in a CSR SPA. OAuth buttons use `window.location.href` because OAuth flows require a full browser redirect (not fetch) — PKCE/state params are handled server-side. `needsUsername` derived from `username === null` on the User object.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Load docs/pocket/rule/creative-brief.md BEFORE designing any new component — all colors, typography, and spacing must follow the brief]
You are implementing Client Auth UI for Better Auth — Google + GitHub OAuth Integration.
Spec: docs/pocket/spec/2026-06-21-better-auth-oauth-integration/oauth-integration.md
Design decision: App.tsx state machine with two new pre-auth states; OAuth initiated via window.location (not fetch); no manual email entry anywhere.
Files in scope: client/src/types.ts, client/src/api.ts, client/src/components/AuthPage.tsx, client/src/components/PickUsernamePage.tsx, client/src/components/PickUsernamePage.test.tsx, client/src/components/EmailGatePage.tsx, client/src/components/EmailGatePage.test.tsx, client/src/components/AuthPage.test.tsx, client/src/App.tsx, client/src/pages/SettingsPage.tsx
Available after: T2 (Better Auth server routes mounted; /api/auth/me returns emailVerified + needsUsername via updated User type)
Architecture rule: No manual email entry form anywhere. No "unlink provider" button. noUnusedLocals enforced — remove any unused import immediately. Tests use `npm run test --workspace=client` (jsdom environment, NOT raw `npx vitest`).
[RESTATE: Load docs/pocket/rule/creative-brief.md BEFORE designing any new component]

## DELIVERABLE
Given new OAuth user (needsUsername: true), When App renders, Then PickUsernamePage shown (not board)
Given user with emailVerified: false, When App renders, Then EmailGatePage shown with "Link Google" and "Link GitHub" buttons
Given "Link Google" on EmailGatePage clicked, Then window.location navigates to URL containing `provider=google`
Given PickUsernamePage form submitted with "ana", When api.setUsername resolves ok, Then api.me() called and onComplete invoked
Given PickUsernamePage submitted with taken username, Then "Username already taken" error shown in form
Given user with emailVerified: true and non-null username, When App renders, Then board (AuthenticatedApp) shown
Given server redirects to `/?oauth_error=cancelled` (consent denied or provider error), When App detects param and user=null, Then AuthPage shown with "Login cancelled — try again" message; no account or session created

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Load creative-brief.md BEFORE any design work on new components
  - OAuth buttons use window.location.href (not fetch)
  - User type: username: string | null, emailVerified: boolean, needsUsername: boolean
  - App.tsx checks needsUsername AND emailVerified in the state machine
  - No manual email entry form anywhere
  - make typecheck passes (noUnusedLocals enforced — no stray imports)
  - Client tests run with `npm run test --workspace=client`

Must-not-have:
  - Manual email entry or email form fields
  - Unlink provider button
  - Storing OAuth tokens client-side
  - UI-only email gate check (server 403 is authoritative — UI shows EmailGatePage in response to it)

Open question risks:
  - `/api/auth/sign-in/social` exact URL and query params — verify against installed Better Auth once T2 is complete; update startOAuth URL if needed
  - `api.me()` must return `emailVerified` and `needsUsername` — if T2 does not expose these, derive: `needsUsername = user.username === null`
  - `/auth/complete` route: Better Auth redirects here after OAuth; App.tsx needs to detect this and call api.me() to refresh user state

Rollback note:
  - OAuth buttons can be conditionally hidden on the client if needed (OAUTH_ENABLED flag or server response indicates no OAuth configured)

## STOP CONDITIONS
Done when: All DELIVERABLE scenarios pass; client tests PASS; make typecheck PASS; OAuth buttons visible in AuthPage; PickUsernamePage and EmailGatePage render and behave correctly
Uncertain when: Better Auth /api/auth/sign-in/social URL differs from expected → update startOAuth and report
Escalate when: make typecheck fails (noUnusedLocals); creative-brief.md is missing

---

### Integration Task IT-1: complete-oauth Bridge End-to-End [depends: T2]

## OBJECTIVE

Verify that `GET /api/auth/complete-oauth` correctly mints a `camel_session` for a BA-authenticated
user (Rule 2 email-match path) AND that a link-collision (Rule 4) ends the old session, inserts
an audit event, and redirects as B.

Files:
- Create: `server/src/__tests__/oauth-bridge.integration.test.ts`

Steps:
1. Write integration tests (gated behind `RUN_OAUTH_IT=1`):
   ```typescript
   import "dotenv/config";
   import {
   	afterAll,
   	afterEach,
   	beforeAll,
   	describe,
   	expect,
   	it,
   	vi,
   } from "vitest";

   const shouldRun = !!process.env.RUN_OAUTH_IT;

   // Lazy imports — avoid config.ts process.exit(1) when env vars missing.
   let pool: typeof import("../db/pool")["pool"];
   let createOAuthBridgeRouter: typeof import("../oauth-bridge")["createOAuthBridgeRouter"];
   let auth: typeof import("../oauth-bridge")["auth"];

   if (shouldRun) {
   	const poolMod = await import("../db/pool.js");
   	pool = poolMod.pool;
   	const bridgeMod = await import("../oauth-bridge.js");
   	createOAuthBridgeRouter = bridgeMod.createOAuthBridgeRouter;
   	auth = bridgeMod.auth;
   }

   import express from "express";
   import cookieParser from "cookie-parser";
   import request from "supertest";

   // Seed helper IDs — use high values to avoid fixture collisions.
   const USER_B_ID = 9900;
   const USER_A_ID = 9901;

   describe.skipIf(!shouldRun)("complete-oauth bridge (integration)", () => {
   	let app: express.Application;

   	beforeAll(async () => {
   		// Clean up any leftover fixture rows.
   		await pool.query("DELETE FROM sessions WHERE user_id IN ($1, $2)", [USER_B_ID, USER_A_ID]);
   		await pool.query("DELETE FROM auth_audit WHERE actor_id IN ($1, $2)", [USER_B_ID, USER_A_ID]);
   		await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [USER_B_ID, USER_A_ID]);

   		// Insert fixture users.
   		await pool.query(
   			`INSERT INTO users (id, username, display_name, email, email_verified)
   			 VALUES ($1, $2, $3, $4, $5)`,
   			[USER_B_ID, "budi", "Budi", "budi@gmail.com", true],
   		);
   		await pool.query(
   			`INSERT INTO users (id, username, display_name, email, email_verified)
   			 VALUES ($1, $2, $3, $4, $5)`,
   			[USER_A_ID, null, "Account A", null, false],
   		);

   		// Spy on auth.api.getSession — do NOT call real Better Auth in integration tests.
   		// The complete-oauth handler uses auth.api.getSession to read the BA session.
   		app = express();
   		app.use(cookieParser());
   		app.use(express.json());
   		app.use("/api/auth", createOAuthBridgeRouter());
   	});

   	afterAll(async () => {
   		await pool.query("DELETE FROM sessions WHERE user_id IN ($1, $2)", [USER_B_ID, USER_A_ID]);
   		await pool.query("DELETE FROM auth_audit WHERE actor_id IN ($1, $2)", [USER_B_ID, USER_A_ID]);
   		await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [USER_B_ID, USER_A_ID]);
   	});

   	afterEach(async () => {
   		await pool.query("DELETE FROM sessions WHERE user_id IN ($1, $2)", [USER_B_ID, USER_A_ID]);
   		await pool.query("DELETE FROM auth_audit WHERE actor_id IN ($1, $2)", [USER_B_ID, USER_A_ID]);
   		vi.restoreAllMocks();
   	});

   	it("Rule 2: mints camel_session and redirects to / for a user with existing username", async () => {
   		// Mock BA session to return user B (has username "budi").
   		vi.spyOn(auth.api, "getSession").mockResolvedValue({
   			user: { id: String(USER_B_ID) },
   			session: {},
   		} as any);

   		const res = await request(app).get("/api/auth/complete-oauth");

   		expect(res.status).toBe(302);
   		expect(res.headers.location).toBe("/");
   		// camel_session cookie should be set.
   		expect(res.headers["set-cookie"]).toBeDefined();
   		// Session row inserted in DB.
   		const { rows } = await pool.query(
   			"SELECT 1 FROM sessions WHERE user_id = $1 AND expires_at > now()",
   			[USER_B_ID],
   		);
   		expect(rows).toHaveLength(1);
   	});

   	it("Rule 1: redirects to /?oauth=pick-username for new user with null username", async () => {
   		vi.spyOn(auth.api, "getSession").mockResolvedValue({
   			user: { id: String(USER_A_ID) },
   			session: {},
   		} as any);

   		const res = await request(app).get("/api/auth/complete-oauth");

   		expect(res.status).toBe(302);
   		expect(res.headers.location).toBe("/?oauth=pick-username");
   	});

   	it("Rule 4: collision — deletes A's session, records orphan event, mints session for B", async () => {
   		// Give A an existing camel_session.
   		const oldToken = "old-session-token-for-a";
   		await pool.query(
   			"INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')",
   			[oldToken, USER_A_ID],
   		);

   		// OAuth returns B's identity (A is linking B's email).
   		vi.spyOn(auth.api, "getSession").mockResolvedValue({
   			user: { id: String(USER_B_ID) },
   			session: {},
   		} as any);

   		const res = await request(app)
   			.get("/api/auth/complete-oauth")
   			.set("Cookie", `camel_session=${oldToken}`);

   		expect(res.status).toBe(302);
   		expect(res.headers.location).toBe("/");

   		// A's old session must be deleted.
   		const { rows: oldSessions } = await pool.query(
   			"SELECT 1 FROM sessions WHERE token = $1",
   			[oldToken],
   		);
   		expect(oldSessions).toHaveLength(0);

   		// Orphan event persisted to auth_audit.
   		const { rows: events } = await pool.query(
   			"SELECT payload FROM auth_audit WHERE actor_id = $1 AND event_type = 'account_orphaned'",
   			[USER_A_ID],
   		);
   		expect(events).toHaveLength(1);
   		expect(events[0].payload.orphanedUserId).toBe(USER_A_ID);
   		expect(events[0].payload.linkedToUserId).toBe(USER_B_ID);

   		// B's fresh session minted.
   		const { rows: bSessions } = await pool.query(
   			"SELECT 1 FROM sessions WHERE user_id = $1 AND expires_at > now()",
   			[USER_B_ID],
   		);
   		expect(bSessions).toHaveLength(1);
   	});

   	it("redirects to /?oauth_error=cancelled when no BA session exists", async () => {
   		vi.spyOn(auth.api, "getSession").mockResolvedValue(null as any);

   		const res = await request(app).get("/api/auth/complete-oauth");

   		expect(res.status).toBe(302);
   		expect(res.headers.location).toBe("/?oauth_error=cancelled");
   	});
   });
   ```

2. Run:
   `RUN_OAUTH_IT=1 npx vitest run server/src/__tests__/oauth-bridge.integration.test.ts`
   (Requires running PostgreSQL with schema migrated. Skipped in default `npm test` pass.)

## DELIVERABLE
IT-1 passes when RUN_OAUTH_IT=1; skipped (not failed) in the default test pass.

---

### Integration Task IT-2: Email Gate End-to-End [depends: T3]

## OBJECTIVE

Verify the email gate (`requireEmailVerified`) integrated with `requireAuth` on a real board API
route: email NULL → 403 `{needsEmailVerification:true}`; email_verified=true → request passes.

Files:
- Create: `server/src/middleware/__tests__/email-gate.integration.test.ts`

Steps:
1. Write integration tests (gated behind `RUN_OAUTH_IT=1`):
   ```typescript
   import "dotenv/config";
   import { afterAll, beforeAll, describe, expect, it } from "vitest";

   const shouldRun = !!process.env.RUN_OAUTH_IT;

   let pool: typeof import("../../db/pool")["pool"];

   if (shouldRun) {
   	const poolMod = await import("../../db/pool.js");
   	pool = poolMod.pool;
   }

   import express from "express";
   import cookieParser from "cookie-parser";
   import request from "supertest";

   const GATED_USER_ID = 9910;
   const VERIFIED_USER_ID = 9911;

   describe.skipIf(!shouldRun)("Email gate — board API route (integration)", () => {
   	let app: express.Application;
   	let gatedToken: string;
   	let verifiedToken: string;

   	beforeAll(async () => {
   		await pool.query("DELETE FROM sessions WHERE user_id IN ($1, $2)", [GATED_USER_ID, VERIFIED_USER_ID]);
   		await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [GATED_USER_ID, VERIFIED_USER_ID]);

   		// Gated user: email NULL → email_verified = false (default).
   		await pool.query(
   			`INSERT INTO users (id, username, display_name, email_verified)
   			 VALUES ($1, $2, $3, false)`,
   			[GATED_USER_ID, "gateduser", "Gated User"],
   		);
   		// Verified user: email_verified = true.
   		await pool.query(
   			`INSERT INTO users (id, username, display_name, email, email_verified)
   			 VALUES ($1, $2, $3, $4, true)`,
   			[VERIFIED_USER_ID, "verifieduser", "Verified User", "v@example.com"],
   		);

   		// Seed sessions.
   		gatedToken = "gate-test-token-gated";
   		verifiedToken = "gate-test-token-verified";
   		const exp = new Date(Date.now() + 86400_000);
   		await pool.query(
   			"INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)",
   			[gatedToken, GATED_USER_ID, exp],
   		);
   		await pool.query(
   			"INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)",
   			[verifiedToken, VERIFIED_USER_ID, exp],
   		);

   		// Minimal app replicating the route mount from routes.ts.
   		const { requireAuth } = await import("../../auth.js");
   		const { requireEmailVerified } = await import("../email-gate.js");
   		const api = express.Router();
   		api.use(requireAuth);
   		api.use(requireEmailVerified);
   		api.get("/workspaces", (_req, res) => res.json({ workspaces: [] }));

   		app = express();
   		app.use(cookieParser());
   		app.use("/api", api);
   	});

   	afterAll(async () => {
   		await pool.query("DELETE FROM sessions WHERE user_id IN ($1, $2)", [GATED_USER_ID, VERIFIED_USER_ID]);
   		await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [GATED_USER_ID, VERIFIED_USER_ID]);
   	});

   	it("blocks email-less user with 403 {needsEmailVerification: true}", async () => {
   		const res = await request(app)
   			.get("/api/workspaces")
   			.set("Cookie", `camel_session=${gatedToken}`);

   		expect(res.status).toBe(403);
   		expect(res.body).toEqual({ needsEmailVerification: true });
   	});

   	it("allows verified user through to the route handler", async () => {
   		const res = await request(app)
   			.get("/api/workspaces")
   			.set("Cookie", `camel_session=${verifiedToken}`);

   		expect(res.status).toBe(200);
   		expect(res.body).toHaveProperty("workspaces");
   	});

   	it("unauthenticated request returns 401 from requireAuth (not 403 from gate)", async () => {
   		const res = await request(app).get("/api/workspaces");
   		expect(res.status).toBe(401);
   		expect(res.body).toEqual({ error: "authentication required" });
   	});
   });
   ```

2. Run:
   `RUN_OAUTH_IT=1 npx vitest run server/src/middleware/__tests__/email-gate.integration.test.ts`

## DELIVERABLE
IT-2 passes when RUN_OAUTH_IT=1; skipped in the default test pass.

---

### Integration Task IT-3: set-username Provisioning + set-password → Login [depends: T4]

## OBJECTIVE

Verify the full set-username workspace-provisioning transaction (Rule 1) and the set-password →
login round-trip (Rule 5), plus the UNIQUE(username) concurrent-race behaviour, against a real DB.

Files:
- Create: `server/src/routes/__tests__/oauth.integration.test.ts`

Steps:
1. Write integration tests (gated behind `RUN_OAUTH_IT=1`):
   ```typescript
   import "dotenv/config";
   import {
   	afterAll,
   	afterEach,
   	beforeAll,
   	describe,
   	expect,
   	it,
   	vi,
   } from "vitest";

   const shouldRun = !!process.env.RUN_OAUTH_IT;

   let pool: typeof import("../../db/pool")["pool"];

   if (shouldRun) {
   	const poolMod = await import("../../db/pool.js");
   	pool = poolMod.pool;
   }

   import express from "express";
   import cookieParser from "cookie-parser";
   import request from "supertest";

   const OAUTH_USER_ID = 9920;

   describe.skipIf(!shouldRun)("OAuth routes — set-username & set-password (integration)", () => {
   	let app: express.Application;
   	let sessionToken: string;

   	beforeAll(async () => {
   		await pool.query("DELETE FROM workspace_members WHERE user_id = $1", [OAUTH_USER_ID]);
   		await pool.query("DELETE FROM workspaces WHERE owner_user_id = $1", [OAUTH_USER_ID]);
   		await pool.query("DELETE FROM sessions WHERE user_id = $1", [OAUTH_USER_ID]);
   		await pool.query("DELETE FROM users WHERE id = $1", [OAUTH_USER_ID]);

   		// OAuth user: username NULL, no password.
   		await pool.query(
   			`INSERT INTO users (id, username, display_name, email, email_verified)
   			 VALUES ($1, $2, $3, $4, true)`,
   			[OAUTH_USER_ID, null, "OAuth User", "oauthuser@example.com"],
   		);
   		sessionToken = "oauth-it-session-token";
   		const exp = new Date(Date.now() + 86400_000);
   		await pool.query(
   			"INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)",
   			[sessionToken, OAUTH_USER_ID, exp],
   		);

   		const { oauthRouter } = await import("../oauth.js");
   		app = express();
   		app.use(express.json());
   		app.use(cookieParser());
   		app.use("/api/auth", oauthRouter);
   	});

   	afterAll(async () => {
   		await pool.query("DELETE FROM workspace_members WHERE user_id = $1", [OAUTH_USER_ID]);
   		await pool.query("DELETE FROM workspaces WHERE owner_user_id = $1", [OAUTH_USER_ID]);
   		await pool.query("DELETE FROM sessions WHERE user_id = $1", [OAUTH_USER_ID]);
   		await pool.query("DELETE FROM users WHERE id = $1", [OAUTH_USER_ID]);
   	});

   	afterEach(async () => {
   		// Reset username to null between tests.
   		await pool.query("UPDATE users SET username = null, password_hash = null WHERE id = $1", [OAUTH_USER_ID]);
   		await pool.query("DELETE FROM workspace_members WHERE user_id = $1", [OAUTH_USER_ID]);
   		await pool.query("DELETE FROM workspaces WHERE owner_user_id = $1", [OAUTH_USER_ID]);
   	});

   	it("Rule 1: set-username sets username in DB and creates a personal workspace", async () => {
   		const res = await request(app)
   			.post("/api/auth/set-username")
   			.set("Cookie", `camel_session=${sessionToken}`)
   			.send({ username: "oauthana" });

   		expect(res.status).toBe(200);
   		expect(res.body).toEqual({ ok: true });

   		const { rows: users } = await pool.query(
   			"SELECT username FROM users WHERE id = $1",
   			[OAUTH_USER_ID],
   		);
   		expect(users[0].username).toBe("oauthana");

   		const { rows: workspaces } = await pool.query(
   			"SELECT is_personal FROM workspaces WHERE owner_user_id = $1",
   			[OAUTH_USER_ID],
   		);
   		expect(workspaces).toHaveLength(1);
   		expect(workspaces[0].is_personal).toBe(true);
   	});

   	it("Rule 1: consumes a pending invite — grants membership and deletes the invite", async () => {
   		const INVITER_ID = 9921;
   		// Inviter owns a workspace and has invited username "oauthana" as member.
   		await pool.query("DELETE FROM users WHERE id = $1", [INVITER_ID]);
   		await pool.query(
   			`INSERT INTO users (id, username, display_name, password_hash)
   			 VALUES ($1, 'inviter', 'Inviter', 'hashed')`,
   			[INVITER_ID],
   		);
   		const { rows: ws } = await pool.query(
   			`INSERT INTO workspaces (name, owner_user_id, is_personal)
   			 VALUES ('Shared', $1, false) RETURNING id`,
   			[INVITER_ID],
   		);
   		const sharedWsId = ws[0].id;
   		await pool.query(
   			`INSERT INTO workspace_invites (workspace_id, username, role, invited_by)
   			 VALUES ($1, 'oauthana', 'member', $2)`,
   			[sharedWsId, INVITER_ID],
   		);

   		const res = await request(app)
   			.post("/api/auth/set-username")
   			.set("Cookie", `camel_session=${sessionToken}`)
   			.send({ username: "oauthana" });
   		expect(res.status).toBe(200);

   		// Membership granted in the invited workspace with the invited role.
   		const { rows: members } = await pool.query(
   			"SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
   			[sharedWsId, OAUTH_USER_ID],
   		);
   		expect(members).toHaveLength(1);
   		expect(members[0].role).toBe("member");

   		// Invite consumed (deleted).
   		const { rows: invites } = await pool.query(
   			"SELECT 1 FROM workspace_invites WHERE workspace_id = $1 AND username = 'oauthana'",
   			[sharedWsId],
   		);
   		expect(invites).toHaveLength(0);

   		// Cleanup inviter fixtures (afterEach only clears the OAuth user's own rows).
   		await pool.query("DELETE FROM workspace_members WHERE workspace_id = $1", [sharedWsId]);
   		await pool.query("DELETE FROM workspace_invites WHERE workspace_id = $1", [sharedWsId]);
   		await pool.query("DELETE FROM workspaces WHERE id = $1", [sharedWsId]);
   		await pool.query("DELETE FROM users WHERE id = $1", [INVITER_ID]);
   	});

   	it("Rule 1: 409 when the username is already taken by another user", async () => {
   		// Create a conflicting user.
   		await pool.query(
   			`INSERT INTO users (username, display_name, password_hash)
   			 VALUES ('taken_oauth_name', 'Other', 'hashed') ON CONFLICT DO NOTHING`,
   		);

   		const res = await request(app)
   			.post("/api/auth/set-username")
   			.set("Cookie", `camel_session=${sessionToken}`)
   			.send({ username: "taken_oauth_name" });

   		expect(res.status).toBe(409);
   		expect(res.body.error).toMatch(/username already taken/i);

   		await pool.query("DELETE FROM users WHERE username = 'taken_oauth_name'");
   	});

   	it("Rule 5: set-password stores a bcrypt hash and allows subsequent login", async () => {
   		// First set a username so the user is valid.
   		await pool.query("UPDATE users SET username = 'oauthpwuser' WHERE id = $1", [OAUTH_USER_ID]);

   		const setRes = await request(app)
   			.post("/api/auth/set-password")
   			.set("Cookie", `camel_session=${sessionToken}`)
   			.send({ password: "strongPass1" });

   		expect(setRes.status).toBe(200);

   		const { rows } = await pool.query(
   			"SELECT password_hash FROM users WHERE id = $1",
   			[OAUTH_USER_ID],
   		);
   		expect(rows[0].password_hash).toBeTruthy();
   		expect(rows[0].password_hash).not.toBe("strongPass1"); // must be hashed

   		// Verify bcrypt: import bcryptjs and compare.
   		const bcrypt = (await import("bcryptjs")).default;
   		const valid = await bcrypt.compare("strongPass1", rows[0].password_hash);
   		expect(valid).toBe(true);
   	});
   });
   ```

2. Run:
   `RUN_OAUTH_IT=1 npx vitest run server/src/routes/__tests__/oauth.integration.test.ts`

## DELIVERABLE
IT-3 passes when RUN_OAUTH_IT=1; skipped in the default test pass.

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | DB Schema Migration | prereq | lightweight | make db-migrate runs twice without error; users.email exists; ba_* tables exist |
| T2 | Better Auth OAuth Bridge | T1 | standard | OAuth creates integer user row (spike); auth.test.ts PASS; oauth-bridge.test.ts PASS |
| T3 | Email Gate Middleware | T2 | lightweight | email NULL → 403 `{ needsEmailVerification: true }`; email_verified=true → passes |
| T4 | OAuth Routes — Set-Username + Set-Password | T2 | standard | username set + workspace provisioned; password bcrypt-hashed when NULL |
| T5 | Client Auth UI | T2 | standard | OAuth buttons shown; PickUsernamePage + EmailGatePage work; typecheck passes |
| IT-1 | complete-oauth Bridge E2E | T2 | integration | Rule 2 email-match mint; Rule 4 collision + orphan event; cancelled redirect |
| IT-2 | Email Gate E2E | T3 | integration | gated user → 403; verified user → 200; unauthenticated → 401 |
| IT-3 | set-username Provisioning + set-password Login | T4 | integration | workspace created; bcrypt hash stored; username unique enforced |

Integration tests run with: `RUN_OAUTH_IT=1 npm run test --workspace=server`
(Requires running PostgreSQL with schema migrated via `make db-migrate`)

Note: document the new `RUN_OAUTH_IT` env flag in CLAUDE.md (alongside the existing
`RUN_LLM_IT`) so the OAuth integration suite isn't lost — it follows the same opt-in,
DB-required convention.
