# Task T8 — Relocate server chat

**Phase:** 3
**Depends:** T7
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 8: Relocate server chat [depends: T7]

## OBJECTIVE
`git mv` leftover `server/src/chat/**` into `server/src/modules/chat/` with public `index.ts`. Those files import `modules/agent` index only (tools, prompt-sanitizer, artifact, rate-limits — not leftover `server/src/agent/`). Leftover `llm.ts` retargets `runChatTurn` to the chat index (leftover → module is allowed). Do not move `llm.ts`. Client chat already lives under `features/chat/` from T6; extend or add `modules/chat/index.ts` as the server public API. `ChatPage.tsx` stays in pages/.

Files:
- Create: `server/src/modules/chat/index.ts` and bodies from `server/src/chat/**`
- Modify: leftover `server/src/agent/llm.ts` (`runChatTurn` via modules/chat index), `server/src/index.ts` (chat router mount), `scripts/feature-modules/git-diff.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: [derived] server chat relocates after agent index exists
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given leftover `server/src/chat/routes.ts` still exists and `server/src/modules/agent/index.ts` exists
   When Cycle Map is evaluated
   Then:
   - `server/src/modules/chat/index.ts` exists
   - leftover `server/src/chat/routes.ts` is gone
   - leftover `server/src/agent/llm.ts` **still exists**

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `server/src/modules/chat/index.ts` does not exist until this packet

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `server/src/modules/chat/index.ts`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: `git mv` server chat; index with `.js`; module files import `modules/agent` index only (not leftover `server/src/agent/`); leftover `llm.ts` imports chat index; do not move llm.ts, routes.ts (agent), or a second FEATURES name; specifier-only

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=server -- src/modules/chat`

5. Refactor while green (bounded):
   - Do not split fat files; revert format hunks
   - Re-run: `npm run test:feature-modules`

6. Commit:
   `git commit -m "refactor(chat): relocate server chat after agent tools"`
   PR: `refs #131`

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — one FEATURES name per PR; one-way wall
server/src/chat/run-chat-turn.ts — imports agent tools/prompt-sanitizer; cannot move until agent index exists
server/src/agent/llm.ts — imports runChatTurn; stays leftover until agent wave-2

## WHY THIS APPROACH
Justification: Same chat FEATURES name as T6, second PR. Unblocks leftover llm.ts without combining chat+agent names.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Import modules/agent index only; do not import leftover server/src/agent/; do not move llm.ts]
You are implementing T8 server chat relocate for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A plus chat/agent wave split
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest workspace-scoped
Available after: T7
Architecture rule: module → other module index only; leftover llm.ts may import the chat index
[RESTATE: Import modules/agent index only; do not import leftover server/src/agent/; do not move llm.ts]

## DELIVERABLE
[derived] Given leftover server chat imports leftover agent tools, When the agent index already exists and this packet git-mvs server chat into modules/chat, Then check:feature-modules passes, leftover llm.ts imports the chat index, and ChatPage stays in pages/

All tests PASS. Commit exists with message matching `refactor(chat): relocate server chat after agent tools`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map server chat home
  - leftover llm.ts still present
  - One-way wall green
  - PR `refs #131`

Must-not-have:
  - Moving llm.ts or agent routes
  - A second FEATURES name
  - `closes #131`
  - Logic changes in run-chat-turn

Rollback note:
  - Revert this PR

## STOP CONDITIONS
Done when: Cycle Map and server chat tests pass
Uncertain when: a server chat file still needs a leftover agent import after specifier retarget
Escalate when: one-way fails unless agent llm.ts is moved in this PR
