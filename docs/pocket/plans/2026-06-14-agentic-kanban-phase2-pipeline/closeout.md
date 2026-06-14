# Closeout — 2026-06-14-agentic-kanban-phase2-pipeline

- **Plan:** docs/pocket/plans/2026-06-14-agentic-kanban-phase2-pipeline
- **Type:** flat
- **Started:** 2026-06-14  ·  **Closed:** 2026-06-15
- **Baseline SHA:** 5ded7d1  ·  **Final SHA:** 4505a19 (T1 correction; last task done_sha 3c8a7e7)
- **Result:** CLOSED — all phases DONE, all reviewable tasks REVIEW_PASS

## Phases

### Phase 1 — execution-plan.md  (DONE)

| Task | Name | done_sha | Verdict |
|------|------|----------|---------|
| T1 | Pure resolver layer in templates.ts | 38263994 (corrected → 4505a19) | REVIEW_PASS (cycle 3) |
| T2 | runPipeline loop in service.ts | fb4fe27 | REVIEW_PASS |
| T3 | routes.ts wiring — getColumns dep + call-site update | d00f440 | REVIEW_PASS |
| T4 | Headless live-LLM integration test | 3c8a7e7 | REVIEW_PASS |

_SHA range: 5ded7d1..3c8a7e7 (+ T1 corrections 721d851, 4505a19)_

**Corrections (append-only, attributed to T1):**
- 721d851 — restore pre-existing templates tests alongside Phase 2 coverage (resolved cycle-1 coverage regression)
- 4505a19 — drop unused TEMPLATES import in templates.test.ts (resolved cycle-2 ESLint blocker)

## Carried Forward

Non-blocking observations from review — accepted at close, recorded for follow-up.

- **T2** (Minor): "named resolution" unit test uses a built-in placeholder (`{previous_output}`) rather than a named accumulator key (`{research_output}`/`{analysis_output}`), so the slugToOutputKey → accumulator → render path executes but its effect is not directly asserted at the unit level (covered live by T4's integration test) — server/src/agent/service.test.ts:486-498
- **T2** (Minor): QUALITY BAR "Tests written BEFORE implementation (TDD)" not independently verifiable from the single squashed commit fb4fe27; satisfied per the plan's validation note (tests appended to a pre-existing passing suite) — server/src/agent/service.test.ts:455
- **T3** (Minor): getColumns SQL template-literal continuation lines (FROM/WHERE/ORDER BY) use a shallower indent than the surrounding getFirstCard block; faithful copy of the plan snippet, non-blocking — server/src/agent/routes.ts:180-183
- **T4** (Minor): `captured.events` collected via the publishEvent double but never asserted on; unused captured state that could be dropped or used to assert SSE per-card transitions — pipeline.integration.test.ts:28,67-69
- **Plan W1** (validation note): `triggerExecution` (+ its tests + the `getFirstCard` realDep) becomes dead code after the T3 call-site swap. Schedule removal as a Phase 2.1 cleanup once `runPipeline` is verified in production.
- **Plan W2** (validation note): the new `getColumns` realDep is verified by `tsc` only — no automated test asserts the SQL string (e.g. `ORDER BY position`). Acceptable for plumbing; consider a lightweight SQL-shape test.

## Skipped Tasks

_None_ — every task was reviewable (DONE with a non-empty SHA range).
