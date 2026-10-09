# Plan Validation Report: Commit Focus — Phase 3

**Plan:** `docs/pocket/plans/2026-09-04-commit-focus/execution-plan/phase-3.md`
**Tasks validated:** T7, T14, T8, T11, T12
**Date:** 2026-09-04
**Validated against:** working tree at `2b939ad` (Phase 1 + 2 DONE)

---

## Executive Summary

- **Critical issues:** 6 blockers
- **Warnings:** 4
- **Info:** 6
- **Overall grade:** C

The plan's *content* is strong: file paths are exact, GWT criteria are independent, RED expectations are named per cycle, must-not clauses are specific, and the architectural decisions (server-authoritative state, provider-not-hook, one pure guard, seams owned upstream) are correct and verified against the codebase.

The problem is the **verification layer**. Two mechanical command defects — both reproduced in this repo, both already documented in `CLAUDE.md` — mean the plan can be executed end to end, with every TDD gate ticked, having verified nothing.

---

## TDD Analysis

### CRITICAL-1 — False RED: every client test command is unrunnable

**Affected:** T7 (33 occurrences), T12 (8), T8 (7), T11 (5)

The plan uses `npm run test -- client/src/<path>` throughout. The root script is:

```json
"test": "npm run test --workspace=server && npm run test --workspace=client"
```

npm appends args to the *end* of the compound script, so the path lands on the **client** command only, and the client's vitest runs with cwd `client/` — the `client/` prefix never matches.

Reproduced:

```
$ npm run test --workspace=client -- client/src/context/BoardContext.viewMode.test.tsx
 RUN  v4.1.10 /Users/rfxlamia/project/camel/client
No test files found, exiting with code 1
filter: client/src/context/BoardContext.viewMode.test.tsx
include: src/**/*.test.{ts,tsx}
```

Consequence: every step of the form *"Run test — verify FAIL"* is satisfied by a command that never loaded a test file. Exit code 1 with no test run is indistinguishable, to an executing agent, from a genuine RED. And after implementation the same command still exits 1, so the matching *"verify PASS"* step can never be satisfied — the agent either loops or silently reinterprets the gate.

`CLAUDE.md` documents this exact failure.

**Fix — mechanical rewrite:**

```
npm run test -- client/src/X   →   npm run test --workspace=client -- src/X
```

### CRITICAL-2 — False GREEN: multi-word `-t` filters run zero tests and exit 0

**Affected:** T7 (12 occurrences), T14 (4)

npm strips the quotes, so vitest receives `-t <first-word>` plus stray positional filters. Reproduced:

```
$ npm run test --workspace=client -- src/context/BoardContext.focusFlag.test.tsx -t "no preference"
> vitest run src/context/BoardContext.focusFlag.test.tsx -t no preference
 Test Files  1 skipped (1)
      Tests  3 skipped (3)
```

Exit code **0**. A green gate that ran nothing.

Affected filters: `-t "card.deleted fans out"`, `-t "tracker.deleted fans out"`, `-t "restores from the server"`, `-t "session null silent"`, `-t "autoFinished toast"`, `-t "switchTo version_conflict"`, `-t "tab B pauses"`, `-t "payload.session null"`, `-t "other user focus event"` (T7); `-t "membership row is gone"`, `-t "roll back both"` (T14).

T8's `-t "Paused"` and `-t "Ready"` are single-word and safe. T14's *paths* are already correct (`--workspace=server -- src/routes/...`).

**Fix:** drop `-t` and run the whole file, or use a regex dot for the space (`-t card.deleted.fans.out`).

### Phase Completion Gate is unfalsifiable as written

"All tests pass" should be pinned to an unfiltered root `npm run test` — the only command in this plan that cannot lie.

### TDD structure — otherwise clean

Every implementation step is preceded by a named RED with a distinct expected failure. Sub-cycles (6a, 6b, 12a, 12b, 33a, 36a–36f, 3a, 6a) explicitly forbid reusing "module does not exist" as a later case's RED — a common anti-pattern this plan actively guards against. Refactor steps are bounded and gated on green. No "write tests at the end" task exists.

---

## Gap Analysis

### CRITICAL-3 — T14: `FocusAuditAction` extension is out of scope

T14 Step 3 requires extending the audit action union with `"membership_removed"`. That union lives at `server/src/routes/focus-session.ts:24-31`:

```typescript
| "pause" | "resume" | "finish" | "auto_finish";

export type RecordFocusActivity = (input: {
  actor: AuthUser; workspaceId: number; sessionId: number; action: FocusAuditAction;
}) => Promise<void>;
```

`server/src/routes/focus-session.ts` appears in neither T14's `Files:` list nor its `git add` line. Compounding this, T14's prose says the type is "defined in `focus-session.ts`" while its REFERENCES section points at `server/src/core/focus-session.ts` — an executor will open the wrong file, find nothing, and report NEEDS_CONTEXT.

**Fix:** add `server/src/routes/focus-session.ts` to T14's `Files:`, scope line, and `git add`; disambiguate the prose to `server/src/routes/focus-session.ts`.

### CRITICAL-4 — T14: no `AuthUser` reaches the removal transaction

`RecordFocusActivity` requires `actor: AuthUser` (`{ id, username, displayName, email, emailVerified, needsUsername }`). The removal path provides neither:

- `createWorkspaceAccessService().removeMember({ actorId, workspaceId, userId })` — `actorId: number` only (`helpers.ts:216`)
- `deps.removeMember(workspaceId, userId)` — the transaction-level dep, gets no actor at all (`helpers.ts:181-184`)

Two unresolved questions the plan never asks:

1. **Plumbing** — where does the `AuthUser` come from? If it must be threaded from the route, `server/src/routes/members.ts` changes too, and it is not in scope.
2. **Semantics** — is the audit actor the removing **admin** or the removed **member**? This decides `actor_id` in `card_events`. T14 says only "the session/workspace/user identifiers".

**Fix:** decide the semantics in the plan (recommend: the removing admin is the actor, the removed member is carried in the payload — the admin performed the mutation), and name every file the plumbing touches.

### CRITICAL-5 — T7: the 409 body-carries-session assumption is false

T7's Open-question risk reads:

> Assumption: the 409 body always carries the current session (T5/T6 contract). If it can be absent, the hook needs a refetch fallback → report NEEDS_CONTEXT rather than silently adding one.

Both `version_conflict` paths already shipped in Phase 2 return a nullable session:

```typescript
// server/src/routes/focus-session.ts (~363 and ~480)
const current = await repo.findActive(actor.id, workspaceId);
return res.status(409).json({
  code: "version_conflict",
  session: current ? serializeFocusSession(current) : null,
});
```

So T7 as written stalls on a code path that is already readable today.

**Fix:** resolve it in the plan rather than at execution time — adopting `null` **is** the correct behavior (no active session server-side ⇒ clear local state), and no refetch fallback is needed. Delete the NEEDS_CONTEXT escape hatch and state the null-adoption contract.

### CRITICAL-6 — T12: file list contradicts itself, self-triggering its own red flag

- `Files:` block lists **4**: `workspaceSwitcher.ts`, `BoardContext.tsx`, `workspaceSwitcher.test.ts`, `BoardContext.focusGuard.test.tsx`
- Scope line and `git add` list **6** — adding `WorkspaceSwitcher.tsx` and `WorkspaceSwitcher.test.tsx`
- Red flags: *"Work outside the six listed files → DONE_WITH_CONCERNS"*

Steps 5–7 genuinely require `WorkspaceSwitcher.tsx` (verified: it is a second, independent caller of `getSwitchAttemptState` at `client/src/layout/sidebar/WorkspaceSwitcher.tsx:115`). As written, the task flags a concern against itself.

**Fix:** make the `Files:` block six entries and mark `WorkspaceSwitcher.test.tsx` as **Create** (it does not exist).

### WARNING-1 — T7: nothing tests that `BoardContext` actually exposes the focus flags

T7 Step 18 assigns ownership of `hasActiveFocusSession`, `focusSessionHydrated`, and their setters to `BoardContext`. But every T7 test stubs `BoardContext`, and T12 is explicitly forbidden from defining them. Typecheck will catch a missing field; no test will. Consider one assertion in `BoardContext.focusSeams.test.tsx` that the real provider exposes all four.

### WARNING-2 — T7: third 409 code is unplanned

The route also returns `409 { code: "invalid_transition", session }` (`focus-session.ts:~464`). T7 plans an explicit two-way split (`version_conflict` / `session_active`) and says nothing about the third. Falling into generic `actionError` is the right answer — say so explicitly, so nobody invents a third branch mid-task.

### WARNING-3 — T12: new statuses change dropdown behavior, unspecified

`WorkspaceSwitcher.tsx:117` reads `if (state.status !== "confirm-required") setOpen(false);`. Adding `focus-blocked` / `focus-loading` closes the dropdown while the toast fires. Probably the intended calm behavior — name it, so it is a decision rather than an accident.

### WARNING-4 — T7 is a single commit across 7 files and ~19 RED/GREEN cycles

Steps 1–9 (BoardContext seams) and 10–38 (provider + mount) are a natural seam already present in the step order. Splitting the **commit** there buys real reviewability at near-zero cost. Do not split the *task* — `phase-3.md`, `index.md`, and `log.json` all carry `depends: T7`. Note that a commit split invalidates T7's single-commit DELIVERABLE assertion, which would need updating too.

---

## DRY Analysis

Clean. Verified rather than assumed:

- **`formatDuration` genuinely absent** — no seconds→`MM:SS` helper anywhere in `client/src/lib/` (only date padding in `boardViewUtils.ts`). T8 Step 9's mapped extraction to `client/src/lib/focusDuration.ts` is justified, and correctly forbids a generic `utils.ts`.
- **`WorkItemSource` reuse instruction is correct** — `client/src/types.ts:375` already declares `"board" | "tracker"`; T7 forbids a second union.
- **`ApiError` is exported** — `client/src/api.ts:872`, so T7's tests can construct one.
- **`api.focus` namespace already exists** from T3 (`getConfig`); T7 extends it rather than creating a parallel client.
- **T12 extends the existing pure guard** instead of adding a second gate, and covers both call sites (`BoardContext.tsx:373`, `WorkspaceSwitcher.tsx:115`).
- **T7 mirrors `subscribeTrackerEvents`** verbatim rather than inventing a second subscription pattern, and Step 37 collapses all four registries into one `createSubscriberRegistry()` at the rule of three.

**INFO:** T14 Step 9 asks to change `createFocusSessionRepo(executor = db)`. The current signature is `createFocusSessionRepo(db: Kysely<DB>)`; Kysely's `Transaction<DB>` already extends `Kysely<DB>`, so only the default parameter is actually needed — no type widening.

---

## YAGNI Analysis

One question worth answering rather than leaving blank.

**T7 builds three SSE seams; only one has a Phase-3 consumer.** `subscribeFocusEvents` is used by the provider in this phase. `subscribeCardEvents` and `subscribeMembershipEvents` exist solely for T9 and T13 in Phase 4.

**Verdict: justified, not a violation.** T7 is the only task that owns the `BoardContext` `onmessage` branch. Front-loading all three is precisely what makes every later task's "no changes to `BoardContext.tsx`" rule enforceable — deferring them would mean T9 and T13 each reopening a 761-line shared file. The plan states this reasoning itself and it holds.

**T14's `failAfterFocusFinalize` injection** is bounded to the service factory and explicitly forbidden from becoming a global production flag. Acceptable as a rollback-boundary test seam.

No speculative abstractions, no unused configuration, no premature optimization elsewhere. T8 and T11 are correctly scoped to one component each and explicitly reject scope creep (no productivity scoring, no live duration in nav chrome).

---

## Codebase Context (verified)

| Plan claim | Status |
|---|---|
| `subscribeTrackerEvents` exists and is the only fan-out | ✅ `BoardContext.tsx:127`, dispatch at `:592-600` |
| `card.*` falls through to `scheduleRefresh()` with no subscriber | ✅ verified — the fall-through at `:608` is the board refresh |
| `membership.removed` block has a conditional `return` on the redirect path | ✅ `:561-579` — fan-out must sit at the top, exactly as T7 states |
| `getSwitchAttemptState` has 3 statuses, no focus fields | ✅ `workspaceSwitcher.ts:12-15, 28` |
| `focus_session.updated` payload is `{ userId, workspaceId, payload: { session } }` | ✅ `focus-session.ts:179-184` |
| Nullable session on `payload.session: null` broadcast | ✅ used for auto-finish and finish |
| `PresenceBar` mount point | ✅ `AppLayout.tsx:89` (plan says ~88) |
| `RUN_INTEGRATION=1` is the route-integration gate | ✅ `server/package.json` — `RUN_LLM_IT` is the LLM-pipeline gate only, so T14 is right and `CLAUDE.md`'s note does not apply here |
| `createWorkspaceAccessService` + removal transaction | ✅ `helpers.ts:214, 351-372` |
| `recordActivity` accepts `eventType: "focus_session"` | ✅ `helpers.ts:510` (T15) |
| `BoardProvider` wraps `AuthenticatedApp` → `RouterProvider` | ✅ `App.tsx:174` — T7 Step 38's mount point is valid |

### INFO — stale references

- T7 says `BoardContext.tsx` is "~742 lines"; actual **761**.
- T7 says `subscribeTrackerEvents` at "~123"; actual **127**.
- T7's DELIVERABLE cites *"the Step 24 registry extraction"*; the `createSubscriberRegistry()` extraction is **Step 37**.
- T12 Step 5 names `client/src/layout/sidebar/WorkspaceSwitcher.test.tsx` as "Test file:" without marking it **Create** — it does not exist.

---

## Resolution — all findings applied

Every item above was applied to the plan on 2026-09-04.

| # | Finding | Applied |
|---|---|---|
| C-1 | False RED — client test paths | 53 commands rewritten to `npm run test --workspace=client -- src/...` across T7/T8/T11/T12 |
| C-2 | False GREEN — quoted `-t` | 16 filters converted to unquoted regex-dot form (`-t card.deleted.fans.out`); T8's single-word filters unquoted for consistency |
| C-3 | T14 audit-union scope hole | `server/src/routes/focus-session.ts` added to `Files:`, scope line, `git add`, REFERENCES, and QUALITY BAR; `routes/` vs `core/` disambiguated with an explicit "different file" note |
| C-4 | T14 actor plumbing | Actor decided (**the removing admin**, removed member in payload); `AuthUser` threaded from `members.ts` `req.user` through a widened `WorkspaceAccessDeps["removeMember"]`; `members.ts` added to scope; Steps 1/3/9 carry `actor` |
| C-5 | T7 false 409 assumption | Open question deleted; replaced with a settled three-row contract table (`version_conflict` nullable / `session_active` / `invalid_transition`) and a new Step 30a RED→GREEN cycle for the `session: null` body |
| C-6 | T12 file-list contradiction | `Files:` block reconciled to six, identical to the scope line and `git add`; `WorkspaceSwitcher.test.tsx` marked **Create**; two-caller rationale stated |
| W-1 | Focus flags untested on real provider | New Step 18a — probe reads `useBoard()` inside a real `BoardProvider` and asserts all four fields |
| W-2 | `invalid_transition` unplanned | Named in the contract table, in Step 33, in QUALITY BAR, and as a derived criterion — generic `actionError`, no third branch |
| W-3 | Dropdown behavior on new statuses | Decided in T12 Step 7 (dropdown closes; only `confirm-required` keeps it open) and added as a derived criterion |
| W-4 | T7 single commit | Split into two commits at the Steps 1–9 / 10–38 seam; DELIVERABLE commit assertion updated to expect both |
| INFO | Stale references | BoardContext `~742`→`~761`; per-symbol line numbers replaced with verified ones; "Step 24 registry extraction"→"Step 37"; `ApiError` export line noted; `createFocusSessionRepo` note that `Transaction<DB>` already extends `Kysely<DB>` |

The phase gate itself now names both traps and pins "all tests pass" to an **unfiltered** root `npm run test` plus `npm run typecheck` — the only commands in this plan that cannot report success without running.

### Not applied — outside this validation's scope

Phase 4's task files carry the same two command defects and should get the identical rewrite before that phase starts:

- `T9-focus-route-focuspage.md` — 6 quoted multi-word `-t` filters
- `T13-live-auto-finish-guards-task-deleted-access-revoked.md` — 19 quoted multi-word `-t` filters
- both, plus `T10`, use root-relative client test paths

(Phase 1 and 2 task files carry a few too — `T3`, `T6`, `T15` — but those phases are DONE and their tests already pass under the unfiltered root run, so there is nothing to recover there.)
