# Issue #131 folder relocation close — Execution Index

**Date:** 2026-09-19
**Spec:** docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
**Source Plan:** ../execution-plan.md
**source-sha256:** 78ee10ca3e76e100a174abd86b128159c19e6042404cef911a526e0b45e70809
**Total Tasks:** 17
**Total Phases:** 5

---

## Execution Flow

```
T1→T2→T3→T4→T5→T6→T7→T8→T9→T10→T11→T12→T13→T14→T15→T16→T17
```

---

## Phase Summary

- **Phase 1:** [phase-1.md](phase-1.md) — Extract client kernel chrome and cross-cutting files (T1, T2, T3)
- **Phase 2:** [phase-2.md](phase-2.md) — Relocate my-work feature module (T4, T5, T6)
- **Phase 3:** [phase-3.md](phase-3.md) — Relocate agent wave-1 (no BoardContext importers) (T7, T8, T9)
- **Phase 4:** [phase-4.md](phase-4.md) — Relocate focus wave-2 (BoardContext consumers) (T10, T11, T12)
- **Phase 5:** [phase-5.md](phase-5.md) — Relocate settings feature module (T13, T14, T15, T16, T17)

---

## Task Index

| Task ID | Name | Phase | Task File | Annotation |
|---|---|---|---|---|
| T1 | Extract client kernel chrome and cross-cutting files | Phase 1 | [T1-extract-client-kernel-chrome-and-cross-cutting-files.md](tasks/T1-extract-client-kernel-chrome-and-cross-cutting-files.md) | [prereq] |
| T2 | Extract server kernel card-assignees and card-response | Phase 1 | [T2-extract-server-kernel-card-assignees-and-card-response.md](tasks/T2-extract-server-kernel-card-assignees-and-card-response.md) | [depends: T1] |
| T3 | Move auth screens into pages | Phase 1 | [T3-move-auth-screens-into-pages.md](tasks/T3-move-auth-screens-into-pages.md) | [depends: T2] |
| T4 | Relocate my-work feature module | Phase 2 | [T4-relocate-my-work-feature-module.md](tasks/T4-relocate-my-work-feature-module.md) | [depends: T3] |
| T5 | Relocate focus wave-1 (no leftover context importers) | Phase 2 | [T5-relocate-focus-wave-1-no-leftover-context-importers.md](tasks/T5-relocate-focus-wave-1-no-leftover-context-importers.md) | [depends: T4] |
| T6 | Relocate client chat | Phase 2 | [T6-relocate-client-chat.md](tasks/T6-relocate-client-chat.md) | [depends: T5] |
| T7 | Relocate agent wave-1 (no BoardContext importers) | Phase 3 | [T7-relocate-agent-wave-1-no-boardcontext-importers.md](tasks/T7-relocate-agent-wave-1-no-boardcontext-importers.md) | [depends: T6] |
| T8 | Relocate server chat | Phase 3 | [T8-relocate-server-chat.md](tasks/T8-relocate-server-chat.md) | [depends: T7] |
| T9 | Relocate board wave-1 (no ContextPanel) | Phase 3 | [T9-relocate-board-wave-1-no-contextpanel.md](tasks/T9-relocate-board-wave-1-no-contextpanel.md) | [depends: T8 + Hotfix #2] |
| T10 | Relocate focus wave-2 (BoardContext consumers) | Phase 4 | [T10-relocate-focus-wave-2-boardcontext-consumers.md](tasks/T10-relocate-focus-wave-2-boardcontext-consumers.md) | [depends: T9] |
| T11 | Relocate board wave-2 (ContextPanel) | Phase 4 | [T11-relocate-board-wave-2-contextpanel.md](tasks/T11-relocate-board-wave-2-contextpanel.md) | [depends: T10] |
| T12 | Relocate agent wave-2 (BoardContext consumers, stream/sync + llm cluster) | Phase 4 | [T12-relocate-agent-wave-2-boardcontext-consumers-llm-cluster.md](tasks/T12-relocate-agent-wave-2-boardcontext-consumers-llm-cluster.md) | [depends: T11 + Hotfix #2] |
| T13 | Relocate settings feature module | Phase 5 | [T13-relocate-settings-feature-module.md](tasks/T13-relocate-settings-feature-module.md) | [depends: T12] |
| T14 | Relocate workspaces feature module | Phase 5 | [T14-relocate-workspaces-feature-module.md](tasks/T14-relocate-workspaces-feature-module.md) | [depends: T13] |
| T15 | Relocate notifications feature module | Phase 5 | [T15-relocate-notifications-feature-module.md](tasks/T15-relocate-notifications-feature-module.md) | [depends: T14] |
| T16 | Relocate activity feature module | Phase 5 | [T16-relocate-activity-feature-module.md](tasks/T16-relocate-activity-feature-module.md) | [depends: T15] |
| T17 | Relocate auth module and close #131 | Phase 5 | [T17-relocate-auth-module-and-close-131.md](tasks/T17-relocate-auth-module-and-close-131.md) | [depends: T16] |
