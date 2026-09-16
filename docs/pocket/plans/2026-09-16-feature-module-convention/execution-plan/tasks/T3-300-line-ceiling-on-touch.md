# Task T3 — 300-line ceiling on touch

**Phase:** 1
**Depends:** T2
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 3: 300-line ceiling on touch [depends: T2] [test-risk]

## OBJECTIVE
Fail new source files over 300 raw lines; fail non-trivial modifications of currently oversized source files unless the result is ≤300; exempt pure git rename, whitespace/format-only, import-specifier-only, tests, generated, and untouched files.

Files:
- Create: `scripts/feature-modules/line-budget.mjs`
- Create: `scripts/feature-modules/line-budget.test.mjs`
- Modify: `scripts/check-feature-modules.mjs`

Steps:
1. Write failing test for: non-trivial edit of oversized file without shrink
   Test file: `scripts/feature-modules/line-budget.test.mjs`
   Level: unit

   Test intent:
   Given a source file whose current (merge-base) line count is 999 and the PR hunk changes a handler body
   When the line-budget checker runs
   Then:
   - it reports a 300-on-touch violation with rule id, path, and line count if the result is still >300

   Exercise through:
   - exported `checkLineBudget({ path, status, beforeText, afterText, hunks })`

   Test doubles:
   - mock/fake: git show / diff hunks (inject strings)
   - do NOT mock: line-count and touch-classification logic

   Expected RED:
   - `line-budget.mjs` does not exist

2. Run test — verify FAIL:
   `node --test scripts/feature-modules/line-budget.test.mjs`
   Expected failure: ERR_MODULE_NOT_FOUND for `./line-budget.mjs`

3. Implement minimal code to satisfy the test:
   File: `scripts/feature-modules/line-budget.mjs`
   Implement: raw newline count; non-trivial touch + after >300 → violation.
   Wire into `scripts/check-feature-modules.mjs`.

4. Run test — verify PASS:
   `node --test scripts/feature-modules/line-budget.test.mjs`
   Expected: PASS

Additional TDD cycles (same test file and command):

Cycle A — extract success:
1. Given oversized file extracted so afterText has ≤300 lines, When checked, Then no 300-on-touch violation
2. FAIL (always-fail on any oversized before) then implement then PASS

Cycle B — new file 301 lines:
1. Given status new and afterText has 301 lines, When checked, Then fail; Given new test file `*.test.ts` with 800 lines, When checked, Then 300 rule does not apply
2. FAIL then implement new-file ceiling + test exclusion then PASS

Cycle C — rename:
1. Given status rename, identical content, 521 lines, When checked, Then no 300-new-file violation; Given rename plus body edit leaving >300 lines, Then fail
2. FAIL then implement then PASS

Cycle D — non-touches:
1. Given whitespace/format-only hunks on a 492-line file, When checked, Then no 300-on-touch violation; Given import-specifier-only hunks on a 999-line file, Then no 300-on-touch violation
   Expected RED: exemptions not implemented
2. FAIL then implement exemptions then PASS

Cycle E — exemption negatives and line-count edges:
1. Given a mixed hunk that changes an import specifier AND a body line, When checked, Then it IS a touch; Given a new import plus a new call site, Then it IS a touch; Given a comment-only change, Then it IS a touch; Given afterText has exactly 300 lines, Then pass; Given 301 lines with no trailing newline, Then fail; Given `foo.generated.ts` or a path containing `/generated/`, Then 300 rule does not apply
   Expected RED: heuristic too loose or generated glob undefined
2. FAIL then implement then PASS

Cycle F — hunk producer + CLI grandfather:
1. Given a temp git repo, When the production `git show <base>:<path>` / `git diff -U0` path builds beforeText and hunks (rename uses the old path), Then checkLineBudget sees the same classification as Cycle D/E; Given BoardContext.tsx is unmodified in that repo, When the CLI runs, Then no 300 violation for it (dispatcher does not invent a touch)
   Level: integration
   Exercise through: CLI + real git (do not pass pre-built hunks in this cycle)
   Test doubles: none
   Expected RED: line-budget only accepts injected hunks; no git-show path
2. FAIL then implement then PASS

Cycle G — CLI exit 1 for 300:
1. Given a temp git repo with a new 301-line module file, When the CLI runs with `--root` / `--base-ref`, Then exit 1 and stderr includes 300 rule id, path, and line count
   Expected RED: 300 module not wired into dispatcher
2. FAIL then wire then PASS

5. Refactor while green (bounded):
   - Rule of three: same logic appears 3+ times in the files in scope → extract a named, domain-scoped helper — never a generic `utils.ts`
   - A modified file crosses ~300 lines, or a function exceeds ~50 lines → split/extract
   - Refactor only within task-scope files plus helper files declared in the file map
   - Re-run test: `node --test scripts/feature-modules/line-budget.test.mjs` — must stay PASS
   - The auditor judges the refactor heuristics from the diff; no implementer self-report is required or accepted. A diff violating none of the thresholds proceeds to commit

6. Commit:
   `git add scripts/feature-modules/line-budget.mjs scripts/feature-modules/line-budget.test.mjs scripts/check-feature-modules.mjs`
   `git commit -m "feat(architecture): enforce 300-line budget on touched source files"`

## REFERENCES LOADED
docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md — Rule 300-on-touch GWT
scripts/feature-modules/git-diff.mjs — (T1) rename vs modified
scripts/check-feature-modules.mjs — dispatcher to extend

## WHY THIS APPROACH
Justification: Touch classification + git rename is the spec’s discriminating behavior; isolated module keeps T4 from rewriting it.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Convention PR must not modify BoardContext.tsx; untouched oversized files stay grandfathered.]
You are implementing the 300-line ceiling for Feature-module directory convention.
Spec: docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md
Design decision: Option A — single Node guard; raw LF newline counts.
Files in scope: scripts/feature-modules/line-budget.mjs, scripts/feature-modules/line-budget.test.mjs, scripts/check-feature-modules.mjs — no other files
Test framework: Node 22 `node --test`
Available after: T2 (CLI already classifies new files)
Architecture rule: No new npm deps; do not hit a real GitHub remote; tests inject diffs.
[RESTATE: Convention PR must not modify BoardContext.tsx; untouched oversized files stay grandfathered.]

## DELIVERABLE
Verification — task is DONE when all pass:

Given a 999-line source file with a non-trivial body hunk still >300 after, When checked, Then 300-on-touch failure with rule id, path, and line count
Given extract so the leftover file is ≤300 lines, When checked, Then pass
Given status new and 301 source lines, When checked, Then fail
Given an 800-line `*.test.ts`, When checked, Then 300 rule does not apply
Given pure rename of a 521-line file (identical content), When checked, Then 300-new-file does not fail
Given rename plus body edit still >300, When checked, Then fail
Given whitespace/format-only or import-specifier-only hunks, When checked, Then 300-on-touch does not fire
Given BoardContext.tsx is not in the diff, When the guard runs, Then no 300 violation for that file
[must-not] Given only formatting on an oversized file, When checked, Then system must NOT require a split

All tests PASS. Commit exists with message matching `feat(architecture): enforce 300-line budget on touched source files`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Test files and generated files excluded from 300
  - Tests written BEFORE implementation (TDD — not after)
  - Rule of three enforced — no logic left duplicated 3+ times in the files in scope (enforcement verified by the auditor from the diff, not asserted by the implementer)
  - Commit message follows conventional commits format

Must-not-have:
  - Splitting BoardContext or cards.ts in this task
  - Skipping the failing test step
  - Modifications to files outside the listed scope
  - Calling the real `origin/main` network; use injected git metadata

Open question risks:
  - CRLF vs LF → assumed LF; if counts disagree report NEEDS_CONTEXT
  - Import-specifier-only detection too loose/strict → report NEEDS_CONTEXT if tests cannot distinguish from logic edits

Rollback note:
  - Revert this commit; placement from T2 remains

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: import-path-only heuristic cannot be made deterministic
Escalate when: implementation starts extracting production god files to go green
