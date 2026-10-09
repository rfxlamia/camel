# Task Field Tags for Create Flows — Client create and field-error contracts (Phase 1 of 3)

**Date:** 2026-09-02
**Original plan:** ../execution-plan.md
**Prerequisite:** None (first phase)
**Contains tasks:** {T1, T3, T2, T6, T7}
**Unlocks next:** Phase 2

---

## Task List

Total: 5 tasks | Prerequisite phases must be complete before starting

- **T1:** Client create and field-error contracts [prereq] → [tasks/T1-client-create-and-field-error-contracts.md](tasks/T1-client-create-and-field-error-contracts.md)
- **T3:** Transactional task metadata validation and workspace lock primitives [prereq] → [tasks/T3-transactional-task-metadata-validation-and-workspace-lock-primitives.md](tasks/T3-transactional-task-metadata-validation-and-workspace-lock-primitives.md)
- **T2:** Shared task metadata draft reducer [depends: T1] → [tasks/T2-shared-task-metadata-draft-reducer.md](tasks/T2-shared-task-metadata-draft-reducer.md)
- **T6:** Atomic Board card creation backend [depends: T3] [test-risk] → [tasks/T6-atomic-board-card-creation-backend.md](tasks/T6-atomic-board-card-creation-backend.md)
- **T7:** Strict Tracker item creation backend [depends: T3] [parallel: T6] [test-risk] → [tasks/T7-strict-tracker-item-creation-backend.md](tasks/T7-strict-tracker-item-creation-backend.md)

---

## Execution Notes

**Test command form.** Every RED, PASS, baseline, and packet-suite command in this phase is workspace-scoped. The repo root `test` script is `npm run test --workspace=server && npm run test --workspace=client`, so a root-level `npm run test -- <path>` runs the *entire* server suite and then applies the path to the client workspace with the wrong cwd. npm also swallows a bare `-t` as an unknown config, and strips one level of quoting from its value. The form that works, verified in this repo:

```bash
npm run test --workspace=server -- src/routes/tracker-item-parsers.test.ts -t "\"rejects a non-integer priorityId\""
#   Tests  1 passed | 21 skipped (22)
```

Both the inner escaped quotes and the workspace-relative path are required. Getting either wrong is a *silent* failure: vitest exits 0 having run zero tests, which reads as a passing RED.

`-t` matches as a **regular expression**, not a literal substring. Scenario names in this plan are plain text and match as written, with one exception already escaped in T4 (`Shift\+Tab`). If a new scenario name is introduced containing `( ) [ ] { } . * + ? ^ $ |` or a backslash, escape those characters in the command or the pattern will silently select nothing.

Before trusting any RED, confirm the run reports a non-zero count of executed tests. `Tests  N skipped (N)` with nothing passed or failed means the filter matched nothing — it is not a red test.

**T6 ‖ T7 share one PostgreSQL.** Both are `[test-risk]`, both run `RUN_INTEGRATION=1` suites, and T3's lock primitives take `FOR UPDATE` row locks on `workspaces`. The repo's own integration script (`server/package.json` → `test:integration:routes`) uses `--no-file-parallelism` for exactly this reason, so every integration command in this phase now carries that flag. If T6 and T7 are dispatched to concurrent agents, they must additionally either be serialized at the integration-suite step or given separate `DATABASE_URL` values. Do not treat a flaky lock-contention failure as a genuine RED.

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass — verified by observing a non-zero passed count, not merely exit code 0
- `npm run typecheck` passes at repo root (guards T3's additive `parseDateRange` contract against out-of-scope callers)
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 2 ONLY after this gate passes.
