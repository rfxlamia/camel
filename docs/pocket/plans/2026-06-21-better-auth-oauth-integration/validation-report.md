# Plan Validation Report: Better Auth — Google + GitHub OAuth Integration

**Plan:** `docs/pocket/plans/2026-06-21-better-auth-oauth-integration/execution-plan.md`
**Validated:** 2026-06-21
**Method:** DRY / YAGNI / TDD review + codebase-aware gap analysis (verified against actual `auth.ts`, `index.ts`, `routes.ts`, `config.ts`, `schema.sql`, `invites.ts`, `App.tsx`, `types.ts`).

## Resolution — pass 2, spec-aligned (2026-06-21)

After reading the spec (`oauth-integration.md`), the first-pass fixes for C1–C3 were found to
CONTRADICT the spec and were corrected. The spec mandates that email-less accounts —
including existing password users — are gated (Scope + Rule 3), wants the orphan event
persisted to an audit log (Rule 4), and wants invites consumed at signup (Rule 1).

- **C1 (corrected):** NO `email_verified` backfill — existing password users keep
  `email_verified=false` and ARE gated, by design. The gate is mounted behind its OWN
  dedicated flag `EMAIL_GATE_ENABLED` (spec Rollback Plan), independent of `OAUTH_ENABLED`,
  defaulting off. The earlier backfill (which defeated the anti-dummy gate) was removed.
- **C2 (corrected):** the `card_events` INSERT was a real crash (workspace_id NOT NULL), but
  `console.warn` under-delivered vs spec. Now a dedicated `auth_audit` table (added in T1)
  persists the orphan event; IT-1 asserts the `auth_audit` row.
- **C3 (corrected):** set-username now CONSUMES invites per spec Rule 1 — for each invite,
  INSERT `workspace_members` then DELETE the invite (membership always before deletion),
  mirroring the accept endpoint. New IT-3 test verifies it. Flagged: `register` currently
  does not consume invites inline (pre-existing discrepancy) — for the spec author to align.
- **C4 (unchanged):** CSRF exemption narrowed to login/register + Better Auth sign-in/callback
  only. This was already spec-aligned ("exempt Better Auth routes" + "preserve CSRF").

Warnings/info (W1–W5, I1–I3) from pass 1 stand and are unaffected: `fromNodeHeaders`;
shared `provisionPersonalWorkspace` helper; deduped `USERNAME_RE`/`BCRYPT_ROUNDS`;
`display_name` spike; App.tsx effect; `randomUUID`; NULL-username note; `RUN_OAUTH_IT` doc.

### Pass 1 (superseded — kept for history)
The first attempt "fixed" C1 by backfilling email_verified and tying the gate to
OAUTH_ENABLED, C2 by logging instead of persisting, and C3 by dropping invite handling
entirely. All three fought the spec rather than the plan's actual defects and were reverted
above.

The findings below are retained as the original assessment.

---

## Executive Summary

- **Critical issues:** 4 (blockers — will break existing users, crash at runtime, or destroy data)
- **Warnings:** 5 (should fix before execution)
- **Info:** 3 (nice to have)
- **Overall grade: C+** — excellent TDD discipline and good reuse of `createSignupWorkspacePlan`, but several assumptions about the existing schema and middleware are wrong in ways that cause real damage.

---

## 🚨 CRITICAL

### C1 — The email gate (T3) locks out every existing password user, with no recovery path

`routes.ts` mounts `api.use(requireAuth)` for the whole board API. T3 adds `api.use(requireEmailVerified)` **unconditionally** (not behind `OAUTH_ENABLED`). Every existing user in `users` has `password_hash` set but **no email**; T1 adds `email_verified BOOLEAN NOT NULL DEFAULT false`. So after T3, *all* current users get `403 {needsEmailVerification:true}` on every board route and are forced into `EmailGatePage`.

If `OAUTH_ENABLED=false` (the default per T2/config), the EmailGatePage's "Link Google/GitHub" buttons hit an unmounted handler → existing users are **permanently locked out of their own boards**.

The plan's own DELIVERABLE confirms this is the gate's behavior ("email NULL → 403") but never addresses the existing-user population or the gate/flag interaction.

**Fix options (pick one and make it explicit in T3):**
- Gate only when `config.OAUTH_ENABLED === "true"`, AND backfill existing rows (`UPDATE users SET email_verified = true WHERE password_hash IS NOT NULL` in T1), treating an existing password as sufficient verification; or
- Make the gate apply only to OAuth-origin accounts (e.g. users with `password_hash IS NULL`), not to legacy password users.

This decision belongs in the spec, not improvised at execution time.

### C2 — The link-collision audit INSERT will throw at runtime (T2 / IT-1)

The `complete-oauth` handler inserts the orphan event as:

```sql
INSERT INTO card_events (actor_id, event_type, payload, created_at) VALUES ($1, 'account_orphaned', $2, now())
```

But `card_events.workspace_id` is set **NOT NULL** by `schema.sql` (lines 191–193) on any migrated DB. The INSERT omits `workspace_id` → `null value in column "workspace_id" violates not-null constraint`. The Rule 4 path crashes, and **IT-1's collision test cannot pass**.

Separately, this is a domain mismatch: `card_events` is the card activity log (FK to `cards`, scoped to a workspace). Reusing it for an account-level auth event is a schema abuse even if you satisfy the NOT NULL.

**Fix:** Don't log auth events into `card_events`. Either `console.warn`/structured-log the collision, or add a dedicated `auth_events` table in T1. If you must use `card_events`, the plan has to supply a `workspace_id` — which doesn't exist for an account-level event.

### C3 — set-username destroys pending invites without granting membership (T4)

The set-username route runs `DELETE FROM workspace_invites WHERE username = $1` after provisioning. But it never inserts the corresponding `workspace_members` rows for those invited workspaces. The established flow (`invites.ts → POST /invites/:inviteId/accept`) is an explicit, user-initiated accept that inserts the membership *and then* deletes the invite, transactionally. The `register` route (the pattern this is meant to mirror) **does not touch `workspace_invites` at all** — it leaves them for the user to accept later.

So T4 silently deletes a new OAuth user's invitations, dropping them from every workspace they were invited to. The happy-path test only covers the zero-invite case, so this is also untested.

**Fix:** Remove the invite `SELECT`/`DELETE` from set-username entirely. Mirror `register` exactly: create the personal workspace + owner membership, leave invites intact for the existing accept endpoint.

### C4 — Widening the CSRF exemption to all of `/api/auth/` exposes set-username & set-password (T2)

T2 changes the exempt list from `["/api/auth/login","/api/auth/register"]` to `if (req.path.startsWith("/api/auth/")) return next();`. That blanket prefix also exempts the **authenticated, state-changing** POST routes added in T4 (`/api/auth/set-username`, `/api/auth/set-password`) and `/api/auth/logout` from CSRF. The justification ("Better Auth handles its own CSRF via OAuth state") is only true for Better Auth's *own* routes — not for the custom `oauthRouter` endpoints mounted on the same prefix.

**Fix:** Exempt only Better Auth's own sub-paths (e.g. `/api/auth/sign-in/`, `/api/auth/callback/`) plus the existing login/register. Keep CSRF on set-username/set-password/logout (the client already fetches a CSRF token).

---

## ⚡ WARNINGS

### W1 — `auth.api.getSession({ headers: req.headers as Headers })` is a type lie likely to fail at runtime (T2)
Express `req.headers` is a plain `IncomingHttpHeaders` object, not a Web `Headers` instance. Better Auth expects a fetch `Headers`. The `as Headers` cast hides this. Use Better Auth's `fromNodeHeaders(req.headers)` helper. Flag this for the T2 spike rather than discovering it during IT-1.

### W2 — Workspace-provisioning transaction is duplicated between `register` and set-username (DRY)
After T4, `auth.ts` register (lines 374–433) and `oauth.ts` set-username contain near-identical BEGIN → UPDATE/INSERT users → INSERT workspace → INSERT members → COMMIT blocks. Extract a shared `provisionPersonalWorkspace(client, user)` helper in `auth.ts` and call it from both. The plan claims DRY via `createSignupWorkspacePlan`, but that only covers the plan object, not the ~30-line transaction.

### W3 — `USERNAME_RE` and `BCRYPT_ROUNDS` re-declared in `oauth.ts` (DRY)
Both already exist in `auth.ts` (just not exported). Export and import them instead of redefining, so the username regex and cost factor stay single-sourced.

### W4 — `display_name` is NOT NULL but new OAuth users may arrive without a name (T2)
Better Auth maps `name → display_name`; `users.display_name` is `NOT NULL`. If a provider profile lacks `name`, the BA user insert fails. The T2 spike should confirm BA always supplies a non-null name (or add a DB default / fallback in the field mapping).

### W5 — App.tsx OAuth-redirect `useEffect` calls `api.me()` unconditionally and may double-handle (T5)
The proposed effect reads `oauth`/`oauth_error` params, replaces history, then always calls `api.me()`. This is mostly compatible with the real `App.tsx` (which is `user → AuthPage; else BoardProvider → AuthenticatedApp`), but the plan should confirm the replaceState happens *before* `me()` resolves and that `oauthError` state is declared. Minor, but call it out so the executor doesn't drop the existing session-check behavior.

---

## ✨ INFO

- **I1 — `crypto.randomUUID()` vs imported `randomBytes` (T2):** the bridge uses the global `crypto` for IDs but imports `randomBytes` from `node:crypto` elsewhere. Works on Node 18+, but pick one for consistency.
- **I2 — Multiple NULL usernames under the existing `UNIQUE(username)`:** correct (Postgres treats NULLs as distinct), but worth a one-line note in T1 so a reviewer doesn't "fix" the UNIQUE constraint.
- **I3 — Integration tests gated behind `RUN_OAUTH_IT=1`:** the repo's existing convention is `RUN_LLM_IT=1` (see CLAUDE.md). Consider documenting the new `RUN_OAUTH_IT` flag in CLAUDE.md / Makefile so it isn't lost.

---

## What the plan gets right

- **TDD: A.** Every task writes failing tests first, runs them to confirm the expected failure, implements, then confirms pass. Mocks are hoisted correctly (`vi.hoisted`, module mocks before import). Three integration tasks (IT-1..3) cover the cross-unit flows. The Test-Architect summary is accurate.
- **Reuse of `createSignupWorkspacePlan` and `PendingInvite`** — both are genuinely exported from `auth.ts`; the dependency is real.
- **Idempotent, additive schema** (T1) follows the existing `IF NOT EXISTS` / additive-`ALTER` pattern and correctly uses a partial unique index for nullable email.
- **Spike steps** (integer SERIAL id, route passthrough) are the right risks to de-risk first.

---

## Codebase Context (verified)

- `auth.ts`: `createSession` is private (T2's rename→export is valid); `SESSION_COOKIE` is private (T2's export is valid); `AuthUser` is `{id,username:string,displayName}`; `requireAuth` selects `id,username,display_name` only.
- `index.ts`: `express.json()` at line 28, CSRF exempt list at lines 49–50, `createAuthRouter` mounted line 80.
- `schema.sql`: `users` has `username NOT NULL UNIQUE`, `password_hash NOT NULL`, no email; `card_events.workspace_id` enforced NOT NULL (lines 191–193); `card_events.card_id`/`to_column_id` already nullable.
- `invites.ts`: invites are consumed only via explicit `POST /invites/:inviteId/accept` (membership insert + invite delete, transactional).
- `App.tsx`: real structure is `user ? BoardProvider→AuthenticatedApp : AuthPage` — compatible with T5's state machine.
