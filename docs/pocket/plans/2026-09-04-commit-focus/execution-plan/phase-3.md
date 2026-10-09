# Commit Focus (Personal Focus Mode) — Client focus session model — `FocusSessionProvider` + SSE seams (Phase 3 of 4)

**Date:** 2026-09-04
**Original plan:** ../execution-plan.md
**Prerequisite:** Phase 2 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T7, T14, T8, T11, T12}
**Unlocks next:** Phase 4

---

## Task List

Total: 5 tasks | Prerequisite phases must be complete before starting

- **T7:** Client focus session model — `FocusSessionProvider` + SSE seams [depends: T6] → [tasks/T7-client-focus-session-model-focussessionprovider-sse-seams.md](tasks/T7-client-focus-session-model-focussessionprovider-sse-seams.md)
- **T14:** Server-side membership revocation finalization [depends: T6] → [tasks/T14-server-side-membership-revocation-finalization.md](tasks/T14-server-side-membership-revocation-finalization.md)
- **T8:** `FocusTimer` — duration display + lifecycle controls [depends: T7] → [tasks/T8-focustimer-duration-display-lifecycle-controls.md](tasks/T8-focustimer-duration-display-lifecycle-controls.md)
- **T11:** Global "Focus active" nav indicator [depends: T7] → [tasks/T11-global-focus-active-nav-indicator.md](tasks/T11-global-focus-active-nav-indicator.md)
- **T12:** Workspace switch guard [depends: T7] → [tasks/T12-workspace-switch-guard.md](tasks/T12-workspace-switch-guard.md)

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- An **unfiltered** root `npm run test` passes — not a path- or `-t`-filtered run. A filtered command in this repo can exit 0 having run zero tests, so only the unfiltered root run closes this gate
- `npm run typecheck` passes
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

### Test command conventions (repo-specific — do not deviate)

Single-file runs must be workspace-scoped **and** workspace-relative:

- client: `npm run test --workspace=client -- src/<path>`
- server: `npm run test --workspace=server -- src/<path>`

`npm run test -- client/src/<path>` from the repo root does **not** filter: the root script is `A && B`, so npm appends the path to the *client* command only, the server suite runs unfiltered, and the client run exits 1 with `No test files found` — an exit code indistinguishable from a genuine RED.

Never quote a multi-word `-t` filter. npm strips the quotes, vitest receives `-t <first-word>` plus stray positional filters, and the run can report `Tests N skipped (N)` at **exit 0** — a green gate that ran nothing. Use a regex dot for each space (`-t card.deleted.fans.out`) or run the whole file.

Hand off to Phase 4 ONLY after this gate passes.
