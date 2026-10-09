# Task T8 — Implement inline-400 AST detection (scanSource)

**Phase:** 3
**Depends:** T5, T6, T7
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 8: Implement inline-400 AST detection (scanSource) [depends: T5, T6, T7]

## OBJECTIVE
Create `scripts/check-inline-400.mjs` exporting `scanSource(text, relPath)` which returns `[{ line }]` (1-based line of the `.status`/`.sendStatus`/`.writeHead` token) for inline 400 sends, using the TypeScript compiler API (`typescript` resolves from the repo root). Flag a CallExpression whose callee is a property access (or string-literal element access) named `status`, `sendStatus` or `writeHead` and whose first argument is the numeric literal `400`. Comments and string/template literals are ignored because detection is AST-based. Dynamic codes (`res.status(code)`) are intentionally NOT flagged — say so in the file header. The CLI/walk comes in T9; in this task the file only exports `scanSource` (guarded so importing it does not execute the CLI).

Steps:
1. Write failing test for: detection rules
   Test file: `scripts/check-inline-400.test.mjs` (new; `node --test`)
   Level: unit
   Test intent: Given source strings, When passed to `scanSource` Then: `res.status(400).json({})` is flagged with the right line; multiline `res\n  .status(\n    400\n  )` is flagged at the `.status` token line; `res.sendStatus(400)` is flagged; `res.writeHead(400, {})` is flagged; `res["status"](400)` is flagged; `status(400)` appearing only inside a `//` comment, a block comment, a string literal or a template literal is NOT flagged; `res.status(404)`, `res.status(code)` and `res.status(400 + 1)` are NOT flagged; two violations in one file yield two results with distinct lines. Also Given the test environment, When `import("typescript")` is attempted from `scripts/check-inline-400.test.mjs` Then it resolves and exposes `createSourceFile` (documents that the guard relies on the hoisted workspace `typescript`; if this ever fails in CI, add `typescript` to the root `devDependencies` — report NEEDS_CONTEXT first).
   Exercise through: the exported `scanSource`
   Test doubles: none
   Expected RED: `scripts/check-inline-400.mjs` does not exist
2. Run test — verify FAIL: `node --test scripts/check-inline-400.test.mjs`
3. Implement `scanSource`; run the same command — verify PASS. Commit: `feat(scripts): add inline 400 AST detector`

## REFERENCES LOADED
Spec — Rule 2, guard scenarios ("Multiline forms are caught", "Alternate APIs are banned", "Comments and strings do not trip it"), Design Decision (AST chosen); `scripts/check-event-write-routing.mjs` (existing guard style); `server/package.json` (typescript ^5.7.2 resolved from root node_modules).

## WHY THIS APPROACH
Complexity: standard
Justification: AST traversal with several edge forms; each form needs its own test.

## SANDWICH CONTEXT
[CRITICAL: Detection is literal-400 only and AST-based; no regex over raw text, no per-file baseline mechanism]
You are implementing the detector half of the #199 guard.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: TypeScript AST; fallback to a comment/string-stripped regex only if `typescript` cannot be imported from `scripts/` (then report NEEDS_CONTEXT first).
Files in scope: scripts/check-inline-400.mjs, scripts/check-inline-400.test.mjs
Available after: T5, T6, T7 (the #197 migrations)
Architecture rule: plain ESM `.mjs`, no new dependencies, importable without side effects.
[RESTATE: Literal 400 only, AST-based, no baseline mechanism]

## DELIVERABLE
Given `res.status(400)`, multiline `.status(\n400)`, `sendStatus(400)`, `writeHead(400`, `res["status"](400)`, When scanned, Then each is flagged with line numbers
Given the same text only in comments or strings, When scanned, Then nothing is flagged
Given `status(404)`, `status(code)`, `status(400 + 1)`, When scanned, Then nothing is flagged

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Every rule above has a test; `node --test scripts/check-inline-400.test.mjs` is green
  - Header comment documenting the dynamic-code limitation
Must-not-have:
  - Baseline/ratchet file or per-file counts
  - Flagging 404/409/500
  - New npm dependencies
Open question risks:
  - `import("typescript")` fails from `scripts/` in CI (workspace hoisting) → report NEEDS_CONTEXT with the resolution error
Rollback note:
  - Delete the two files; nothing references them until T9/T10
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: a legitimate call shape is neither flagged nor documented as ignored
Escalate when: `typescript` cannot be imported from `scripts/`
