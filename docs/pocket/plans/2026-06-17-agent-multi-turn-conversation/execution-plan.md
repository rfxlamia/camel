# EXECUTION PLAN — Agent Multi-Turn Conversation

**Date:** 2026-06-17
**Spec:** docs/pocket/spec/2026-06-17-agent-multi-turn-conversation/spec.md
**Status:** draft
**Total tasks:** 5

---

## Execution Overview

### Recommended Order

```
T1 → T2 → T3, T4 (parallel) → T5
```

> Dependency order above is **recommended** — pocket skill enforces actual
> parallelism and sequencing based on its routing logic.

### Parallelizable Groups

| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T3, T4 | T2 completes |

### Constraints Reminder

**Architecture:** Only touch service.ts, llm.ts, routes.ts, AgentPage.tsx, api.ts. No new DB tables. No changes to agent/templates.ts or DB schema.
**Out-of-scope:** Artifact versioning/diff, partial pipeline re-run for REFINE, explicit command syntax, per-type cost optimization, branching/compare, auto-compact for conversation history.
**Assumptions at risk:** None blocking (3 non-blocking resolved in spec).
**Sequencing:** T3 and T4 can run concurrently — they touch different layers (server routes vs client UI). T5 depends on both because it updates the shared API contract + stream utilities consumed by AgentPage.

### File Structure Map

```
Rule 1: Follow-up LLM response
  Modify: server/src/agent/llm.ts                    (created by: T1)
  Modify: server/src/agent/service.ts                 (modified by: T2)
  Test:   server/src/agent/llm.test.ts                (modified by: T1)
  Test:   server/src/agent/service.test.ts            (modified by: T2)

Rule 2: Intent classification
  Modify: server/src/agent/llm.ts                    (modified by: T1)
  Modify: server/src/agent/service.ts                 (modified by: T2)
  Test:   server/src/agent/llm.test.ts                (modified by: T1)
  Test:   server/src/agent/service.test.ts            (modified by: T2)

Rule 3: New Direction confirmation
  Modify: server/src/agent/routes.ts                  (modified by: T3)
  Modify: server/src/agent/service.ts                 (modified by: T2)
  Modify: client/src/pages/AgentPage.tsx              (modified by: T4)
  Modify: client/src/api.ts                           (modified by: T5)
  Test:   server/src/agent/routes.test.ts             (modified by: T3)
  Test:   server/src/agent/service.test.ts            (modified by: T2)
  Test:   client/src/pages/AgentPage.test.tsx         (modified by: T4)
  Test:   client/src/api.test.ts                      (modified by: T5)

Rule 4: Regenerate replaces old state
  Modify: server/src/agent/service.ts                 (modified by: T2)
  Test:   server/src/agent/service.test.ts            (modified by: T2)

Rule 5: SSE streaming for follow-ups
  Modify: client/src/lib/agentColumnState.ts          (modified by: T5)
  Modify: client/src/pages/AgentPage.tsx              (modified by: T4)
  Test:   client/src/lib/agentColumnState.test.ts     (modified by: T5)
  Test:   client/src/pages/AgentPage.test.tsx         (modified by: T4)
```

---

## Pocket Packets

---

### Task 1: classifyFollowUpIntent + Scope Guard Prompt [prereq]

---

## OBJECTIVE

Add `classifyFollowUpIntent()` function to `server/src/agent/llm.ts` that takes a board's context (original intent, artifact content, conversation history) and a user message, calls the LLM with the scope guard system prompt, and returns a typed JSON result `{ intent, response, confidence }`. The scope guard prompt includes Few-Shot examples and the disambiguation rules from the spec.

Files:

- Modify: `server/src/agent/llm.ts`
- Test: `server/src/agent/llm.test.ts`

Steps:

1. Write failing tests for: classifyFollowUpIntent returns correct intent types (ASK, REFINE, NEW_DIRECTION, OFF_TOPIC) and handles JSON parsing edge cases
   File: `server/src/agent/llm.test.ts`
   Test verifies:
   - Given a message about existing artifact content, When classified, Then returns intent "ASK" with a response using artifact context
   - Given a message requesting modification within scope, When classified, Then returns intent "REFINE"
   - Given a message requesting a fundamentally different topic, When classified, Then returns intent "NEW_DIRECTION"
   - Given a clearly unrelated message, When classified, Then returns intent "OFF_TOPIC"
   - Given an LLM response wrapped in markdown code blocks, When parsed, Then JSON is extracted correctly
   - Given an LLM response with preamble text before JSON, When parsed, Then JSON is extracted via greedy match

2. Run tests — verify FAIL:
   `npx vitest run server/src/agent/llm.test.ts`
   Expected failure: `classifyFollowUpIntent` does not exist yet

3. Implement classifyFollowUpIntent in llm.ts:
   File: `server/src/agent/llm.ts`
   Implement:
   - Export interface `FollowUpResult { intent: "ASK" | "REFINE" | "NEW_DIRECTION" | "OFF_TOPIC"; response: string; confidence: number; }`
   - Export async function `classifyFollowUpIntent(originalIntent: string, artifactContent: string | null, conversationHistory: Array<{ role: string; content: string }>, userMessage: string): Promise<FollowUpResult>`
   - System prompt: the full scope guard prompt from spec (role, intent_classification, scope_guard_rules, response_guidelines) + Few-Shot examples
   - User message context: inject originalIntent + artifactContent + conversationHistory + userMessage into a structured prompt
   - LLM call: `client.messages.create()` with `max_tokens: 2048`, `temperature: 0`
   - JSON parsing: reuse the multi-strategy parsing pattern from `classifyIntentOnce` (direct parse → code block extraction → greedy match → field extraction)
   - Retry: up to 3 attempts (same pattern as classifyIntent)

4. Run tests — verify PASS:
   `npx vitest run server/src/agent/llm.test.ts`
   Expected: all new tests PASS

5. Commit:
   `git add server/src/agent/llm.ts server/src/agent/llm.test.ts`
   `git commit -m "feat(agent): add classifyFollowUpIntent with scope guard prompt"`

## REFERENCES LOADED

docs/pocket/spec/2026-06-17-agent-multi-turn-conversation/spec.md — Rules 1, 2, 6 (follow-up LLM response, intent classification, scope guard). GWT: 8 scenarios covering ASK/REFINE/NEW_DIRECTION/OFF_TOPIC classification + edge cases.
server/src/agent/llm.ts — existing classifyIntent + classifyIntentOnce pattern with multi-strategy JSON parsing and retry wrapper. executeCard streaming pattern.
server/src/agent/llm.test.ts — existing mock pattern: vi.mock("@anthropic-ai/sdk"), mockCreate, mockStream. Tests use dynamic import after mock setup.

## WHY THIS APPROACH

Justification: 2 files (1 modify, 1 test). Follows existing classifyIntent pattern exactly — same retry logic, same JSON parsing strategies, same mock structure. Scope guard prompt is fully specified in the spec including Few-Shot examples.
Complexity: standard — multi-strategy JSON parsing + structured prompt construction, but well-established pattern in codebase.

## SANDWICH CONTEXT

[CRITICAL: classifyFollowUpIntent must return a typed JSON object — the service layer (T2) depends on the exact shape { intent, response, confidence } for its switch logic]
You are implementing the LLM layer for follow-up message classification for Agent Multi-Turn Conversation.
Spec: docs/pocket/spec/2026-06-17-agent-multi-turn-conversation/spec.md
Design decision: Option A — Single Smart Handler (1 LLM call for routing + response)
Files in scope: server/src/agent/llm.ts, server/src/agent/llm.test.ts — no other files
Test framework: Vitest with vi.mock("@anthropic-ai/sdk") pattern
Available after: none (prereq)
Architecture rule: llm.ts must remain pure async with no DB dependencies (existing pattern)
[RESTATE: classifyFollowUpIntent must return { intent, response, confidence } — T2's switch logic depends on this exact shape]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a board about "EV market research" with artifact content, When user sends "What were the key findings about consumer preferences?", Then response has intent "ASK" and answers using artifact context
Given a board about "EV market research", When user sends "Add a section about government regulations", Then response has intent "REFINE" and acknowledges the refinement
Given a board about "EV market research", When user sends "Now research competitor landscape for scooters", Then response has intent "NEW_DIRECTION" and includes confirmation message
Given a board about "EV market research", When user sends "Write me a Python script", Then response has intent "OFF_TOPIC" and politely declines
Given an LLM response wrapped in ```json blocks, When parsed, Then JSON is extracted correctly
Given an LLM response with preamble text before JSON, When parsed, Then JSON is extracted via greedy match

All tests PASS. Commit exists with message matching `feat(agent): add classifyFollowUpIntent with scope guard prompt`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- classifyFollowUpIntent returns FollowUpResult with intent, response, confidence
- Scope guard prompt includes all Few-Shot examples from spec
- Disambiguation rules enforced (ASK over REFINE when in doubt, REFINE over NEW_DIRECTION)
- Multi-strategy JSON parsing (reuse classifyIntentOnce pattern)
- Tests written BEFORE implementation (TDD — not after)

Must-not-have:

- DB dependencies in llm.ts (must remain pure async)
- Modifications to files outside llm.ts and llm.test.ts
- New npm dependencies

Open question risks:

- None blocking

Rollback note:

- New function — removing it reverts to previous behavior (static ack for approved boards)

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: never (scope guard prompt fully specified in spec)
Escalate when: if classifyFollowUpIntent needs to call DB (should not happen)

---

### Task 2: Service sendMessage Upgrade + regenerateBoard [depends: T1]

---

## OBJECTIVE

Upgrade `sendMessage` in `server/src/agent/service.ts` to handle done/approved boards with LLM follow-up. Load context (original intent + artifact + conversation history), call `classifyFollowUpIntent`, switch on intent type to determine behavior, stream response via SSE with `__notfirst__` slug, store in `agent_conversations`. Implement `regenerateBoard` for NEW_DIRECTION confirmation flow: update intent, clear old outputs, re-run pipeline. Add `pendingRegenerate` in-memory Map and `confirmRegenerateBoard`/`cancelRegenerateBoard` methods.

Files:

- Modify: `server/src/agent/service.ts`
- Test: `server/src/agent/service.test.ts`

Steps:

1. Write failing tests for: sendMessage on done/approved board calls LLM and streams response; regenerateBoard clears old outputs and re-runs pipeline; confirmRegenerateBoard and cancelRegenerateBoard handle pending state
   File: `server/src/agent/service.test.ts`
   Test verifies:
   - Given a board with executionStatus "done" and user sends a follow-up, When sendMessage is called, Then classifyFollowUpIntent is invoked with artifact + history + message
   - Given classifyFollowUpIntent returns ASK intent, When sendMessage processes, Then response is streamed via publishEvent with columnSlug "**notfirst**" and stored in agent_conversations
   - Given classifyFollowUpIntent returns OFF_TOPIC intent, When sendMessage processes, Then response is returned without streaming (static response)
   - Given classifyFollowUpIntent returns NEW_DIRECTION intent, When sendMessage processes, Then pending state is stored and confirmation response is returned
   - Given a pending regenerate state, When confirmRegenerateBoard is called, Then board.original_intent is updated, old agent_card_outputs are deleted, old cards are deleted, and pipeline re-runs
   - Given a pending regenerate state, When cancelRegenerateBoard is called, Then pending state is cleared and cancellation message is stored
   - Given a board with executionStatus "running", When sendMessage is called, Then returns "Board sedang dalam eksekusi" without LLM call
   - Given regenerateBoard is called, When pipeline completes, Then conversation history from old topic is preserved

2. Run tests — verify FAIL:
   `npx vitest run server/src/agent/service.test.ts`
   Expected failure: sendMessage does not call classifyFollowUpIntent for done boards

3. Implement sendMessage upgrade and regenerateBoard in service.ts:
   File: `server/src/agent/service.ts`
   Implement:
   - Add to AgentBoardServiceDeps: `classifyFollowUpIntent?: (originalIntent: string, artifactContent: string | null, conversationHistory: Array<{ role: string; content: string }>, userMessage: string) => Promise<FollowUpResult>`, `getConversationHistory?: (boardId: number) => Promise<Array<{ role: string; content: string }>>`, `deleteOutputsForBoard?: (boardId: number) => Promise<void>`, `deleteCardsForBoard?: (boardId: number) => Promise<void>`
   - Add `pendingRegenerate` Map field to service (in-memory: `Map<number, string>` — boardId → new intent)
   - Upgrade sendMessage:
     - If board.executionStatus === "running" → return static "Board sedang dalam eksekusi" message
     - If board.status === "approved" && board.executionStatus === "done":
       - Load artifact via deps.getArtifact(boardId)
       - Load conversation history via deps.getConversationHistory(boardId)
       - Call deps.classifyFollowUpIntent(board.originalIntent, artifact?.content ?? null, history, message)
       - Switch on result.intent:
         - ASK / REFINE: stream response via publishEvent with columnSlug "**notfirst**", store in agent_conversations
         - NEW_DIRECTION: set pendingRegenerate.set(boardId, newIntent), return confirmation response with button metadata
         - OFF_TOPIC: return static rejection response, store in agent_conversations
     - If board.status === "pending": existing behavior (generateClarificationQuestion)
   - Add `confirmRegenerateBoard({ boardId, workspaceId })`:
     - Check pendingRegenerate has this boardId
     - Store confirmation response in agent_conversations
     - Update board.original_intent via deps.updateBoard
     - Delete old agent_card_outputs via deps.deleteOutputsForBoard
     - Delete old cards via deps.deleteCardsForBoard
     - Clear pendingRegenerate.delete(boardId)
     - Call this.runPipeline({ boardId, workspaceId })
   - Add `cancelRegenerateBoard({ boardId })`:
     - Store cancellation message in agent_conversations
     - Clear pendingRegenerate.delete(boardId)
     - Return { ok: true }

4. Run tests — verify PASS:
   `npx vitest run server/src/agent/service.test.ts`
   Expected: all new tests PASS

5. Commit:
   `git add server/src/agent/service.ts server/src/agent/service.test.ts`
   `git commit -m "feat(agent): upgrade sendMessage for multi-turn follow-up + regenerate"`

## REFERENCES LOADED

docs/pocket/spec/2026-06-17-agent-multi-turn-conversation/spec.md — Rules 1-4 (follow-up response, intent classification, confirmation, regenerate). GWT: 12 scenarios.
server/src/agent/service.ts — existing sendMessage method (only handles pending boards). DI pattern via AgentBoardServiceDeps. SSE via deps.publishEvent. runPipeline method for regeneration.
server/src/agent/service.test.ts — existing test pattern: createAgentBoardService with vi.fn() mocked deps. Tests verify dep calls and return values.
server/src/db/agent-schema.sql — agent_conversations (board_id, role, content), agent_card_outputs (board_id, column_slug), agent_boards (original_intent, status, execution_status)

## WHY THIS APPROACH

Justification: 2 files. sendMessage is the single entry point (Direction A from spec). RegenerateBoard reuses existing runPipeline. In-memory pendingRegenerate Map is acceptable trade-off per spec (lost on restart, rare edge case).
Complexity: standard — multi-branch intent switch, SSE streaming, regenerate flow with DELETE + re-run.

## SANDWICH CONTEXT

[CRITICAL: sendMessage must remain a single entry point — no new endpoints for follow-up. All intent types handled in one method.]
You are implementing the service layer for Agent Multi-Turn Conversation.
Spec: docs/pocket/spec/2026-06-17-agent-multi-turn-conversation/spec.md
Design decision: Option A — Single Smart Handler
Files in scope: server/src/agent/service.ts, server/src/agent/service.test.ts — no other files
Test framework: Vitest with vi.fn() mocked deps (existing pattern)
Available after: T1 (classifyFollowUpIntent must exist in llm.ts)
Architecture rule: dependency injection via AgentBoardServiceDeps — no direct DB/LLM imports in service.ts
[RESTATE: sendMessage must remain a single entry point — all intent types handled in one method]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a board with status "done" and artifact "research about EV market", And user sends "What were the key findings about charging infrastructure?", When sendMessage is called, Then classifyFollowUpIntent receives artifact + history + message, And response is streamed via publishEvent with columnSlug "**notfirst**", And response is stored in agent_conversations
Given a board with execution_status "running", And user sends a follow-up message, When sendMessage is called, Then returns "Board sedang dalam eksekusi. Tunggu hingga selesai." without LLM call
Given a board with pending regeneration intent, When confirmRegenerateBoard is called, Then board.original_intent is updated, old outputs are deleted, old cards are deleted, pipeline re-runs
Given a board with pending regeneration intent, When cancelRegenerateBoard is called, Then pending state is cleared and board remains unchanged
Given sendMessage processes NEW_DIRECTION intent, Then pending state is stored and confirmation response includes button metadata
Given regenerate completes, Then conversation history from old topic is preserved

All tests PASS. Commit exists with message matching `feat(agent): upgrade sendMessage for multi-turn follow-up + regenerate`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- sendMessage handles all 4 intent types (ASK, REFINE, NEW_DIRECTION, OFF_TOPIC)
- Follow-up responses for ASK/REFINE stream via SSE with columnSlug "**notfirst**"
- OFF_TOPIC returns static rejection without streaming
- NEW_DIRECTION stores pending state and returns confirmation response
- confirmRegenerateBoard deletes old outputs + cards and re-runs pipeline
- cancelRegenerateBoard clears pending state
- Conversation history preserved across regenerations
- Tests written BEFORE implementation (TDD — not after)

Must-not-have:

- New DB tables or schema changes
- Modifications to agent/templates.ts
- Direct DB/LLM imports in service.ts (use deps)
- Auto-compact or truncation of conversation history

Open question risks:

- None blocking

Rollback note:

- Cancel regeneration = clear in-memory pending state. Board unchanged.
- Regenerate fails = board in "failed" state, user can retry (consistent with existing behavior).

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: never
Escalate when: if sendMessage needs to modify DB schema (should not happen)

---

### Task 3: Routes Structured Payload Handling [depends: T2] [parallel: T4]

---

## OBJECTIVE

Update the message endpoint in `server/src/agent/routes.ts` to accept structured payloads (`{ action: "confirm_regenerate" }` and `{ action: "cancel_regenerate" }`) in addition to the existing `{ message: string }` format. Wire `confirmRegenerateBoard` and `cancelRegenerateBoard` from service into the route handler. Add new deps wiring in `realDeps`.

Files:

- Modify: `server/src/agent/routes.ts`
- Test: `server/src/agent/routes.test.ts`

Steps:

1. Write failing tests for: message endpoint accepts structured payloads and routes to correct service method
   File: `server/src/agent/routes.test.ts`
   Test verifies:
   - Given a POST to message endpoint with `{ action: "confirm_regenerate" }`, When processed, Then service.confirmRegenerateBoard is called with boardId and workspaceId
   - Given a POST to message endpoint with `{ action: "cancel_regenerate" }`, When processed, Then service.cancelRegenerateBoard is called with boardId
   - Given a POST to message endpoint with `{ message: "some text" }`, When processed, Then existing sendMessage flow is used (backward compatible)
   - Given a POST to message endpoint with empty body, When processed, Then returns 400 error
   - Given new deps (getConversationHistory, deleteOutputsForBoard, deleteCardsForBoard), When realDeps is constructed, Then all deps are wired to pool.query

2. Run tests — verify FAIL:
   `npx vitest run server/src/agent/routes.test.ts`
   Expected failure: structured payload handling does not exist yet

3. Implement structured payload handling in routes.ts:
   File: `server/src/agent/routes.ts`
   Implement:
   - Update message endpoint handler to detect payload type:
     - If `req.body.action === "confirm_regenerate"` → call service.confirmRegenerateBoard({ boardId, workspaceId })
     - If `req.body.action === "cancel_regenerate"` → call service.cancelRegenerateBoard({ boardId })
     - If `req.body.message` exists → existing sendMessage flow
     - Else → return 400 error
   - Add to realDeps:
     - `getConversationHistory`: query `SELECT role, content FROM agent_conversations WHERE board_id = $1 ORDER BY created_at`
     - `deleteOutputsForBoard`: query `DELETE FROM agent_card_outputs WHERE board_id = $1`
     - `deleteCardsForBoard`: query `DELETE FROM cards WHERE column_id IN (SELECT id FROM columns WHERE board_id = $1)`
     - `classifyFollowUpIntent`: import from `./llm.js`

4. Run tests — verify PASS:
   `npx vitest run server/src/agent/routes.test.ts`
   Expected: all new tests PASS

5. Commit:
   `git add server/src/agent/routes.ts server/src/agent/routes.test.ts`
   `git commit -m "feat(agent): add structured payload handling for regenerate confirmation"`

## REFERENCES LOADED

docs/pocket/spec/2026-06-17-agent-multi-turn-conversation/spec.md — Rule 3 (confirmation flow), Rule 4 (regenerate replaces old state). GWT: 4 scenarios.
server/src/agent/routes.ts — existing message endpoint at POST /workspaces/:workspaceId/agent/boards/:boardId/message. realDeps wiring pattern. requireWorkspaceMember helper.
server/src/agent/routes.test.ts — existing test pattern for route handlers.
server/src/db/agent-schema.sql — agent_conversations, agent_card_outputs, columns, cards tables.

## WHY THIS APPROACH

Justification: 2 files. Routes layer is thin — just payload detection + service delegation. Structured payload keeps backward compatibility (existing `{ message }` still works).
Complexity: lightweight — payload branching + new dep wiring.

## SANDWICH CONTEXT

[CRITICAL: message endpoint must remain backward compatible — existing { message: string } payloads must still work]
You are implementing route handling for Agent Multi-Turn Conversation regenerate flow.
Spec: docs/pocket/spec/2026-06-17-agent-multi-turn-conversation/spec.md
Design decision: Option A — Single endpoint, structured payload detection
Files in scope: server/src/agent/routes.ts, server/src/agent/routes.test.ts — no other files
Test framework: Vitest
Available after: T2 (confirmRegenerateBoard + cancelRegenerateBoard must exist in service)
Architecture rule: routes.ts is a thin layer — no business logic, only payload detection + service delegation
[RESTATE: message endpoint must remain backward compatible — existing { message: string } payloads must still work]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a POST to message endpoint with `{ action: "confirm_regenerate" }`, When processed, Then service.confirmRegenerateBoard is called with boardId and workspaceId
Given a POST to message endpoint with `{ action: "cancel_regenerate" }`, When processed, Then service.cancelRegenerateBoard is called with boardId
Given a POST to message endpoint with `{ message: "some text" }`, When processed, Then existing sendMessage flow is used (backward compatible)
Given a POST to message endpoint with empty body, When processed, Then returns 400 error
Given realDeps is constructed, Then getConversationHistory, deleteOutputsForBoard, deleteCardsForBoard, classifyFollowUpIntent are all wired

All tests PASS. Commit exists with message matching `feat(agent): add structured payload handling for regenerate confirmation`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Message endpoint accepts { action: "confirm_regenerate" } and { action: "cancel_regenerate" }
- Backward compatible with existing { message: string } payloads
- New deps (getConversationHistory, deleteOutputsForBoard, deleteCardsForBoard) wired in realDeps
- Tests written BEFORE implementation (TDD — not after)

Must-not-have:

- Business logic in routes (delegate to service)
- New endpoints (reuse existing message endpoint)
- Modifications to files outside routes.ts and routes.test.ts

Open question risks:

- None

Rollback note:

- Revert routes.ts to restore old message endpoint behavior

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: never
Escalate when: if route needs to handle streaming for structured payloads (should not — streaming only for ASK/REFINE)

---

### Task 4: Client AgentPage Follow-Up UI [depends: T2] [parallel: T3]

---

## OBJECTIVE

Update `client/src/pages/AgentPage.tsx` to: (1) enable input when board is done/failed (not just before board exists), (2) render follow-up response tokens as chat bubbles in the right panel, (3) render confirmation buttons for NEW_DIRECTION responses, (4) filter `__notfirst__` events from column state derivation, (5) disable input during pending regeneration.

Files:

- Modify: `client/src/pages/AgentPage.tsx`
- Test: `client/src/pages/AgentPage.test.tsx`

Steps:

1. Write failing tests for: input enabled when board is done, follow-up bubbles render, NEW_DIRECTION buttons render, **notfirst** filtered from column state
   File: `client/src/pages/AgentPage.test.tsx`
   Test verifies:
   - Given a board with executionStatus "done", When rendered, Then input is enabled (not disabled)
   - Given a board with executionStatus "done", When user types and sends a follow-up, Then api.sendAgentBoardMessage is called with the message
   - Given SSE events with columnSlug "**notfirst**" and tokens, When rendered, Then tokens appear as a chat bubble (not in column tiles)
   - Given a follow-up response with NEW_DIRECTION metadata, When rendered, Then "Ya, Regenerate" and "Batal" buttons appear
   - Given user clicks "Ya, Regenerate", When processed, Then api.sendAgentBoardMessage is called with `{ action: "confirm_regenerate" }`
   - Given user clicks "Batal", When processed, Then api.sendAgentBoardMessage is called with `{ action: "cancel_regenerate" }`
   - Given board.executionStatus is "running", When rendered, Then input is disabled with "Execution in progress..." placeholder
   - Given pending regeneration state, When rendered, Then input is disabled

2. Run tests — verify FAIL:
   `npx vitest run client/src/pages/AgentPage.test.tsx`
   Expected failure: follow-up rendering and button handling do not exist yet

3. Implement AgentPage follow-up UI:
   File: `client/src/pages/AgentPage.tsx`
   Implement:
   - Update input `disabled` condition: enable when `isDone || isFailed` (currently disabled when `board?.status === "approved"` — change to only disable when `isRunning` or pending regeneration)
   - Add `followUpMessages` state: `Array<{ role: "user" | "assistant"; content: string; intent?: string }>` — populated from SSE **notfirst** tokens + user messages
   - Render follow-up messages as chat bubbles below the existing board explanation area
   - Filter `__notfirst__` from `logEvents` (add to existing filter)
   - Add `pendingRegenerate` state tracking: when NEW_DIRECTION response received, show confirmation buttons
   - Add button handlers:
     - "Ya, Regenerate" → call `api.sendAgentBoardMessage(workspaceId, boardId, { action: "confirm_regenerate" })`
     - "Batal" → call `api.sendAgentBoardMessage(workspaceId, boardId, { action: "cancel_regenerate" })`
   - Track **notfirst** tokens from agentEvents and render as streaming assistant bubble
   - Disable input during pending regeneration (same pattern as `isRunning`)

4. Run tests — verify PASS:
   `npx vitest run client/src/pages/AgentPage.test.tsx`
   Expected: all new tests PASS

5. Commit:
   `git add client/src/pages/AgentPage.tsx client/src/pages/AgentPage.test.tsx`
   `git commit -m "feat(agent): add follow-up chat UI with regenerate confirmation buttons"`

## REFERENCES LOADED

docs/pocket/spec/2026-06-17-agent-multi-turn-conversation/spec.md — Rules 1, 3, 5 (follow-up response, confirmation, SSE streaming). GWT: 8 scenarios.
client/src/pages/AgentPage.tsx — existing page structure: left panel (board visual), right panel (chat + log). Queue system for message handling. deriveColumnState for column states. Input disabled conditions.
client/src/pages/AgentPage.test.tsx — existing test patterns for AgentPage rendering.
client/src/types.ts — AgentEvent type (includes columnSlug, token, boardId).
client/src/lib/agentColumnState.ts — deriveColumnState filters by boardId + columnSlug.
client/src/lib/agentStream.ts — deriveStreamedOutputForColumn, deriveThinkingForColumn patterns.

## WHY THIS APPROACH

Justification: 1 file (AgentPage is the main consumer). Follow-up UI reuses existing right panel layout. **notfirst** slug is a convention — column state derivation already filters by columnSlug, so adding **notfirst** exclusion is minimal.
Complexity: standard — new state management, conditional rendering, button handlers, SSE token tracking.

## SANDWICH CONTEXT

[CRITICAL: **notfirst** events must NOT affect column state derivation — deriveColumnState must filter them out to prevent column tiles from changing state]
You are implementing the client UI for Agent Multi-Turn Conversation follow-up interactions.
Spec: docs/pocket/spec/2026-06-17-agent-multi-turn-conversation/spec.md
Design decision: Option A — follow-up tokens use agent.card.token with columnSlug "**notfirst**"
Files in scope: client/src/pages/AgentPage.tsx, client/src/pages/AgentPage.test.tsx — no other files
Test framework: Vitest with jsdom
Available after: T2 (sendMessage must handle follow-ups server-side)
Architecture rule: **notfirst** events excluded from deriveColumnState — column tiles must stay in their current state
[RESTATE: **notfirst** events must NOT affect column state derivation — deriveColumnState must filter them out]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a board with executionStatus "done", When rendered, Then input is enabled and placeholder says "Follow up about this board..."
Given SSE events with columnSlug "**notfirst**" and tokens, When rendered, Then tokens appear as a streaming assistant chat bubble in the right panel
Given a follow-up response with NEW_DIRECTION intent, When rendered, Then "Ya, Regenerate" and "Batal" buttons appear below the response
Given user clicks "Ya, Regenerate", When processed, Then api.sendAgentBoardMessage is called with structured payload { action: "confirm_regenerate" }
Given user clicks "Batal", When processed, Then api.sendAgentBoardMessage is called with structured payload { action: "cancel_regenerate" }
Given board.executionStatus is "running", When rendered, Then input is disabled
Given **notfirst** SSE events exist, When deriveColumnState is called, Then columns remain in their current state (not affected by **notfirst**)

All tests PASS. Commit exists with message matching `feat(agent): add follow-up chat UI with regenerate confirmation buttons`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Input enabled when board is done/failed
- Follow-up tokens rendered as chat bubbles (not in column tiles)
- NEW_DIRECTION renders confirmation buttons
- **notfirst** events excluded from column state derivation
- Input disabled during pending regeneration
- Tests written BEFORE implementation (TDD — not after)

Must-not-have:

- Modifications to deriveColumnState in agentColumnState.ts (that's T5)
- New components outside AgentPage.tsx (inline the follow-up UI)
- Modifications to files outside AgentPage.tsx and AgentPage.test.tsx

Open question risks:

- None

Rollback note:

- Revert AgentPage.tsx to restore old input behavior (disabled when board approved)

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: never
Escalate when: if **notfirst** events need a new SSE event type (should reuse existing agent.card.token)

---

### Task 5: Client API + Stream Support Updates [depends: T3, T4]

---

## OBJECTIVE

Update `client/src/api.ts` to accept structured payloads in `sendAgentBoardMessage`. Update `client/src/lib/agentColumnState.ts` to filter `__notfirst__` columnSlug from state derivation. Update `client/src/types.ts` if needed for new response types.

Files:

- Modify: `client/src/api.ts`
- Modify: `client/src/lib/agentColumnState.ts`
- Test: `client/src/lib/agentColumnState.test.ts`
- Test: `client/src/api.test.ts`

Steps:

1. Write failing tests for: sendAgentBoardMessage accepts structured payload; deriveColumnState filters **notfirst** events
   File: `client/src/lib/agentColumnState.test.ts`
   File: `client/src/api.test.ts`
   Test verifies:
   - Given agentEvents with columnSlug "**notfirst**", When deriveColumnState is called for a regular column, Then column state is unaffected by **notfirst** events
   - Given agentEvents with mixed regular and **notfirst** events, When deriveColumnState is called, Then only regular columnSlug events affect state
   - Given sendAgentBoardMessage called with `{ action: "confirm_regenerate" }`, When fetch is made, Then body contains the structured payload
   - Given sendAgentBoardMessage called with a string message, When fetch is made, Then body contains `{ message: string }` (backward compatible)

2. Run tests — verify FAIL:
   `npx vitest run client/src/lib/agentColumnState.test.ts client/src/api.test.ts`
   Expected failure: **notfirst** filtering does not exist; sendAgentBoardMessage does not accept structured payload

3. Implement API + stream updates:
   File: `client/src/api.ts`
   Implement:
   - Update `sendAgentBoardMessage` signature to accept `string | { action: "confirm_regenerate" | "cancel_regenerate" }`
   - If argument is string → body: `{ message: string }` (existing behavior)
   - If argument is object → body: `{ action: string }`

   File: `client/src/lib/agentColumnState.ts`
   Implement:
   - Update `deriveColumnState` to exclude events where `columnSlug === "__notfirst__"` from the `scoped` filter

   File: `client/src/types.ts` (if needed):
   - Update `AgentBoard` type if response shape changes (likely no change needed)

4. Run tests — verify PASS:
   `npx vitest run client/src/lib/agentColumnState.test.ts client/src/api.test.ts`
   Expected: all new tests PASS

5. Commit:
   `git add client/src/api.ts client/src/lib/agentColumnState.ts client/src/lib/agentColumnState.test.ts client/src/api.test.ts`
   `git commit -m "feat(agent): update API for structured payloads and filter __notfirst__ from column state"`

## REFERENCES LOADED

docs/pocket/spec/2026-06-17-agent-multi-turn-conversation/spec.md — Rule 5 (SSE streaming), Rule 3 (structured payload). GWT: 4 scenarios.
client/src/api.ts — existing sendAgentBoardMessage sends `{ message: string }`. ApiError class.
client/src/lib/agentColumnState.ts — deriveColumnState filters by boardId + columnSlug. Existing test file.
client/src/types.ts — AgentEvent type, AgentBoard type.
client/src/api.test.ts — existing test patterns for API calls.

## WHY THIS APPROACH

Justification: 3-4 files, but each change is small. API signature change is backward compatible (union type). deriveColumnState filter is a one-line addition.
Complexity: lightweight — small, focused changes across a few files.

## SANDWICH CONTEXT

[CRITICAL: sendAgentBoardMessage must remain backward compatible — string argument must still work exactly as before]
You are implementing API and stream utilities for Agent Multi-Turn Conversation.
Spec: docs/pocket/spec/2026-06-17-agent-multi-turn-conversation/spec.md
Design decision: structured payload via union type; **notfirst** slug filtering
Files in scope: client/src/api.ts, client/src/lib/agentColumnState.ts, client/src/lib/agentColumnState.test.ts, client/src/api.test.ts — no other files
Test framework: Vitest with jsdom
Available after: T3 (routes must accept structured payloads), T4 (AgentPage must consume new API)
Architecture rule: api.ts is a thin fetch wrapper — no business logic
[RESTATE: sendAgentBoardMessage must remain backward compatible — string argument must still work exactly as before]

## DELIVERABLE

Verification — task is DONE when all pass:

Given sendAgentBoardMessage called with string "hello", When fetch is made, Then body is `{ message: "hello" }` and response type is unchanged
Given sendAgentBoardMessage called with `{ action: "confirm_regenerate" }`, When fetch is made, Then body is `{ action: "confirm_regenerate" }`
Given agentEvents with **notfirst** columnSlug, When deriveColumnState is called for regular column "research", Then column state is unaffected by **notfirst** events
Given agentEvents with regular columnSlug "research" and boardId 1, When deriveColumnState is called, Then state reflects the regular events (started → active, done → done)

All tests PASS. Commit exists with message matching `feat(agent): update API for structured payloads and filter __notfirst__ from column state`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- sendAgentBoardMessage accepts both string and structured payload
- Backward compatible — string argument works exactly as before
- deriveColumnState filters out **notfirst** events
- Tests written BEFORE implementation (TDD — not after)

Must-not-have:

- New API endpoints
- Business logic in api.ts
- Modifications to files outside listed scope

Open question risks:

- None

Rollback note:

- Revert api.ts and agentColumnState.ts to restore old behavior

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: never
Escalate when: if AgentEvent type needs new fields (check with T4 first)

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | classifyFollowUpIntent + Scope Guard Prompt | prereq | standard | Returns { intent, response, confidence } for all 4 intent types |
| T2 | Service sendMessage Upgrade + regenerateBoard | T1 | standard | sendMessage handles done boards, regenerate clears + re-runs |
| T3 | Routes Structured Payload Handling | T2 | lightweight | Message endpoint accepts confirm/cancel payloads |
| T4 | Client AgentPage Follow-Up UI | T2 | standard | Follow-up bubbles + regenerate buttons render correctly |
| T5 | Client API + Stream Support Updates | T3, T4 | lightweight | API accepts structured payload, **notfirst** filtered from column state |
