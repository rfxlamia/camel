# Task T10 — Wire the guard into package.json, Makefile, CI and CLAUDE.md

**Phase:** 3
**Depends:** T9
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 10: Wire the guard into package.json, Makefile, CI and CLAUDE.md [depends: T9]

## OBJECTIVE
Make the guard run everywhere the sibling guards run, test the wiring, and document the rule.

Steps:
1. Write failing test for: wiring
   Test file: `scripts/check-inline-400.wiring.test.mjs` (new; `node --test`)
   Level: unit (file content assertions)
   Test intent: Given the repository files, When read Then: `package.json` has script `check:inline-400` running `node scripts/check-inline-400.mjs` and a script `test:guards` running `node --test scripts/*.test.mjs`, and the root `test` script invokes `test:guards`; `Makefile` target `check` contains `$(NPM) run check:inline-400`; `.github/workflows/ci.yml` contains a step `npm run check:inline-400` in the primary job; `CLAUDE.md` "Request validation" paragraph mentions `check:inline-400` (assert only this; do not assert on removed prose).
   Exercise through: reading the four files (follow `scripts/feature-modules/wiring.test.mjs`)
   Test doubles: none
   Expected RED: none of the wiring exists yet
2. Run test — verify FAIL: `node --test scripts/check-inline-400.wiring.test.mjs`
3. Edit the four files; replace the CLAUDE.md sentence "Migrate remaining inline 400s incrementally; do not `closes #117` until done." with the guard rule (a new inline `res.status(400)` in `server/src/**` fails `make check`/CI; only `validators/http.ts` may send 400). Run `node --test scripts/*.test.mjs`, then `make check` — verify PASS. Commit: `chore(ci): wire inline 400 guard into make check and CI`

## REFERENCES LOADED
Spec — scenario "Wired everywhere", AC "Guard runs in make check and CI", "CLAUDE.md documents the rule"; `package.json`, `Makefile`, `.github/workflows/ci.yml` (lines ~37–41), `CLAUDE.md` ("Request validation (issue #117)"), `scripts/feature-modules/wiring.test.mjs`.

## WHY THIS APPROACH
Complexity: lightweight
Justification: four small config edits plus a content-assertion test.

## SANDWICH CONTEXT
[CRITICAL: Do not change what existing guards run; only add the new guard and its test script]
You are implementing the wiring for the #199 guard.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: guard + `test:guards` chain; CLAUDE.md edit confined to the "Request validation" paragraph.
Files in scope: package.json, Makefile, .github/workflows/ci.yml, CLAUDE.md, scripts/check-inline-400.wiring.test.mjs
Available after: T9
Architecture rule: keep step order in ci.yml (guards before lint/typecheck/test); tabs in Makefile.
[RESTATE: Only add the new guard; leave existing guard wiring untouched]

## DELIVERABLE
Given `make check`, When run, Then it executes `check:inline-400` and passes
Given ci.yml, When read, Then it has the `check:inline-400` step in the primary job
Given `npm test`, When run, Then guard tests run via `test:guards`
Given CLAUDE.md, When read, Then the rule is documented and the "migrate incrementally" sentence is gone

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Wiring test green; `make check` green
Must-not-have:
  - Edits to other CLAUDE.md sections
  - Reordering existing CI steps
Open question risks:
  - `node --test scripts/*.test.mjs` also picks up `scripts/feature-modules/*` → it must not (glob is single-level); verify it only matches the new file(s)
Rollback note:
  - Revert the commit; guard script remains but unwired
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: `make check` fails for an unrelated pre-existing reason
Escalate when: the root `test` chain cannot include `test:guards` without breaking CI
