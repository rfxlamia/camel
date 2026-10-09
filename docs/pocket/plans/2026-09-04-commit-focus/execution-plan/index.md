# Commit Focus (Personal Focus Mode) — Execution Index

**Date:** 2026-09-04
**Spec:** docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md
**Source Plan:** ../execution-plan.md
**source-sha256:** a0d9a761d7fdd226f0641d7466261d891cd3e8e6b1e31615f112946fd62f07f8 (stale — Phase 2 and T14 were revised by `/validate-plan` on 2026-09-04; see the validation report)
**Total Tasks:** 15
**Total Phases:** 4

---

## Execution Flow

```
T1,T2,T3(PARALLEL)→T15→T4→T5→T6→T7,T14(PARALLEL)→T8,T11,T12(PARALLEL)→T9,T13(PARALLEL)→T10
```

---

## Phase Summary

- **Phase 1:** [phase-1.md](phase-1.md) — `focus_sessions` schema + Kysely types (T1, T2, T3)
- **Phase 2:** [phase-2.md](phase-2.md) — Focus audit event type + focus session route (T15, T4, T5, T6)
- **Phase 3:** [phase-3.md](phase-3.md) — Client focus session model — `FocusSessionProvider` + SSE seams (T7, T14, T8, T11, T12)
- **Phase 4:** [phase-4.md](phase-4.md) — `/focus` route + `FocusPage` (T9, T13, T10)

---

## Task Index

| Task ID | Name | Phase | Task File | Annotation |
|---|---|---|---|---|
| T1 | `focus_sessions` schema + Kysely types | Phase 1 | [T1-focus-sessions-schema-kysely-types.md](tasks/T1-focus-sessions-schema-kysely-types.md) | [prereq] |
| T2 | Focus session domain core — state machine + active-time math | Phase 1 | [T2-focus-session-domain-core-state-machine-active-time-math.md](tasks/T2-focus-session-domain-core-state-machine-active-time-math.md) | [prereq] |
| T3 | `FOCUS_MODE_ENABLED` flag + client visibility | Phase 1 | [T3-focus-mode-enabled-flag-client-visibility.md](tasks/T3-focus-mode-enabled-flag-client-visibility.md) | [prereq] |
| T15 | Focus audit event type + activity feed exclusion | Phase 2 | [T15-focus-audit-event-type-activity-feed-exclusion.md](tasks/T15-focus-audit-event-type-activity-feed-exclusion.md) | [depends: T3] |
| T4 | Focus session route — read + create | Phase 2 | [T4-focus-session-route-read-create.md](tasks/T4-focus-session-route-read-create.md) | [depends: T1, T2, T3, T15] |
| T5 | Focus session route — lifecycle transitions + optimistic locking | Phase 2 | [T5-focus-session-route-lifecycle-transitions-optimistic-locking.md](tasks/T5-focus-session-route-lifecycle-transitions-optimistic-locking.md) | [depends: T4] |
| T6 | Focus session route — atomic switch | Phase 2 | [T6-focus-session-route-atomic-switch.md](tasks/T6-focus-session-route-atomic-switch.md) | [depends: T5] |
| T7 | Client focus session model — `FocusSessionProvider` + SSE seams | Phase 3 | [T7-client-focus-session-model-focussessionprovider-sse-seams.md](tasks/T7-client-focus-session-model-focussessionprovider-sse-seams.md) | [depends: T6] |
| T14 | Server-side membership revocation finalization | Phase 3 | [T14-server-side-membership-revocation-finalization.md](tasks/T14-server-side-membership-revocation-finalization.md) | [depends: T6, T15] |
| T8 | `FocusTimer` — duration display + lifecycle controls | Phase 3 | [T8-focustimer-duration-display-lifecycle-controls.md](tasks/T8-focustimer-duration-display-lifecycle-controls.md) | [depends: T7] |
| T11 | Global "Focus active" nav indicator | Phase 3 | [T11-global-focus-active-nav-indicator.md](tasks/T11-global-focus-active-nav-indicator.md) | [depends: T7] |
| T12 | Workspace switch guard | Phase 3 | [T12-workspace-switch-guard.md](tasks/T12-workspace-switch-guard.md) | [depends: T7] |
| T9 | `/focus` route + `FocusPage` | Phase 4 | [T9-focus-route-focuspage.md](tasks/T9-focus-route-focuspage.md) | [depends: T8] |
| T13 | Live auto-finish guards — task deleted, access revoked | Phase 4 | [T13-live-auto-finish-guards-task-deleted-access-revoked.md](tasks/T13-live-auto-finish-guards-task-deleted-access-revoked.md) | [depends: T12, T14] [test-risk] |
| T10 | Entry points — "Focus on this task" + confirm-switch | Phase 4 | [T10-entry-points-focus-on-this-task-confirm-switch.md](tasks/T10-entry-points-focus-on-this-task-confirm-switch.md) | [depends: T6, T9] |
