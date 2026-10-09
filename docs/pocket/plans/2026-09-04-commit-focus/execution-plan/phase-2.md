# Commit Focus (Personal Focus Mode) — Focus session route + focus audit event type (Phase 2 of 4)

**Date:** 2026-09-04
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 1 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T15, T4, T5, T6}
**Unlocks next:** Phase 3

---

## Task List

Total: 4 tasks | Prerequisite phases must be complete before starting

- **T15:** Focus audit event type + activity feed exclusion [depends: T3] → [tasks/T15-focus-audit-event-type-activity-feed-exclusion.md](tasks/T15-focus-audit-event-type-activity-feed-exclusion.md)
- **T4:** Focus session route — read + create [depends: T1, T2, T3, T15] → [tasks/T4-focus-session-route-read-create.md](tasks/T4-focus-session-route-read-create.md)
- **T5:** Focus session route — lifecycle transitions + optimistic locking [depends: T4] → [tasks/T5-focus-session-route-lifecycle-transitions-optimistic-locking.md](tasks/T5-focus-session-route-lifecycle-transitions-optimistic-locking.md)
- **T6:** Focus session route — atomic switch [depends: T5] → [tasks/T6-focus-session-route-atomic-switch.md](tasks/T6-focus-session-route-atomic-switch.md)

---

## Phase Notes

**T15 runs first.** T4, T5, T6 (and T14 in Phase 3) all log through `recordActivity` with `eventType: "focus_session"`, which does not exist in the union until T15 adds it. Starting T4 first forces the executor to either guess `"update"` — which puts blank rows in every member's activity feed — or edit `helpers.ts` outside its declared file scope.

**Test commands in this phase are workspace-scoped and workspace-relative.** `npm run test -- <path>` from the repo root does NOT filter: the root script is `A && B`, so npm appends the path to the *client* command only, the server suite runs unfiltered, and the client run exits 1. Use `npm run test --workspace=server -- src/routes/<file>` (see `CLAUDE.md`).

**`-t` filters use regex dots, never quoted phrases.** npm strips the quotes, so `-t "multi word"` reaches vitest as `-t multi` plus a stray positional and can report `Tests N skipped (N)` at exit 0 — a green gate that ran nothing. After any filtered run, confirm the summary says passed or failed, not skipped.

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 3 ONLY after this gate passes.
