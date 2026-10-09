# Task T0 — Test-command preflight

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 0: Test-command preflight [prereq]

## OBJECTIVE

Make single-file server test commands deterministic before any feature task
starts. Change only the server test script from `vitest run --silent` to
`vitest run --silent=true`; the explicit boolean prevents Vitest from
consuming the positional path as the value of `--silent`.

Files:
- Modify: `server/package.json`
- Test: existing `server/src/core/position.test.ts` as the command smoke test

Steps:

1. Record the baseline command behavior:

   ```text
   npm run test --workspace=server -- src/core/position.test.ts
   ```

   With the current script, verify that the positional path is not bounded to
   the requested file because `--silent` consumes it. Do not treat the broad
   run as feature evidence.

2. Change `server/package.json` exactly to:

   ```json
   "test": "vitest run --silent=true"
   ```

3. Run the same command again and verify that Vitest discovers only
   `src/core/position.test.ts` and exits successfully. The command must not
   invoke the client workspace.

4. Commit the bounded configuration change:

   ```text
   git add server/package.json
   git commit -m "fix(test): preserve server single-file test paths"
   ```

## REFERENCES LOADED

`package.json`, `server/package.json`, and the repository test conventions in
`AGENTS.md`.

## WHY THIS APPROACH

The existing root script runs both workspaces and the server script's bare
`--silent` consumes a path argument. Fixing the script once makes every later
TDD command reviewable and avoids false green/red results.

## SANDWICH CONTEXT

[CRITICAL: Use workspace-specific commands for every single-file test. Do not
use `npx vitest` directly and do not restore bare `--silent`.]

## DELIVERABLE

The server test script is `vitest run --silent=true`, and the smoke command
selects only the requested server test file.

## QUALITY BAR

- No source or test behavior changes.
- The smoke command has a bounded file list and passes.
- Conventional commit message.

## STOP CONDITIONS

Escalate if npm/Vitest still interprets the positional path as a flag value
after the exact script change; do not alter feature tasks to compensate.
