# Task T9 — Add the guard CLI, tree walk and allowlist

**Phase:** 3
**Depends:** T8
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 9: Add the guard CLI, tree walk and allowlist [depends: T8]

## OBJECTIVE
Extend `scripts/check-inline-400.mjs` with a CLI: walk `server/src/**/*.ts`, skip files `*.test.ts`, `*.test-support.ts`, `*.d.ts` and any `__tests__/` directory, apply `scanSource` to the rest, allow ONLY `server/src/validators/http.ts`, print one `path:line` per violation (repo-relative, forward slashes), and exit 1 on any violation, 0 otherwise. Support `--root <dir>` (the directory containing `server/src`) so tests can use temp trees. No baseline mechanism.

Steps:
1. Write failing test for: CLI and walk behavior
   Test file: `scripts/check-inline-400.test.mjs` (modify)
   Level: integration (temp directories + `spawnSync`, same style as `scripts/feature-modules/wiring.test.mjs`)
   Test intent: Given a temp root with a clean `server/src` Then the CLI exits 0; Given `server/src/modules/board/foo.ts` containing `res.status(400).json({ error: "x" })` Then exit 1 and stdout contains `server/src/modules/board/foo.ts:<line>`; Given the same text in `foo.test.ts`, `foo.test-support.ts`, `foo.d.ts` and `__tests__/foo.ts` Then exit 0; Given the text in `server/src/validators/http.ts` Then exit 0, but in `server/src/validators/other.ts` Then exit 1; Given a missing `server/src` under `--root` Then exit 1 with an explanatory message. Given the real repository root with no arguments Then exit 0 (proves PR-1 and PR-2 left zero violations).
   Exercise through: `spawnSync("node", ["scripts/check-inline-400.mjs", "--root", tmp])`
   Test doubles: none — real temp directories
   Expected RED: the script has no CLI/walk yet (exits 0 silently or does nothing)
2. Run test — verify FAIL: `node --test scripts/check-inline-400.test.mjs`
3. Implement; run the same command — verify PASS; run `node scripts/check-inline-400.mjs` — verify exit 0 on the real tree. Commit: `feat(scripts): add inline 400 guard cli`

## REFERENCES LOADED
Spec — guard scenarios "Clean tree passes", "New inline 400 fails", "Tests and declaration files skipped", AC "allowlist only validators/http.ts"; `scripts/check-event-write-routing.mjs` (walk/skip/report/exit pattern), `scripts/feature-modules/wiring.test.mjs`.

## WHY THIS APPROACH
Complexity: standard
Justification: filesystem walk plus CLI semantics tested through real temp trees.

## SANDWICH CONTEXT
[CRITICAL: Allowlist is exactly `server/src/validators/http.ts`; the guard MUST pass on the real tree; never add allowlist entries to make it pass]
You are implementing the CLI half of the #199 guard.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: AST detector from T8; empty baseline.
Files in scope: scripts/check-inline-400.mjs, scripts/check-inline-400.test.mjs
Available after: T8
Architecture rule: plain ESM `.mjs`; same output/exit conventions as the sibling check-* scripts.
[RESTATE: Allowlist = validators/http.ts only; real tree passes]

## DELIVERABLE
Given a deliberate `res.status(400)` in a non-test route file, When the guard runs, Then exit 1 naming file:line
Given tests/declaration files, When scanned, Then skipped
Given validators/http.ts, When scanned, Then allowed; any other validators file is flagged
Given the real repository, When the guard runs, Then exit 0

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `node --test scripts/check-inline-400.test.mjs` green; real-tree run exits 0
  - A header comment noting the walk/skip logic intentionally mirrors `check-event-write-routing.mjs` (this is the third `walk()`/skip copy after `check-event-write-routing.mjs` and the `check-work-item-mutation-routing.mjs` / `check-feature-modules.mjs` family — those scripts run their CLI at import time and cannot be imported; extracting `scripts/lib/walk.mjs` is deferred)
Must-not-have:
  - Any allowlist entry beyond validators/http.ts
  - Baseline/ratchet file
Open question risks:
  - Real tree reports a violation outside the 11 listed files → report it; do not allowlist
Rollback note:
  - Revert the commit; T8 detector stays
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS
  - Guard fails on the real tree → a #197 site was missed

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: a real-tree violation appears in an unexpected file
Escalate when: passing requires any allowlist entry other than validators/http.ts
