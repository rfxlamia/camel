# Task T12 — Relocate agent wave-2 (BoardContext consumers + llm cluster)

**Phase:** 4
**Depends:** T11 + Hotfix #2 (shared agent workspace-reset helper)
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 12: Relocate agent wave-2 (BoardContext consumers, stream/sync + llm cluster) [depends: T11 + Hotfix #2]

## OBJECTIVE
`git mv` remaining agent files that import leftover `BoardContext`, the deferred stream/sync helpers, **and** the leftover llm cluster into `client/src/features/agent/` / `server/src/modules/agent/` and extend the public indexes. Client files import `features/board` index only. `llm.ts` imports `modules/chat` index only (not leftover `server/src/chat/`). Do not close #121. Agent/History pages stay in pages/. Hotfix #2 must be complete before this task starts.

Files:
- Create: `client/src/features/agent/AgentCardDetail.tsx`, `client/src/features/agent/AgentCardDetail.test.tsx`, `client/src/features/agent/useAgentBoard.ts`, `client/src/features/agent/agentStream.ts`, `client/src/features/agent/agentStream.test.ts`, `client/src/features/agent/agentBoardSync.ts`, `client/src/features/agent/agentBoardSync.test.ts`, `server/src/modules/agent/llm.ts`, `server/src/modules/agent/llm.test.ts`, `server/src/modules/agent/routes.ts`, `server/src/modules/agent/routes.test.ts`, `server/src/modules/agent/ticket-intake/llm.ts`, `server/src/modules/agent/ticket-intake/llm.test.ts`, `server/src/modules/agent/pipeline.integration.test.ts`, `server/src/modules/agent/` body from leftover `server/src/routes/ticket-intake.ts` + its tests
- Modify: `client/src/features/agent/index.ts`, `server/src/modules/agent/index.ts`, leftover `client/src/pages/AgentPage.tsx` (specifier only), leftover `server/src/routes/cards-identity.integration.test.ts` (`createAgentRouter` via agent index), `server/src/index.ts` (agent router mount if still leftover), `scripts/feature-modules/git-diff.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: [derived] AgentCardDetail, useAgentBoard, and llm cluster relocate after board and chat indexes exist
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given leftover `client/src/components/AgentCardDetail.tsx`, leftover `client/src/hooks/useAgentBoard.ts`, leftover `server/src/agent/llm.ts` still exist and `client/src/features/board/index.ts` plus `server/src/modules/chat/index.ts` exist
   When Cycle Map is evaluated
   Then:
   - `client/src/features/agent/AgentCardDetail.tsx`, `useAgentBoard.ts`, `agentStream.ts`, and `agentBoardSync.ts` exist
   - `server/src/modules/agent/llm.ts` exists
   - leftover `server/src/agent/llm.ts` and leftover `server/src/routes/ticket-intake.ts` are gone

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `client/src/features/agent/AgentCardDetail.tsx` and the deferred stream/sync homes do not exist until this packet

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `client/src/features/agent/AgentCardDetail.tsx` or `server/src/modules/agent/llm.ts`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: `git mv` AgentCardDetail, useAgentBoard, agentStream, agentBoardSync, and the llm cluster; specifier-only import of `features/board` index for client leftovers; use relative imports inside the agent module; `llm.ts` imports `modules/chat` index only (not leftover `server/src/chat/`); extend agent indexes; do not split AgentCardDetail (500 lines) or llm.ts — revert format hunks; do not close #121

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=client -- src/features/agent` and `npm run test --workspace=server -- src/modules/agent`

5. Refactor while green (bounded):
   - Do not split AgentCardDetail or llm.ts; revert fat-file format hunks
   - Re-run: `npm run test:feature-modules`

6. Commit:
   Stage every path this packet moves or retargets.
   `git commit -m "refactor(agent): relocate BoardContext consumers and llm cluster"`
   PR: `refs #131` — do not close #121

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — one FEATURES name per PR; one-way wall
client/src/components/AgentCardDetail.tsx — imports useBoard
client/src/hooks/useAgentBoard.ts — imports useBoard
server/src/agent/llm.ts — imports runChatTurn; cannot move until chat index exists

## WHY THIS APPROACH
Justification: Wave-2 after T11; still agent-only. llm.ts waited for T8 server chat.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Hotfix #2 must be complete; import features/board index and modules/chat index only; move stream/sync with their consumers using relative module imports; do not import leftover BoardContext or leftover server/src/chat/; do not split AgentCardDetail or llm.ts; do not close #121]
You are implementing T12 agent wave-2 relocate for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A plus two-wave focus/agent and chat/agent llm split
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest workspace-scoped
Available after: T11 + Hotfix #2
Architecture rule: module → other module index only; stream/sync are internal agent-module files after this task
[RESTATE: Import features/board index and modules/chat index only; do not import leftover BoardContext or leftover server/src/chat/; do not split AgentCardDetail or llm.ts; do not close #121]

## DELIVERABLE
[derived] Given leftover AgentCardDetail/useAgentBoard import leftover BoardContext and leftover llm.ts imports leftover chat, When board and chat indexes already exist and this packet git-mvs them into the agent module, Then check:feature-modules passes, AgentPage stays in pages/, and #121 stays open

All tests PASS. Commit exists with message matching `refactor(agent): relocate BoardContext consumers and llm cluster`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map AgentCardDetail/useAgentBoard and llm.ts homes
  - leftover `server/src/agent/` llm cluster gone
  - One-way wall green
  - PR `refs #131`

Must-not-have:
  - Closing #121 or #131
  - Logic changes
  - A second FEATURES name

Rollback note:
  - Revert this PR

## STOP CONDITIONS
Done when: Hotfix #2 is recorded complete, Cycle Map and agent tests pass, and stream/sync no longer live under client/src/lib/
Uncertain when: another agent production file still imports leftover BoardContext
Blocked when: Hotfix #2 is incomplete or stream/sync cannot move without a second FEATURES name
Escalate when: one-way fails unless a second FEATURES name is moved
