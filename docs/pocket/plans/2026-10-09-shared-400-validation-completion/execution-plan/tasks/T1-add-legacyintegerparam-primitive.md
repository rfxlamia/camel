# Task T1 — Add legacyIntegerParam primitive

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 1: Add legacyIntegerParam primitive [prereq]

## OBJECTIVE
Add `legacyIntegerParam(message)` to `server/src/validators/schemas.ts`: a zod schema that reproduces `Number.isInteger(Number(raw))` EXACTLY so #197 can migrate `Number(req.params.x)` sites without changing behavior. Input type is `unknown` (route params AND `req.query` values, which may be arrays/objects). Output is the `Number(raw)` value.

Steps:
1. Write failing test for: legacy-equivalence of the new schema
   Test file: `server/src/validators/schemas.test.ts` (modify existing)
   Level: unit
   Test intent: Given `legacyIntegerParam("m")`, When parsed with "5", "0", "-1", "1e2", "", " 1" Then it succeeds with `Number(raw)` (5, 0, -1, 100, 0, 1); When parsed with the legacy-lenient values null, [] and true Then it succeeds with 0, 0 and 1 respectively (because `Number(null)`, `Number([])` and `Number(true)` are integers — a deliberate pin of legacy leniency, only reachable via `req.query` or JSON-sourced values; add a code comment saying so); When parsed with the array ["1"] Then it succeeds with 1 (`Number(["1"])` is 1); When parsed with "abc", "1.5", undefined and {} Then it fails with error "m"; and for every sample input the schema outcome equals `Number.isInteger(Number(raw))` (table-driven oracle).
   Exercise through: `parseWith(legacyIntegerParam("m"), raw)` from `validators/http.ts`
   Test doubles: none
   Expected RED: `legacyIntegerParam` is not exported from schemas.ts
2. Run test — verify FAIL: `npm run test --workspace=server -- src/validators/schemas.test.ts`
3. Implement with `z.unknown().transform((v) => Number(v)).refine(Number.isInteger, { error: message })`; run the same command — verify PASS; add a doc comment stating it exists only to keep #197 behavior-preserving and is replaced by `workspaceIdParam` in #198; commit: `feat(server): add legacyIntegerParam to preserve Number.isInteger semantics`

## REFERENCES LOADED
docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md — Rule 1 (#197 behavior-preserving), finding F2; `server/src/validators/schemas.ts` (existing `positiveIdParam`, `workspaceIdParam` patterns, zod v4 `{ error }` option); `server/src/validators/http.ts`.

## WHY THIS APPROACH
Complexity: lightweight
Justification: one pure function in one file with an oracle-style test; no judgment beyond the Number() edge cases already enumerated.

## SANDWICH CONTEXT
[CRITICAL: legacyIntegerParam must accept and reject EXACTLY what `Number.isInteger(Number(raw))` accepts and rejects — never reuse workspaceIdParam/positiveIdParam semantics here]
You are implementing the shared primitive for the #197 migration of the shared-400 validation work.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: zod schemas consumed through `parseWith`; keep migration behavior-preserving.
Files in scope: server/src/validators/schemas.ts, server/src/validators/schemas.test.ts
Available after: none (prereq)
Architecture rule: validators/ is kernel; no imports from modules/.
[RESTATE: legacyIntegerParam must mirror `Number.isInteger(Number(raw))` exactly]

## DELIVERABLE
Given "1e2", When parsed by legacyIntegerParam("m"), Then ok with data 100
Given "" , When parsed, Then ok with data 0
Given "abc", When parsed, Then not ok, body `{ error: "m" }`
Given the array ["1"], When parsed, Then ok with data 1
Given any sample, When compared with `Number.isInteger(Number(raw))`, Then outcomes are identical

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Exported from schemas.ts with a doc comment; type of data is `number`
  - Table-driven oracle test comparing against `Number.isInteger(Number(raw))`
Must-not-have:
  - Digit-regex or `> 0` checks (that is workspaceIdParam's job)
  - Touching any route file
Open question risks:
  - zod v4 `.refine` signature differs from v3 → check how `positiveIdParam` is written in the same file and follow it
Rollback note:
  - Revert the commit; nothing depends on it until T2
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass via the command above, no out-of-scope files modified
Uncertain when: oracle test disagrees on an input the spec did not list
Escalate when: a site needs semantics this schema cannot express
