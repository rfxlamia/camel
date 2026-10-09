# Complete shared 400 validation (#197, #198, #199) — Migrate auth routes (router.ts, oauth.ts) (Phase 2 of 5)

**Date:** 2026-10-09
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 1 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T5, T6, T7}
**Unlocks next:** Phase 3

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

- **T5:** Migrate auth routes (router.ts, oauth.ts) [depends: T2, T3, T4] → [tasks/T5-migrate-auth-routes-router-ts-oauth-ts.md](tasks/T5-migrate-auth-routes-router-ts-oauth-ts.md)
- **T6:** Migrate realtime SSE workspace-id 400 (sse.ts) [depends: T2, T3, T4] → [tasks/T6-migrate-realtime-sse-workspace-id-400-sse-ts.md](tasks/T6-migrate-realtime-sse-workspace-id-400-sse-ts.md)
- **T7:** Migrate notifications and activity 400s [depends: T2, T3, T4] → [tasks/T7-migrate-notifications-and-activity-400s.md](tasks/T7-migrate-notifications-and-activity-400s.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 3 ONLY after this gate passes.
