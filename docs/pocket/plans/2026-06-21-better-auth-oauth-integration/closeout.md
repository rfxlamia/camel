# Closeout — 2026-06-21-better-auth-oauth-integration

- **Plan:** docs/pocket/plans/2026-06-21-better-auth-oauth-integration
- **Type:** flat
- **Started:** 2026-06-21  ·  **Closed:** 2026-06-21
- **Baseline SHA:** 915dee85  ·  **Final SHA:** d78c1b0 (T5 correction)
- **Result:** CLOSED — all phases DONE, all reviewable tasks REVIEW_PASS

## Phases

### Phase 1 — execution-plan.md  (DONE)

| Task | Name | done_sha | Verdict |
|------|------|----------|---------|
| T1 | DB Schema Migration | 441195f3 | REVIEW_PASS |
| T2 | Better Auth OAuth Bridge | 474d73e8 | REVIEW_PASS |
| T3 | Email Gate Middleware | 20402d6f | REVIEW_PASS |
| T4 | OAuth Routes — Set-Username & Set-Password | e2366431 | REVIEW_PASS |
| T5 | Client Auth UI — OAuth Buttons, PickUsername & EmailGate Screens | 81d82fc0 (corrected by d78c1b0) | REVIEW_PASS |

_SHA range: 915dee85..d78c1b0_

_Correction: d78c1b0 (for_task T5) — "fix: set oauthError before api.me() so cancelled prop reaches AuthPage on 401". First-pass review found the oauth_error=cancelled message failed to render on the 401 path at done_sha 81d82fc0; the correction resolves it. Review covers the union range; reviewed_sha = d78c1b0._

## Carried Forward

Non-blocking observations from review — accepted at close, recorded for follow-up.

- **T2** (Important — security hardening): `BETTER_AUTH_SECRET` falls back to hardcoded default `dev-secret-change-in-production` with no production guard, unlike `CSRF_SECRET` which throws when unset in `NODE_ENV=production`. Plan-mandated value (spec-compliant), but a predictable signing secret in prod enables forgeable sessions/OAuth state. Recommend a production guard — server/src/config.ts:36.
- **T2** (Minor): `getGitHubPrimaryEmail` is exported and unit-tested but never wired into the production path; the live no-verified-email abort is enforced by `mapProfileToUser` + Better Auth's internal /user/emails fetch. Latent risk if Better Auth does not merge the primary verified email — covered by mandated spike + IT-1 — server/src/oauth-bridge.ts:9-14.
- **T2** (Minor): Biome organizeImports — imports not sorted in oauth-bridge.ts (new). Auto-fixable via `npm run lint:fix`.
- **T3** (Minor): Email gate applied only to the board `api` Router; `createAgentRouter()` mounted separately on /api is not behind the gate. Consistent with the plan's scope (board routes), noted as a separate surface — server/src/index.ts:96.
- **T4** (Minor): Import names from `../auth.js` not alphabetically sorted (Biome organizeImports assist). `biome lint` passes clean; auto-fixable — server/src/routes/oauth.ts:3-9.
- **T4** (Minor): Plan's DRY note suggested extracting a shared `provisionPersonalWorkspace(client, user)` helper; the BEGIN→INSERT workspace→INSERT members→COMMIT transaction remains duplicated between `register` and `set-username`. Explicit must-have (`createSignupWorkspacePlan` reused) is satisfied; minor maintainability follow-up — server/src/routes/oauth.ts:36-92.
- **T5** (Minor): Dead mock — `vi.mock("../api")` resolves to `client/api` (nonexistent) while App.tsx imports `./api` (client/src/api). Mock never intercepts; test passes coincidentally because the real `api.me()` rejects in jsdom — client/src/App.test.tsx:14-29.
- **T5** (Minor): "Login cancelled" renders on any truthy `oauthError` rather than strictly `oauthError === "cancelled"`. Behavior equivalent (server only emits `cancelled`) but looser than specified — client/src/components/AuthPage.tsx:163.
- **T5** (Minor): Inconsistent error-text color — AuthPage/PickUsernamePage use `text-error-900`; SettingsPage uses `text-error-600` (creative-brief specifies error-600). Cosmetic — client/src/components/AuthPage.tsx:164, PickUsernamePage.tsx:80.
- **T5** (Minor): `EmailGatePage` Props declares `onComplete` but never uses it (relies on full OAuth redirect). Intentional symmetry with PickUsernamePage; harmless — client/src/components/EmailGatePage.tsx:5-8.

### Deferred verification (manual / opt-in — not gated by this close)

- **T1** idempotency: run `make db-migrate` twice; confirm no error and existing `users.email_verified` stays false (no backfill).
- **T2** spikes: integer `users.id` after OAuth sign-in; `toNodeHandler` route passthrough (existing /api/auth/login still 200/401, not 404); `display_name` non-null after sign-in.
- **IT-1 / IT-2 / IT-3**: integration suites gated behind `RUN_OAUTH_IT=1` (need running PostgreSQL with migrated schema). Document `RUN_OAUTH_IT` in CLAUDE.md alongside `RUN_LLM_IT`.

## Skipped Tasks

_None_ — all 5 tasks were DONE with non-empty SHA ranges and reviewed.
