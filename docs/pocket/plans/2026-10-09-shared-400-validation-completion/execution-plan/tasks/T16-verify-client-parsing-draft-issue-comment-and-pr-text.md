# Task T16 — Verify client parsing; draft issue comment and PR text

**Phase:** 5
**Depends:** T14, T15
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 16: Verify client parsing; draft issue comment and PR text [depends: T14, T15]

## OBJECTIVE
Acceptance criteria: "Client still parses every changed body (`client/src/api.ts` `throwRequestError`)" and "Both open questions answered in this issue" (#198). Add client TESTS only (no client source change), run the client audit, and DRAFT (do not post) the #198 issue comment and the PR-5 description in the task report.

Steps:
1. Write characterization test for: error parsing of the changed bodies
   Test file: `client/src/api.test.ts` (modify; follow how it already fakes `fetch`)
   Level: unit
   Test intent: Given a 400 `Response` with JSON `{ error: "workspaceId must be an integer" }`, then `{ error: "Username must be 3-32 characters: letters, numbers, underscore." }`, then `{ error: "Invalid params" }`, then `{ error: "x", fieldErrors: { assigneeIds: "assigneeIds must be an array of integers" } }` When a public `api` method that calls `throwRequestError` receives it Then the thrown error message equals the body's `error` and `fieldErrors` is preserved where that method exposes it.
   Exercise through: the public `api` method that calls `throwRequestError` (`throwRequestError` itself is NOT exported — `client/src/api.ts:110`; use the method at ~`api.ts:177`)
   Test doubles: fake `fetch`/`Response`; no network
   Expected RED: characterization — passes on current code by design; prove live with a one-string mutation.
2. Run: `npm run test --workspace=client -- src/api.test.ts` — verify PASS
3. Audit (no code change): `grep -rn "workspaceId" client/src/api.ts client/src/lib/workspaceSwitcher.ts` and `grep -rnE "api\.\w+\(.*[Ww]orkspace" client/src | head -50`; confirm every workspace id placed in a URL is a numeric id from state (never free text, empty string or `0`). Run `npm run test --workspace=client` (full) — verify PASS. Commit: `test(client): pin error parsing for unified 400 bodies`
4. Draft (in your final report, NOT committed to the repo): (a) the PR-5 description listing every behavior/wording change from T14 and T15 (lenient->strict workspace routes, my-work `positive integer` -> `an integer`, split `Invalid params`, oauth username dash, tests updated) plus the audit commands and result; (b) the #198 issue comment recording the approved answers (F1: create already rejects non-integer ids, so no 201->400 change; the Rule 6 wording table). Do NOT run `gh issue comment` — posting is outward-facing; return the text to the orchestrator, who asks the user first.

## REFERENCES LOADED
Spec — AC "Client still parses every changed body", Open Questions row on lenient workspace ids, Rule 6; #198 AC1; `client/src/api.ts`, `client/src/api.test.ts`.

## WHY THIS APPROACH
Complexity: lightweight
Justification: client tests only, a documented grep audit, and drafted text.

## SANDWICH CONTEXT
[CRITICAL: Do NOT modify client source files and do NOT post to GitHub — tests, audit and drafts only; if the audit finds a lenient workspace id in client code, STOP and report]
You are implementing the client verification and the closing documentation for #198 PR-5.
Spec: docs/pocket/spec/2026-10-09-shared-400-validation-completion/shared-400-validation-completion.md
Design decision: server-only change; the client is verified, not edited.
Files in scope: client/src/api.test.ts
Available after: T14, T15
Architecture rule: client uses bundler resolution (no import extensions); `noUnusedLocals` — no unused imports.
[RESTATE: No client source edits; no GitHub posting; report lenient client ids instead of fixing them]

## DELIVERABLE
Given each changed 400 body, When the public `api` method handles it, Then the thrown message equals the body's `error`
Given the audit, When complete, Then the report states the commands run and that no client path sends non-digit, empty or zero workspace ids (or lists exceptions)
Given the drafts, When returned, Then they list every wording/behavior change and the approved answers
Given the full client suite, When run, Then it passes

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Drafts cover every T14/T15 change
Must-not-have:
  - Client source edits
  - `gh issue comment` / any GitHub write
  - Using `-t "multi word"` filters
Open question risks:
  - Audit finds a lenient client workspace id → report NEEDS_CONTEXT; PR-5 tightening commit (T14 (b)) may need to be dropped
Rollback note:
  - Revert the test commit
Red flags:
  - Work outside listed files → DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: DELIVERABLE scenarios pass, no out-of-scope files modified
Uncertain when: no public `api` method surfaces `fieldErrors` for the test
Escalate when: the audit finds a client path that the tightening would break
