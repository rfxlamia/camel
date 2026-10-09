# Task T7 — Relocate agent wave-1 (closed dependency slice)

**Phase:** 3  
**Depends:** T6  
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 7: Relocate agent wave-1 (closed dependency slice) [depends: T6]

## OBJECTIVE

Relocate only the agent files whose inbound and outbound dependencies form a closed wave-1 slice. Preserve the server wave-1 relocation, but leave the client streaming/synchronization helpers and every consumer that depends on them in their existing legacy homes for agent wave-2. This repair supersedes the original T7 packet's broader client move.

`BoardContext.tsx`, `AgentCardDetail.tsx`, `useAgentBoard.ts`, `agentStream.ts` (+ test), and `agentBoardSync.ts` (+ test) are explicitly **not** in this task. They remain byte-for-byte compatible with `main` and must not be made to import the feature barrel or a deep feature path.

Files:

- Create/move client files:
  - `client/src/features/agent/AgentBoardHeader.tsx`
  - `client/src/features/agent/AgentBoardVisual.tsx`
  - `client/src/features/agent/AgentChatPanel.tsx`
  - `client/src/features/agent/AgentComposer.tsx`
  - `client/src/features/agent/ArtifactCard.tsx` and `ArtifactCard.test.tsx`
  - `client/src/features/agent/agentColumnState.ts` and `agentColumnState.test.ts`
  - `client/src/features/agent/agentFollowUp.ts`
  - `client/src/features/agent/useAgentChat.ts`
  - `client/src/features/agent/index.ts`
- Keep client wave-2 leftovers in their `main` homes:
  - `client/src/lib/agentStream.ts` and `agentStream.test.ts`
  - `client/src/lib/agentBoardSync.ts` and `agentBoardSync.test.ts`
  - `client/src/context/BoardContext.tsx`
  - `client/src/components/AgentCardDetail.tsx`
  - `client/src/hooks/useAgentBoard.ts`
- Modify client path-only consumers:
  - `client/src/pages/AgentPage.tsx`
  - `client/src/pages/AgentPage.test.tsx`
  - import paths inside the moved client slice
- Create/move server files from the original T7 server wave:
  - `server/src/modules/agent/artifact.ts` (+ test)
  - `prompt-sanitizer.ts`
  - `service.ts` (+ test)
  - `templates.ts` (+ test)
  - `ticket-intake/completeness.ts` (+ test)
  - `ticket-intake/history.ts` (+ test)
  - `ticket-intake/linear-client.ts` (+ test)
  - `ticket-intake/rate-limits.ts` (+ test)
  - `ticket-intake/retry.ts` (+ test)
  - `tools/createFile.ts` (+ test)
  - `tools/queryBoardData.ts` (+ test)
  - `tools/registry.ts` (+ test)
  - `tools/trace.ts` (+ test)
  - `tools/types.ts`
  - `tools/webSearch.ts` (+ test)
  - `server/src/modules/agent/index.ts`
- Modify server path-only consumers from the original wave-1 relocation, including `server/src/chat/**`, `server/src/agent/llm.ts`, `server/src/agent/routes.ts`, `server/src/agent/ticket-intake/llm.ts`, `server/src/routes/ticket-intake.ts` and its tests, `server/src/routes.ts`, `server/src/index.ts`, and the prompt-sanitizer test. Do not move the LLM cluster.
- Update `scripts/feature-modules/git-diff.test.mjs` to lock this closed slice and the wave-2 leftovers.

## RED/GREEN STEPS

1. Update the T7 Cycle Map assertion before relocation. The first new assertion must check `server/src/modules/agent/index.ts`; the repaired test must also assert that stream/sync remain in `client/src/lib/`, are absent from `features/agent/`, and are not public barrel exports.
2. Run `npm run test:feature-modules` from a clean `main`-based tree. Expected RED: the first new failure is the missing `server/src/modules/agent/index.ts`.
3. Implement the minimum path-only relocation. Restore `BoardContext.tsx`, `AgentCardDetail.tsx`, `useAgentBoard.ts`, both stream/sync pairs, `client/vitest.config.ts`, and the three agent consumers from `main`; remove the global test setup and the three agent hub-to-leaf allowlist entries. Keep `server/src/modules/agent/**` as the wave-1 relocation.
4. Make `client/src/features/agent/index.ts` the narrow public API used by `AgentPage` only:
   - `AgentBoardHeader`
   - `AgentBoardVisual`
   - `AgentChatPanel`
   - `AgentComposer`
   - `useAgentChat`
   Do not export `ArtifactCard`, pure helpers, stream/sync helpers, or follow-up/column-state helpers from the barrel.
5. In `server/src/routes/ticket-intake.test.ts`, mock only the runtime exports imported by `ticket-intake.ts` (`checkCompleteness`, `inferTypeFromClassifierAnswer`, `getTicketHistory`, Linear functions, rate-limit functions, and `executeWithRetry`) with an explicit object. Mock `extractTicketFields` directly from `../agent/ticket-intake/llm.js`; never use `importOriginal()` for the agent barrel and never pretend `extractTicketFields` is a barrel export.
6. Run `npm run test:feature-modules`, `npm run check:feature-modules`, and the targeted client/server workspace tests. Keep all production bodies unchanged except import specifiers and the required safety comment on the pre-existing `Json` assertion in `server/src/chat/routes.ts`.
7. Commit only after the full verification gates pass:
   `git commit -m "refactor(agent): relocate wave-1 into feature modules"`
   Use `refs #131`; do not close #121 or #131.

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md` — one FEATURES name per PR, public indexes, path-only moves, and no early close.
- `docs/pocket/adr/2026-09-16-feature-module-convention.md` — one-way import wall and 300-on-touch grandfathering.
- `scripts/feature-modules/git-diff.test.mjs` — Cycle Map home/absence and public-API assertions.
- `server/src/routes/ticket-intake.ts` — exact runtime exports required by the route test mock.

## WHY THIS APPROACH

The original T7 crossed an inbound dependency boundary: moving `agentStream` and `agentBoardSync` forced edits to `BoardContext` and other wave-2 consumers. That made a mechanical relocation look like a behavioral refactor, triggered FM-RULE-3, and led to deep-import and global Lottie workarounds. A closed slice keeps this PR relocation-only and lets wave-2 own the remaining dependency graph.

Complexity: standard relocation with an explicit test-boundary repair.

## SANDWICH CONTEXT

[CRITICAL: Do not move or edit the bodies of `BoardContext.tsx`, `AgentCardDetail.tsx`, `useAgentBoard.ts`, `agentStream*`, or `agentBoardSync*`; do not add deep-import allowlists or global Lottie mocks]

You are implementing the repaired T7 agent wave-1 relocation for #131. The server wave-1 module move remains in scope. The client wave is deliberately closed before the stream/sync inbound consumers. Client external consumers use the narrow `features/agent/index.ts`; module internals use relative imports. Server imports use NodeNext `.js` extensions.

Downstream sequencing:

- A separate Hotfix #2 must extract only the workspace-reset helper needed by future board relocation into `client/src/shared/` before T9 moves `BoardContext`.
- T9 is blocked until that helper hotfix is complete; T9 must not make a board module import `client/src/lib/agentStream`.
- T12 owns the later move of `AgentCardDetail`, `useAgentBoard`, `agentStream*`, and `agentBoardSync*` after the board index and helper prerequisite exist.

[RESTATE: This PR is a closed slice. No BoardContext edit, no agent-specific allowlist, no global Lottie test setup, no deep feature import, and no runtime behavior change.]

## DELIVERABLE

Given the server agent wave-1 files and the closed client agent slice are relocated, when the Cycle Map and feature guards run, then:

- `server/src/modules/agent/index.ts` and `client/src/features/agent/index.ts` exist;
- the listed server module files and closed client files have moved with their tests;
- `agentStream*` and `agentBoardSync*` remain in `client/src/lib/`;
- `BoardContext.tsx`, `AgentCardDetail.tsx`, and `useAgentBoard.ts` match `main` exactly;
- the feature barrel exposes only the five listed public APIs;
- no global Vitest Lottie setup or agent-specific allowlist exists;
- all tests and guards pass.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Cycle Map locks both module homes and the four client stream/sync wave-2 leftovers.
- Test file count does not decrease.
- Server NodeNext `.js` specifiers remain valid.
- `service.ts` and every other oversized file move as-is; no split.
- PR uses `refs #131` and does not close #121.

Must-not-have:

- Any BoardContext, AgentCardDetail, or useAgentBoard body/import change.
- Any `HUB_TO_LEAF_ALLOWLIST` entry for agent stream/sync.
- `client/src/shared/test-setup.ts` or global `setupFiles` added for this PR.
- Barrel `importOriginal()` in `ticket-intake.test.ts`.
- Logic, HTTP, schema, or dual-table changes.
- A second FEATURES name or `closes #131`.

## STOP CONDITIONS

Done when: Cycle Map, feature-module guard, targeted tests, full tests, build, and integration route verification pass.

Uncertain when: the server module index requires a file from the deferred LLM cluster or the client slice imports a leftover feature file.

Blocked when: T9 is attempted before Hotfix #2, or a path-only move cannot satisfy the one-way wall without moving a second feature.
