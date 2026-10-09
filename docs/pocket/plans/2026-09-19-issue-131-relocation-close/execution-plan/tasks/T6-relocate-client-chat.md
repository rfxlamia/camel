# Task T6 — Relocate client chat

**Phase:** 2
**Depends:** T5
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 6: Relocate client chat [depends: T5]

## OBJECTIVE
`git mv` leftover **client** chat product files including `client/src/chat/` into `client/src/features/chat/` with public `index.ts`. Leave `server/src/chat/` leftover until T8 (those files import leftover agent tools). `ChatPage.tsx` stays in pages/. Do not retarget leftover `llm.ts` yet (server chat index does not exist).

Files:
- Create: `client/src/features/chat/index.ts` and bodies from `client/src/chat/*`, `client/src/components/chat/*` if present, `client/src/hooks/useChatStream.ts`, `client/src/lib/chatToolTrace.ts` + tests
- Modify: `client/src/pages/ChatPage.tsx` (specifier only), `scripts/feature-modules/git-diff.test.mjs`
- Test: `scripts/feature-modules/git-diff.test.mjs`

Steps:
1. Write failing test for: client/src/chat/ moves with client chat
   Test file: `scripts/feature-modules/git-diff.test.mjs`
   Level: unit

   Test intent:
   Given ChatRuntimeProvider and adapters live under client/src/chat/
   When Cycle Map is evaluated
   Then:
   - `client/src/features/chat/index.ts` exists
   - leftover `client/src/chat/ChatRuntimeProvider.tsx` is gone
   - leftover `server/src/chat/routes.ts` **still exists** (server chat is T8)
   - `client/src/pages/ChatPage.tsx` still exists

   Exercise through:
   - Cycle Map `existsSync` assertions

   Test doubles:
   - mock/fake: none
   - do NOT mock: Cycle Map

   Expected RED:
   - `client/src/features/chat/index.ts` does not exist today

2. Run test — verify FAIL:
   `npm run test:feature-modules`
   Expected failure: missing `client/src/features/chat/index.ts`

3. Implement minimal code to satisfy the test:
   File: paths in OBJECTIVE
   Implement: `git mv` client chat only; index barrels; ChatPage specifier-only; `useChatStream` imports `shared/agentQueue` (T1), not leftover `lib/agentQueue`; do **not** move `server/src/chat/`; do not retarget leftover `llm.ts`; leftover `client/src/context/BoardContext.tsx` still may import leftover `lib/agentStream` until T7; do not move Inbox/Dashboard pages

4. Run test — verify PASS:
   `npm run test:feature-modules`
   Expected: PASS
   Also run: `npm run check:feature-modules` and `npm run test --workspace=client -- src/features/chat src/pages/ChatPage.test.tsx`

5. Refactor while green (bounded):
   - Do not split useChatStream if >300; revert format hunks
   - Re-run: `npm run test:feature-modules`

6. Commit:
   `git commit -m "refactor(chat): relocate client chat into feature module"`
   PR: `refs #131`

## REFERENCES LOADED
docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md — rule: Auth screens and chat legacy tree
client/src/chat/ChatRuntimeProvider.tsx — leftover runtime tree
server/src/chat/run-chat-turn.ts — imports leftover agent tools; cannot move until agent index exists

## WHY THIS APPROACH
Justification: Client chat does not import leftover agent. Server chat does — it waits for T7 then moves in T8.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: ChatPage stays in pages/; do not move server/src/chat/; do not add a second FEATURES name; do not split fat chat hooks]
You are implementing T6 client chat relocate for #131 relocation close.
Spec: docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
Design decision: Option A plus chat/agent wave split
Files in scope: listed in OBJECTIVE
Test framework: node:test + Vitest workspace-scoped
Available after: T5
Architecture rule: client chat module must not import leftover agentQueue (already shared) or leftover agent type-folders
[RESTATE: ChatPage stays in pages/; do not move server/src/chat/; do not add a second FEATURES name; do not split fat chat hooks]

## DELIVERABLE
Given ChatRuntimeProvider and adapters live under client/src/chat/, When the client chat packet runs, Then those files live under features/chat/ with index.ts, ChatPage.tsx stays under pages/, and server/src/chat/ still exists

All tests PASS. Commit exists with message matching `refactor(chat): relocate client chat into feature module`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Cycle Map client chat home and `client/src/chat/` absence
  - leftover server chat still present
  - Test file count not reduced
  - PR `refs #131`

Must-not-have:
  - Moving ChatPage into features/
  - Moving `server/src/chat/` (that is T8)
  - `closes #131` (more FEATURES remain)
  - Logic changes in stream/LLM chat code

Open question risks:
  - `lib/chatToolTrace.ts` assumed client chat packet; if ToolTrace chrome already needed it in T1, skip duplicate move

Rollback note:
  - Revert the whole client chat packet

## STOP CONDITIONS
Done when: Cycle Map and client chat tests pass
Uncertain when: client chat module imports leftover agent type-folders
Escalate when: one-way requires moving server chat or agent files in this PR
