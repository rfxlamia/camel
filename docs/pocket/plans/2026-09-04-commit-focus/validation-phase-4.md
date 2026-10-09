# Plan Validation Report: Commit Focus — Phase 4

**Plan:** `docs/pocket/plans/2026-09-04-commit-focus/execution-plan/phase-4.md`
**Tasks validated:** T9, T13, T10
**Date:** 2026-09-04
**Validated against:** working tree on `focus-mode` at `fa9764b` (Phases 1–3 DONE)

---

## Executive Summary

- **Critical issues:** 5 blockers
- **Warnings:** 4
- **Info:** 5
- **Overall grade:** C

Content quality is the same as Phase 3: exact file paths, independent GWT cases, per-cycle RED
expectations, specific must-not clauses, correct architecture calls (source-before-id matching,
seams owned upstream, no second `EventSource`, entry logic kept out of the 650-line mount sites).
Every codebase reference checked out — `subscribeCardEvents` / `subscribeTrackerEvents` /
`subscribeMembershipEvents` all exist on `BoardContext` (lines 167–170, 342–349), the SSE dispatch is
prefix-based so `card.deleted` and `tracker.deleted` fan out (lines 694–709), `ContextPanel.tsx:367`
and `TrackerDetailPage.tsx:440` are the correct mount sites, `board/card/:cardId` is a real nested
route (`App.tsx:53`) so `returnPath: "/board/card/481"` is navigable, and `api.getCard` /
`api.getWorkItem` sit where the plan says.

Two defect classes block execution:

1. **The verification layer repeats Phase 3's two mechanical defects verbatim** — 59 unrunnable test
   commands and 21 quote-stripped `-t` filters. Phase 3's task files were fixed (T8 now reads
   `npm run test --workspace=client -- src/components/FocusTimer.test.tsx`); Phase 4's were not.
2. **Two contract mismatches against the code Phase 3 actually shipped** — the `finish()` return shape
   and the finish-transition ref's failure path. Both produce silent wrong behaviour on exactly the
   path the T9 SANDWICH exists to protect.

---

## TDD Analysis

### CRITICAL-1 — False RED: every client test command is unrunnable

**Affected:** T9 (21 occurrences), T13 (22), T10 (16) — 59 total. Zero workspace-scoped commands.

Root `package.json`: `"test": "npm run test --workspace=server && npm run test --workspace=client"`.
npm appends args to the end of the compound script, so the path lands on the **client** command only,
and client vitest runs with cwd `client/` — the `client/` prefix never matches. Documented in
`CLAUDE.md`; reproduced in the Phase 3 report.

Consequence: "Run test — verify FAIL" is satisfied by a command that loaded no test file, and the
matching "verify PASS" can never be satisfied, because the same command still exits 1 after
implementation.

**Fix — mechanical rewrite across all three task files:**

```
npm run test -- client/src/X   →   npm run test --workspace=client -- src/X
```

### CRITICAL-2 — False GREEN: multi-word `-t` filters run zero tests and exit 0

**Affected:** T9 (5 multi-word occurrences; `-t "loading"` is single-word and safe), T13 (22).

npm strips the quotes, so vitest receives `-t <first-word>` plus stray positional filters and reports
`Tests N skipped (N)` at **exit 0** — a green gate that ran nothing.

**T9 and T13 need different fixes. Do not apply Phase 3's remedy uniformly.**

- **T9** (`-t "no active session"`, `-t "card.updated refreshes title"`,
  `-t "tracker.updated refreshes title"`) can either drop `-t` and run the whole file, or use the
  dotted form.
- **T13 cannot drop `-t`.** Its entire step structure is per-case isolation — "verify FAIL for Case A
  only", "then re-run Cases A–C `-t` filters so they stay PASS". Running the whole file after Step 3
  fails on Cases B–F, which are not implemented yet; "FAIL for Case A only" and "PASS for Case A only"
  both become unreadable and the re-run instructions become impossible.

**Fix for T13 — the regex-dot form, per filter:**

```
-t matching.card.deleted          -t different.cardId
-t matching.tracker.deleted       -t different.trackerItemId
-t colliding.tracker.deleted      -t colliding.card.deleted
-t card.updated.does.not.finish   -t tracker.updated.does.not.finish
-t deleted.finish.409.still.clears  -t deleted.finish.5xx.still.clears
-t matching.membership.removed    -t different.user.membership
-t no.session.card.deleted        -t no.session.tracker.deleted
-t no.session.membership.removed
```

All fifteen stay mutually distinct under regex-substring matching. **Add an explicit instruction that
each `it()` title must be authored to contain the filter string verbatim** — the dotted filter is only
safe while exactly one test name matches it.

### CRITICAL-3 — Phase Completion Gate is unfalsifiable

`phase-4.md` says "All tests pass" with no command — the same file-level defect the Phase 3 report
raised. Pin it to an unfiltered root `npm run test` plus `npm run typecheck`, the only commands in
this phase that cannot lie.

---

## Gap Analysis — contract mismatches against shipped code

### CRITICAL-4 — T9 Step 23/25: `finish()` resolves to a flat `FocusSession`, not `{ session }`

`FocusSessionContext.tsx:240` — `finish: () => Promise<FocusSession>`; `runPatchAction` destructures
the API envelope and returns `next` directly.

T9 Step 23 specifies the resolved value as `{ session: { state: "finished", returnPath } }` — the
*server response* shape, not the provider's. Because the test double is written from the same
sentence, `vi.hoisted` loose typing lets the returnPath test go green while production reads
`result.session.returnPath` → `undefined` → the `/board` fallback fires on every finish.

That is precisely the silent failure the T9 SANDWICH exists to prevent, and no other test in the plan
would catch it.

**Fix:** Step 23 and Step 25 must read `finish()` resolves with a `FocusSession`; navigate to
`finished.returnPath`, falling back to `/board` only when it is empty.

### CRITICAL-5 — T9 Step 3: the finish-transition ref is never cleared on rejection

Step 3 says set the ref immediately before `finish()` and skip the redirect while it is set. Nothing
says to clear it when `finish()` rejects.

Trace: 5xx → `handleMutationError` sets `actionError` → `runPatchAction` returns `undefined` →
`finish()` throws `new Error("Finish failed")` → session stays populated → **ref stays set for the
life of the mount**. If T13 later auto-finishes that session on a `card.deleted`, the user sits on a
dead `/focus` with no task and no redirect — the inverse of the bug the SANDWICH warns about.

**Fix:** Step 3 must specify a `try/finally` (or explicit reset in the catch) that clears the ref
whenever `finish()` does not navigate. Add a derived DELIVERABLE line: *Given Finish fails, When the
session is later cleared by a guard, Then the no-session redirect still fires.*

---

## WARNINGS

### WARNING-1 — Tracker fixtures carry an `actor` field the seam does not have

`TrackerEventHandler` is `{ type: string; payload?: unknown; trackerItemId?: number }`
(`BoardContext.tsx:59–63`), and the dispatch narrows to exactly that shape (lines 700–706) — no
`actor`. T13 Steps 4b/4f and T9 Step 19a all pass `{ type, actor, trackerItemId }` and call it "the
literal tracker payload." It is not; excess-property checking will reject it wherever the stub
registry is typed.

Card fixtures are correct — `CardEventHandler` does carry `actor` (line 72–77).

**Fix:** drop `actor` from every tracker fixture. Also note that `trackerItemId` is **optional** — the
implementation needs an `undefined` guard before comparing it to `session.taskId`, or an event with no
id will match a session whose `taskId` is undefined-adjacent.

### WARNING-2 — `pending` is not exposed by the provider

T9 Steps 23/25 mandate `<FocusTimer ... pending={pending} />`, but the context value
(`FocusSessionContext.tsx:250–260`) exports only `session`, `loading`, `actionError`, `focus`,
`switchTo`, `start`, `pause`, `resume`, `finish`. There is no `pending`.

It typechecks (the prop is `pending?: boolean` on `FocusTimer`), so this is not a blocker — but the
step as written has no source for the value.

**Fix — one sentence:** state that `FocusPage` owns a local `pending` flag around its own action
invocations, or drop the prop from Step 25.

### WARNING-3 — T13's "clear state + toast" ordering vs the provider's 409 re-adoption

`reconcileVersionConflict` (line 140) calls `adoptSession(err.session ?? null)` on a 409
`version_conflict` — it repopulates the session from the error body. If a guard clears local state
before or independently of the finish promise settling, the provider's own handler repopulates it
afterward, and Case 4m passes or fails on accident of ordering.

**Fix:** Steps 3, 4d and 6a must state that the local clear runs **after** the finish attempt settles,
in both the resolve and reject paths.

### WARNING-4 — Phase 4 is not a parallel group

The `{T9, T13, T10}` set notation and the recent `Merge Tn (parallel group)` commits invite parallel
dispatch. **T10 depends on T9** — its unit tests would go green against a dead `/focus` link. Only T13
is genuinely parallel-safe with T9 (different files: page vs provider).

**Fix:** state the dispatch order explicitly in `phase-4.md` — `[T9 ∥ T13] → T10`.

---

## DRY Analysis

No duplicate-functionality violations. Verified reuse is correct:

- T10 is one component with two mount sites, not two buttons — right call.
- T9 Step 27 explicitly *refuses* to pre-extract the `source`-based load (rule of three not met) —
  correct.
- T13 Step 9 extracts one `eventTargetsFocusedTask` predicate and one `autoFinish` helper across three
  handlers, and forbids a generic `utils.ts` — correct.
- T10 Step 23 correctly refuses to share the same-task comparison across the network boundary with the
  server (T4/T6).

**INFO-1:** T9 and T13 both subscribe to `subscribeCardEvents` / `subscribeTrackerEvents` — the page
for title refresh, the provider for auto-finish. The registry supports multiple subscribers and the
concerns are genuinely different, so this is acceptable, not duplication. Worth one line in T13 noting
the coexistence so an implementer does not "consolidate" them.

---

## YAGNI Analysis

Scope is disciplined. T9's v1 restriction (title + description + timer, asserted as absence) and
T13's refusal to write a `notifications` row are both correctly bounded, and every task carries an
explicit "report NEEDS_CONTEXT rather than building it" escape.

**INFO-2:** T13 Step 4d deliberately instructs writing known-incorrect code (compare `trackerItemId`
without checking `source`) so Case D's RED is reachable. This is legitimate incremental TDD and the
step includes a skip-hatch if the guard is already present — but it is ceremony-heavy for a guard the
ADR mandates unconditionally. Acceptable as written; do not expand it.

**INFO-3:** T13 Step 4m splits 409 and 5xx into two named cases. Both take the same code path
(`handleMutationError` → local clear). One case with two rejection fixtures would cover it. Harmless
given the `[test-risk]` tag; leave it if the dotted `-t` filters are fixed.

---

## Remaining detail gaps

**INFO-4 — T10 Step 12 does not say where `version` comes from.** `switchTo({ source, taskId: B,
version })` needs the **currently active session's** version for the server's optimistic lock
(`api.focus.post` body `version?: number`). After `focus()` rejects 409 `session_active`, the provider
has already adopted that session (`runPost`, line 168–172), so `session.version` is the right source —
but the step should say so, and the mocked context fixture must carry a `version`.

**INFO-5 — T9 tracker load and a null `taskKey`.** `FocusSession.taskKey` is `string | null`
(`types.ts:387`), and `api.getWorkItem(workspaceId, key)` takes a `string`. T9 Step 10 should state
the behaviour when `taskKey` is null on a tracker session — surface the same calm task-load error as
Step 13, not an unchecked call.

---

## Codebase Context (verified, no action needed)

| Reference | Status |
|---|---|
| `subscribeCardEvents` / `subscribeTrackerEvents` / `subscribeMembershipEvents` | Exist — `BoardContext.tsx:167–170`, `342–349` |
| SSE fan-out for `*.deleted` | Prefix-based dispatch — `BoardContext.tsx:694–709` |
| `focusModeEnabled` on `useBoard` | Exists — `BoardContext.tsx:164`, `858` |
| `api.getCard(workspaceId, id)` / `api.getWorkItem(workspaceId, key)` | `api.ts:203` / `api.ts:501` |
| `api.focus.post` / `.patch` | `api.ts:813–847` |
| `ApiError` with `status`, `code`, `session` | `api.ts:39–51` |
| `App.tsx` `lazy` route convention + `board/card/:cardId` | `App.tsx:51–108` — `returnPath` target is real |
| `ContextPanel.tsx` ~367 flag-gated action row | Accurate (653 lines) |
| `TrackerDetailPage.tsx` ~440 sticky breadcrumb | Accurate (666 lines) |
| `FocusTimer` props incl. optional `pending` | `FocusTimer.tsx:5–12`, default export |
| `FocusSessionContext.tsx` at 265 lines | T13's ~300-line extraction trigger will plausibly fire |

---

## Recommended fix order

1. CRITICAL-1 — rewrite 59 commands to `--workspace=client -- src/...` (mechanical).
2. CRITICAL-2 — dotted `-t` for T13's 15 filters + "test name must contain the filter verbatim"; T9's
   3 filters either way.
3. CRITICAL-4 / CRITICAL-5 — correct T9's `finish()` shape and the ref-clearing failure path.
4. CRITICAL-3 — pin the Phase Completion Gate to unfiltered `npm run test` + `npm run typecheck`.
5. WARNING-1 through 4, then the INFO items.

---

## Applied — 2026-09-04

14 findings total — **12 applied, 2 accepted as-is** (INFO-2, INFO-3). Post-fix state:

| Finding | Change |
|---|---|
| CRITICAL-1 | 59 commands rewritten to `npm run test --workspace=client -- src/...` (T9:21, T13:22, T10:16). Zero residual. |
| CRITICAL-2 | 21 quoted `-t` filters → unquoted dotted regex, all mutually distinct. `-t "loading"` renamed to `-t no.redirect.while.hydrating` (it would have matched T9's "task loading fails" case). Test-name rule added to T9 and T13; T13 additionally forbids dropping `-t`. |
| CRITICAL-3 | `phase-4.md` gate pinned to unfiltered root `npm run test` + `npm run typecheck`. |
| CRITICAL-4 | T9 Steps 23/25 corrected to the flat `FocusSession` shape, with the reason the wrong double goes green. |
| CRITICAL-5 | T9 Step 3 gained the ref-clearing failure path, a derived DELIVERABLE line, and a falsifying RED→GREEN cycle (Steps 25a–25c, `-t failed.finish.does.not.suppress.redirect`). |
| WARNING-1 | `actor` dropped from tracker fixtures in T9 19a and T13 4b; optional `trackerItemId` guard stated in both. |
| WARNING-2 | T9 Steps 23/25 state `FocusPage` owns a local `pending` flag. |
| WARNING-3 | Settle-then-clear ordering added to T13 Steps 3, 4d, 6a. |
| WARNING-4 | `phase-4.md` gained a Dispatch Order section: `[T9 ∥ T13] → T10`. |
| INFO-1 | T13 documents the deliberate co-subscription with T9's page. |
| INFO-4 | T10 Steps 10/12 name the active session's `version` as the switch lock. |
| INFO-5 | T9 Steps 8/10 route a null `taskKey` into the Step 13 error state. |
| INFO-2 / INFO-3 | Left as designed (deliberate incremental RED; 409/5xx split is safe once filters are fixed). |

The Phase-3 SANDWICH warning about both command defects was mirrored into all three Phase-4 task
files.
