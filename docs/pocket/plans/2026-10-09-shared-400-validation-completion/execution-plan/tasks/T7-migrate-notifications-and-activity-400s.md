# Task T7 — Migrate notifications and activity 400s

**Phase:** 2
**Depends:** T2, T3, T4
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 7: Migrate notifications and activity 400s [depends: T2, T3, T4]

## OBJECTIVE
Replace the two remaining single-site inline 400s: `server/src/modules/notifications/router.ts:117` (`title is required`, non-string or blank `title`) via `parseWith(trimmedRequired("title is required"), title)` (`trimmedRequired` in `validators/schemas.ts` is semantically equal to `typeof title === "string" && title.trim().length > 0`; use only its ok/not-ok result and keep passing the ORIGINAL `title` downstream, discarding the transformed `data`), and `server/src/modules/activity/activity.ts:98` (`card id must be an integer`) via `legacyIntegerParam`.

Steps:
1. Write characterization tests for: both sites
   Test file: `server/src/modules/notifications/router.validation.test.ts` and `server/src/modules/activity/activity.validation.test.ts` (new)
   Level: integration (supertest; db and domainBus mocked)
   Test intent: Given the notifications router, When posting a system alert with title absent, "", "   ", or 5 Then 400 `toEqual({ error: "title is required" })` and `domainBus.emit` was not called; Given a valid title Then validation passes. Given the activity route, When requesting card id "abc" or "1.5" Then 400 `toEqual({ error: "card id must be an integer" })` and the DB is not queried; Given id "1e2" Then no validation 400.
   Exercise through: HTTP via supertest following the setups of `notifications/router.test.ts` and `activity/activity.unified.test.ts`
   Test doubles: mock db, domainBus, auth/membership; not validators
   Expected RED: characterization — passes by design; prove live via mutation.
2. Run baseline: `npm run test --workspace=server -- src/modules/notifications/router.validation.test.ts src/modules/activity/activity.validation.test.ts`
3. Migrate both sites; run `npm run test --workspace=server -- src/modules/notifications src/modules/activity` — verify PASS (DB-bound integration tests need a DB). Then run `npm run typecheck --workspace=server` and `make check` (lint, architecture and feature-module guards — the #197 AC requires the feature-module guard to pass) — verify PASS. Commit: `refactor(server): route notifications and activity 400s through shared validation helper`

## REFERENCES LOADED
Spec — Rule 1; `server/src/modules/notifications/router.ts`, `router.test.ts`, `server/src/modules/activity/activity.ts`, `activity.unified.test.ts`; `server/src/validators/schemas.ts` (`trimmedRequired`).

## WHY THIS APPROACH
Complexity: lightweight
Justification: two independent single-site changes sharing the same pattern.

## SANDWICH CONTEXT
[CRITICAL: Behavior-preserving — identical status, message and body; activity logging (`recordActivity`) behavior must not change]
You are implementing the last two one-off 400 migrations for #197 PR-2.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: parseWith/sendValidationError + existing primitives.
Files in scope: notifications/router.ts, notifications/router.validation.test.ts, activity/activity.ts, activity/activity.validation.test.ts
Available after: T1
Architecture rule: `.js` import extensions; no cross-feature deep imports.
[RESTATE: Identical status/message/body; validation precedes side effects]

## DELIVERABLE
Given blank title, When posting a system alert, Then 400 `{ error: "title is required" }` and nothing emitted
Given card id "abc", When requesting activity, Then 400 `{ error: "card id must be an integer" }` and no DB query
Given both files, When grepped for `status(400)`, Then zero matches
Given existing notifications/activity tests, When run, Then pass unmodified

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Bodies pinned with `toEqual`; no side effect before validation
Must-not-have:
  - Passing the trimmed `trimmedRequired` output downstream (it transforms; use only the ok/not-ok result)
  - workspaceIdParam/positiveIdParam use
Open question risks:
  - `trimmedRequired` transforms the stored value → do not pass the transformed value downstream; keep `title` untouched
Rollback note:
  - Revert the migration commit
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: existing notification title is stored trimmed vs raw and a schema would change it
Escalate when: migration changes persisted data
