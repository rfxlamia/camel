# Pocket Planning Review Checkpoint — Demo Board

**Plan:** `docs/pocket/plans/2026-10-11-demo-board-client-only/execution-plan.md`  
**Spec:** `docs/pocket/spec/2026-10-11-demo-board-client-only/demo-board-spec.md`  
**Status:** Plan remains draft; independent review corrections, triggered audit findings, and saved-plan topology validation are recorded below. Structuring handoff still needs separate user approval.  
**Recovery history:** After earlier review checkpoints, the user explicitly authorized additional correction/review windows (including the current one). No automatic structuring or implementation is authorized.

## Review history

### Initial independent Spec Reviewer — Issues Found

- T3 did not prove a real double-submit creates exactly one card.
- T4 did not prove Add is disabled at WIP capacity.
- T4 did not prove form WIP `0` / `1.5` normalizes to `null`.
- Several T3/T4/T5 test intents grouped multiple GWT scenarios into one RED cycle/command.
- File map used globs/general references instead of exact regression-test paths.

**Applied before round 1:** Added distinct Add-disabled, invalid-WIP-form and real-form double-submit cycles; exact regression-test paths; split several behavioral cycles; added actual-entry/no-App-import test.

### Spec Reviewer correction/review round 1 — Issues Found

- T3 Step 10 combined dangling card references and invalid `nextId`.
- T3 Step 25 combined full-column WIP rejection, full-column same-column reorder and position rebalance.
- Rule 4.2 load validation lacked explicit tests for unique IDs, finite positions, valid WIP, field caps and the 512 KB payload cap.
- Rule 4.3 had store-level failure coverage but no UI test for the “changes will not survive a reload” notice after read/write failure, once per session.
- No explicit test for dropping the currently open card on trash, closing its panel and returning the URL to `/demo`.

**Applied before round 2:** Split dangling reference and nextId checks; separated WIP rejection/reorder/rebalance; added load-invariant validation, read/write notice UI tests, open-card trash flow; split the outer-boundary demo, authenticated-board and add/reload integration assertions.

### Spec Reviewer correction/review round 2 — Issues Found (unresolved)

1. **[T3, Steps 13–15 and 19–21]** Rule 2.1 requires successful card edits and successful column add, rename and WIP edits to persist. Current RED cycles do not prove successful column add/rename/WIP persistence; text validation and invalid WIP rejection are not substitutes.
2. **[T3, Steps 16–18 and 46–54]** Rule 2.4 requires each successful edit or move to increment the moved/edited card version exactly once. Stale-version rejection is tested, but successful version increments after edit/move and unaffected version stability need explicit assertions.
3. **[T4, Steps 16–18]** The trash-drop test requires the “demo router,” but T4 does not depend on T5, which creates it; T5 depends on T4. This is a dependency cycle/contradiction. Move the full router flow to a T5/T7 integration test or use a T4-available route seam.
4. **[T4, Steps 1–3]** Rule 5.1 test intent must explicitly assert AddCard shows only the title editor and column settings show only name, WIP and color.
5. **[T5 Steps 1–3 / T7 Steps 1–3]** Rule 4.5 scenario is untested: when `boardViewModeByWorkspace` stores `calendar`, demo must still render board view and keep its own state independent.

**Non-blocking note:** T4 file map repeats `BoardPageSurface.tsx`.

## Required next bounded window

If explicitly authorized, make the following corrections together before requesting one independent review:

- Add a RED cycle for successful card edit persistence and successful column add, rename and valid WIP persistence (one cycle per GWT scenario, each with its own exact fail command).
- Assert successful card edit/move increments the affected card version exactly once; assert position rebalance leaves unaffected card versions unchanged.
- Resolve T4/T5 dependency contradiction by moving the full demo-router trash-drop scenario to T5 or T7; keep T4 independently runnable.
- Explicitly assert title-only AddCard and only name/WIP/color column settings in the Rule 5.1 UI test.
- Add a storage-seeded `boardViewModeByWorkspace = "calendar"` test proving demo still renders board view.
- Remove the duplicate T4 `BoardPageSurface.tsx` file-map entry and refresh task/file map/dependency overview if any task changes.

After an Approved independent review, run the required Test Strategy Audit (persistence and cross-unit triggers fired), apply any findings under its own bounded protocol, re-review any changed plan, then run the saved-plan dry-run with JSON contract 3. Do not invoke pocket-structuring until the user separately approves plan handoff. Structuring authorization does not authorize implementation.

## Authorized recovery window outcome

- **Spec Reviewer:** Approved after corrections. Final map confirmation approved `client/src/features/board/ContextPanel.test.tsx` as unchanged and found no remaining blocking issues.
- **Test Strategy Audit:** Initially returned 3 findings. Corrections added fresh-store deletion checks, full-WIP board/source integration (toast, restore and unchanged storage), a composed DemoApp calendar-preference test, plus panel danger-zone delete persistence. Changed tasks were independently re-reviewed and approved.
- **Saved-plan dry-run:** `ok: true`; `action: split`; execution flow: `T1→T2,T3(PARALLEL)→T4→T5→T6→T7`; no error.
- **Plan status:** `execution-plan.md` remains `draft`. The user authorized correction/review only, not plan handoff.
- **Not invoked:** pocket-structuring and implementation. Structuring requires separate plan approval; execution requires a later separate approval.

## Blockers recorded at the prior checkpoint (resolved in the authorized window)

- **[T4, Step 7]** The test uses a deterministic source double but claims persisted deletion via a fresh store; use the real memory source/store for deletion persistence on both trash and danger-zone paths.
- **[T4, Step 1]** It combines visibility, WIP drag rejection, form normalization and authenticated defaults into one RED cycle; separate scenarios and commands.
- **[T7, Steps 1–9]** Expected RED claims are based on missing coverage or pre-T6 static App import; T6 has already fixed the entry, so these tests may immediately pass. Do not claim a behavioral RED that no longer exists; move integration RED cycles before owning implementation tasks or use the verification task only to run already-owned tests.
- **[T3]** Sixty-seven numbered steps are not a bounded task. Split store/validation, mutation behavior and storage failure into bounded packets, then refresh task IDs, dependencies, overview, file map and summary.

## Latest recovery window outcome

- **Spec Reviewer:** Full reviews found blocking findings; corrections were applied and affected task/map areas received independent scoped confirmations. Do not read this as a blanket “Approved” result for an unchanged revision.
- **Test Strategy Audit:** The prior audit returned Findings. Its identified fixes were applied and changed tasks were independently reviewed. However, the audit was not rerun against the latest saved plan edits; the current revision has no Clean audit result and must be audited before handoff.
- **Saved-plan dry-run:** `ok: true`; `action: split`; execution flow `T1→T2,T3(PARALLEL)→T4→T5→T6→T7→T8→T9→T10→T11→T12→T13→T14→T15,T16(PARALLEL)`; no error.
- **Handoff:** Plan remains `draft`. No pocket-structuring or implementation was invoked. Plan approval for structuring and execution approval remain separate user decisions.
