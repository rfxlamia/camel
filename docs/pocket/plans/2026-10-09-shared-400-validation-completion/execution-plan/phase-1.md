# Complete shared 400 validation (#197, #198, #199) — Add legacyIntegerParam primitive (Phase 1 of 5)

**Date:** 2026-10-09
**Original plan:** ../execution-plan.md
**Prerequisite:** None (first phase)
**Contains tasks:** {T1, T2, T3, T4}
**Unlocks next:** Phase 2

---

## Task List

Total: 4 tasks | Prerequisite phases must be complete before starting

- **T1:** Add legacyIntegerParam primitive [prereq] → [tasks/T1-add-legacyintegerparam-primitive.md](tasks/T1-add-legacyintegerparam-primitive.md)
- **T2:** Migrate agent board routes (read-routes.ts, routes.ts) [depends: T1] → [tasks/T2-migrate-agent-board-routes-read-routes-ts-routes-ts.md](tasks/T2-migrate-agent-board-routes-read-routes-ts-routes-ts.md)
- **T3:** Migrate agent ticket-intake routes (routes.ts, submit.ts) [depends: T1] → [tasks/T3-migrate-agent-ticket-intake-routes-routes-ts-submit-ts.md](tasks/T3-migrate-agent-ticket-intake-routes-routes-ts-submit-ts.md)
- **T4:** Migrate chat routes (routes.ts, message-stream.ts) [depends: T1] → [tasks/T4-migrate-chat-routes-routes-ts-message-stream-ts.md](tasks/T4-migrate-chat-routes-routes-ts-message-stream-ts.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 2 ONLY after this gate passes.
