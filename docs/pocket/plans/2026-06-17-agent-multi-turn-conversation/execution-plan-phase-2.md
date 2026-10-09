# Agent Multi-Turn Conversation — Client API + Stream Support Updates (Phase 2 of 2)

**Date:** 2026-06-17
**Original plan:** /Users/rfxlamia/project/kanban/docs/pocket/plans/2026-06-17-agent-multi-turn-conversation/execution-plan.md
**Prerequisite:** Phase 1 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T5, T6, T7}
**Unlocks next:** All phases complete — proceed to final validation

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

T5: Client API + Stream Support Updates [depends: T3, T4]
T6: Integration — Follow-Up Message Flow [depends: T5]
T7: Integration — Regenerate Confirmation Flow [depends: T5]

---

## Pocket Packets

---

### Task 5: Client API + Stream Support Updates [depends: T3, T4]

## OBJECTIVE

Update `client/src/api.ts` to accept structured payloads in `sendAgentBoardMessage`. Update `client/src/lib/agentColumnState.ts` to filter `__notfirst__` columnSlug from state derivation. Update `client/src/types.ts` if needed for new response types.

Files:

- Modify: `client/src/api.ts`
- Modify: `client/src/lib/agentColumnState.ts`
- Test: `client/src/lib/agentColumnState.test.ts`
- Test: `client/src/api.test.ts`

Steps:

1. Write failing tests for: sendAgentBoardMessage accepts structured payload; deriveColumnState filters __notfirst__ events
   File: `client/src/lib/agentColumnState.test.ts`
   File: `client/src/api.test.ts`
   Test verifies:
   - Given agentEvents with columnSlug "__notfirst__", When deriveColumnState is called for a regular column, Then column state is unaffected by __notfirst__ events
   - Given agentEvents with mixed regular and __notfirst__ events, When deriveColumnState is called, Then only regular columnSlug events affect state
   - Given sendAgentBoardMessage called with `{ action: "confirm_regenerate" }`, When fetch is made, Then body contains the structured payload
   - Given sendAgentBoardMessage called with a string message, When fetch is made, Then body contains `{ message: string }` (backward compatible)

   ```typescript
   // Add to client/src/lib/agentColumnState.test.ts — after existing describe block

   describe("deriveColumnState __notfirst__ filtering", () => {
     it("ignores events with columnSlug __notfirst__ when deriving state for a regular column", () => {
       const events: AgentEvent[] = [
         {
           type: "agent.card.started",
           columnSlug: "research-specialist",
           boardId: BOARD,
         } as AgentEvent,
         {
           type: "agent.card.token",
           columnSlug: "__notfirst__",
           boardId: BOARD,
           token: "follow-up text",
         } as AgentEvent,
         {
           type: "agent.card.done",
           columnSlug: "research-specialist",
           boardId: BOARD,
         } as AgentEvent,
       ];
       // Regular column should still be "done" despite __notfirst__ events
       expect(deriveColumnState(events, BOARD, "research-specialist", "running")).toBe("done");
     });

     it("does not affect pending column state when only __notfirst__ events exist", () => {
       const events: AgentEvent[] = [
         {
           type: "agent.card.token",
           columnSlug: "__notfirst__",
           boardId: BOARD,
           token: "follow-up response",
         } as AgentEvent,
         {
           type: "agent.card.done",
           columnSlug: "__notfirst__",
           boardId: BOARD,
         } as AgentEvent,
       ];
       // Regular column with no events should remain pending
       expect(deriveColumnState(events, BOARD, SLUG, "running")).toBe("pending");
     });

     it("treats __notfirst__ events as invisible to column state derivation", () => {
       const events: AgentEvent[] = [
         {
           type: "agent.card.started",
           columnSlug: "__notfirst__",
           boardId: BOARD,
         } as AgentEvent,
         {
           type: "agent.card.token",
           columnSlug: "__notfirst__",
           boardId: BOARD,
           token: "streaming...",
         } as AgentEvent,
       ];
       // Column should be pending (no relevant events for this slug)
       expect(deriveColumnState(events, BOARD, SLUG, "running")).toBe("pending");
     });
   });
   ```

   ```typescript
   // Add to client/src/api.test.ts — after existing "Agent API methods" describe block

   describe("sendAgentBoardMessage structured payloads", () => {
     it("sends { message: string } body when called with a string argument", async () => {
       mockFetch.mockClear();
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () =>
           Promise.resolve({ explanation: "Got it", boardUpdated: false }),
       });
       const { api } = await import("./api");

       await api.sendAgentBoardMessage(7, 1, "What about subsidies?");

       const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
       expect(body).toEqual({ message: "What about subsidies?" });
     });

     it("sends { action: 'confirm_regenerate' } body when called with structured payload", async () => {
       mockFetch.mockClear();
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () =>
           Promise.resolve({ explanation: "Regenerating...", boardUpdated: true }),
       });
       const { api } = await import("./api");

       await api.sendAgentBoardMessage(7, 1, { action: "confirm_regenerate" });

       const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
       expect(body).toEqual({ action: "confirm_regenerate" });
     });

     it("sends { action: 'cancel_regenerate' } body when called with structured payload", async () => {
       mockFetch.mockClear();
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () =>
           Promise.resolve({ explanation: "Cancelled.", boardUpdated: false }),
       });
       const { api } = await import("./api");

       await api.sendAgentBoardMessage(7, 1, { action: "cancel_regenerate" });

       const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
       expect(body).toEqual({ action: "cancel_regenerate" });
     });

     it("preserves the POST method and correct URL for all payload types", async () => {
       mockFetch.mockClear();
       mockFetch.mockResolvedValue({
         ok: true,
         status: 200,
         json: () => Promise.resolve({ explanation: "ok", boardUpdated: false }),
       });
       const { api } = await import("./api");

       await api.sendAgentBoardMessage(7, 1, "hello");
       await api.sendAgentBoardMessage(7, 1, { action: "confirm_regenerate" });

       expect(mockFetch.mock.calls[0][0]).toBe(
         "/api/workspaces/7/agent/boards/1/message",
       );
       expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: "POST" });
       expect(mockFetch.mock.calls[1][0]).toBe(
         "/api/workspaces/7/agent/boards/1/message",
       );
       expect(mockFetch.mock.calls[1][1]).toMatchObject({ method: "POST" });
     });
   });
   ```

2. Run tests — verify FAIL:
   `npx vitest run client/src/lib/agentColumnState.test.ts client/src/api.test.ts`
   Expected failure: __notfirst__ filtering does not exist; sendAgentBoardMessage does not accept structured payload

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
Design decision: structured payload via union type; __notfirst__ slug filtering
Files in scope: client/src/api.ts, client/src/lib/agentColumnState.ts, client/src/lib/agentColumnState.test.ts, client/src/api.test.ts — no other files
Test framework: Vitest with jsdom
Available after: T3 (routes must accept structured payloads), T4 (AgentPage must consume new API)
Architecture rule: api.ts is a thin fetch wrapper — no business logic
[RESTATE: sendAgentBoardMessage must remain backward compatible — string argument must still work exactly as before]

## DELIVERABLE

Verification — task is DONE when all pass:

Given sendAgentBoardMessage called with string "hello", When fetch is made, Then body is `{ message: "hello" }` and response type is unchanged
Given sendAgentBoardMessage called with `{ action: "confirm_regenerate" }`, When fetch is made, Then body is `{ action: "confirm_regenerate" }`
Given agentEvents with __notfirst__ columnSlug, When deriveColumnState is called for regular column "research", Then column state is unaffected by __notfirst__ events
Given agentEvents with regular columnSlug "research" and boardId 1, When deriveColumnState is called, Then state reflects the regular events (started → active, done → done)

All tests PASS. Commit exists with message matching `feat(agent): update API for structured payloads and filter __notfirst__ from column state`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- sendAgentBoardMessage accepts both string and structured payload
- Backward compatible — string argument works exactly as before
- deriveColumnState filters out __notfirst__ events
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

### Task 6: Integration — Follow-Up Message Flow [depends: T5]

## OBJECTIVE

Verify the follow-up message flow at the **service level** (mocked `classifyFollowUpIntent` dep, no Express route) from `sendMessage` through intent switch to synthetic SSE emission and conversation storage. Exercises T2's `sendMessage` over T1's contract. NOTE: this consolidates all four intents into one pass and **overlaps T2's own unit tests** — it is a coverage backstop, not a new layer. If T2's tests already cover an intent identically, this is acceptable redundancy; do not duplicate beyond the all-intents sweep.

Files:

- Test: `server/src/agent/service.test.ts`

Steps:

1. Write failing test for: end-to-end follow-up flow with mocked classifyFollowUpIntent dep
   File: `server/src/agent/service.test.ts`
   Test verifies the full chain: sendMessage → classifyFollowUpIntent → switch on intent → stream + store

   ```typescript
   // Add to server/src/agent/service.test.ts — new describe block

   describe("integration: follow-up message flow (T1 + T2)", () => {
     it("ASK flow: classify → stream with __notfirst__ slug → store both user + assistant in conversations", async () => {
       const publishEvent = vi.fn(async () => {});
       const insertConversation = vi.fn(async () => {});
       const getArtifact = vi.fn(async () => ({
         filename: "ev-research.md",
         format: "md" as const,
         content: "# EV Market Research\n\nKey findings about charging infrastructure.",
       }));
       const getConversationHistory = vi.fn(async () => [
         { role: "user" as const, content: "What about subsidies?" },
         { role: "assistant" as const, content: "Subsidies are a key factor..." },
       ]);
       const classifyFollowUpIntent = vi.fn(async () => ({
         intent: "ASK" as const,
         response: "The research identified three key findings about charging infrastructure: (1) limited public charging network, (2) home charging as primary method, (3) fast-charging demand increasing.",
         confidence: 0.92,
       }));

       const service = createAgentBoardService({
         getBoard: vi.fn(async () => ({
           id: 42,
           status: "approved",
           executionStatus: "done",
           workspaceId: 7,
           userId: 1,
           originalIntent: "EV market research in Indonesia",
         })),
         getArtifact,
         getConversationHistory,
         classifyFollowUpIntent,
         insertConversation,
         publishEvent,
       });

       const result = await service.sendMessage({
         boardId: 42,
         userId: 1,
         workspaceId: 7,
         message: "What were the key findings about charging infrastructure?",
       });

       // 1. classifyFollowUpIntent called with full context
       expect(classifyFollowUpIntent).toHaveBeenCalledWith(
         "EV market research in Indonesia",
         "# EV Market Research\n\nKey findings about charging infrastructure.",
         expect.arrayContaining([
           expect.objectContaining({ role: "user", content: "What about subsidies?" }),
           expect.objectContaining({ role: "assistant", content: "Subsidies are a key factor..." }),
         ]),
         "What were the key findings about charging infrastructure?",
       );

       // 2. Response streamed via SSE with __notfirst__ slug
       expect(publishEvent).toHaveBeenCalledWith(
         7,
         expect.objectContaining({
           type: "agent.card.token",
           columnSlug: "__notfirst__",
           boardId: 42,
         }),
       );

       // 3. User message stored in conversations
       expect(insertConversation).toHaveBeenCalledWith(
         expect.objectContaining({
           boardId: 42,
           role: "user",
           content: "What were the key findings about charging infrastructure?",
         }),
       );

       // 4. Assistant response stored in conversations
       expect(insertConversation).toHaveBeenCalledWith(
         expect.objectContaining({
           boardId: 42,
           role: "assistant",
           content: expect.stringContaining("charging infrastructure"),
         }),
       );

       // 5. Result includes explanation
       expect(result).toMatchObject({
         explanation: expect.stringContaining("charging infrastructure"),
       });
     });

     it("NEW_DIRECTION flow: classify → store pending → return confirmation with button metadata", async () => {
       const insertConversation = vi.fn(async () => {});
       const publishEvent = vi.fn(async () => {});
       const classifyFollowUpIntent = vi.fn(async () => ({
         intent: "NEW_DIRECTION" as const,
         response: "This is a different research topic. I will regenerate the board with focus on scooter competitor analysis.",
         confidence: 0.95,
       }));

       const service = createAgentBoardService({
         getBoard: vi.fn(async () => ({
           id: 42,
           status: "approved",
           executionStatus: "done",
           workspaceId: 7,
           userId: 1,
           originalIntent: "EV market research",
         })),
         getArtifact: vi.fn(async () => null),
         getConversationHistory: vi.fn(async () => []),
         classifyFollowUpIntent,
         insertConversation,
         publishEvent,
       });

       const result = await service.sendMessage({
         boardId: 42,
         userId: 1,
         workspaceId: 7,
         message: "Now analyze competitor landscape for electric scooters",
       });

       // Pending state stored, confirmation response returned
       expect(result).toMatchObject({
         explanation: expect.stringContaining("regenerate"),
         pendingRegenerate: true,
       });

       // No streaming for NEW_DIRECTION
       const streamCalls = publishEvent.mock.calls.filter(
         (c: any[]) => c[1]?.type === "agent.card.token",
       );
       expect(streamCalls).toHaveLength(0);
     });

     it("OFF_TOPIC flow: classify → return static rejection → no streaming → still stored in conversations", async () => {
       const publishEvent = vi.fn(async () => {});
       const insertConversation = vi.fn(async () => {});
       const classifyFollowUpIntent = vi.fn(async () => ({
         intent: "OFF_TOPIC" as const,
         response: "I can help with research for your board, but writing code is outside my scope. You can create a new board for a different task.",
         confidence: 0.97,
       }));

       const service = createAgentBoardService({
         getBoard: vi.fn(async () => ({
           id: 42,
           status: "approved",
           executionStatus: "done",
           workspaceId: 7,
           userId: 1,
           originalIntent: "EV market research",
         })),
         getArtifact: vi.fn(async () => null),
         getConversationHistory: vi.fn(async () => []),
         classifyFollowUpIntent,
         insertConversation,
         publishEvent,
       });

       const result = await service.sendMessage({
         boardId: 42,
         userId: 1,
         workspaceId: 7,
         message: "Write me a Python script to scrape data",
       });

       // Static rejection returned
       expect(result).toMatchObject({
         explanation: expect.stringContaining("outside my scope"),
       });

       // No streaming
       expect(publishEvent).not.toHaveBeenCalled();

       // Both user + assistant stored
       expect(insertConversation).toHaveBeenCalledTimes(2);
       expect(insertConversation).toHaveBeenCalledWith(
         expect.objectContaining({ role: "user" }),
       );
       expect(insertConversation).toHaveBeenCalledWith(
         expect.objectContaining({ role: "assistant" }),
       );
     });

     it("REFINE flow: classify → stream response → store in conversations", async () => {
       const publishEvent = vi.fn(async () => {});
       const insertConversation = vi.fn(async () => {});
       const classifyFollowUpIntent = vi.fn(async () => ({
         intent: "REFINE" as const,
         response: "I will add a section on 2025 government regulations and subsidies for EV adoption in Indonesia.",
         confidence: 0.88,
       }));

       const service = createAgentBoardService({
         getBoard: vi.fn(async () => ({
           id: 42,
           status: "approved",
           executionStatus: "done",
           workspaceId: 7,
           userId: 1,
           originalIntent: "EV market research",
         })),
         getArtifact: vi.fn(async () => ({
           filename: "ev.md",
           format: "md" as const,
           content: "# EV Research",
         })),
         getConversationHistory: vi.fn(async () => []),
         classifyFollowUpIntent,
         insertConversation,
         publishEvent,
       });

       const result = await service.sendMessage({
         boardId: 42,
         userId: 1,
         workspaceId: 7,
         message: "Add a section about 2025 government regulations",
       });

       // REFINE streams like ASK
       expect(publishEvent).toHaveBeenCalledWith(
         7,
         expect.objectContaining({
           type: "agent.card.token",
           columnSlug: "__notfirst__",
         }),
       );

       expect(insertConversation).toHaveBeenCalledWith(
         expect.objectContaining({
           role: "assistant",
           content: expect.stringContaining("regulations"),
         }),
       );
     });
   });
   ```

2. Run tests — verify FAIL:
   `npx vitest run server/src/agent/service.test.ts`
   Expected failure: sendMessage does not yet handle done boards

3. Implement: No new implementation needed — this test exercises T1 + T2 code together. Tests should pass once T1 and T2 are both complete.

4. Run tests — verify PASS:
   `npx vitest run server/src/agent/service.test.ts`
   Expected: all integration tests PASS (depends on T1 + T2 being complete)

5. Commit:
   `git add server/src/agent/service.test.ts`
   `git commit -m "test(agent): add integration tests for follow-up message flow"`

## DELIVERABLE

All 4 intent types (ASK, REFINE, NEW_DIRECTION, OFF_TOPIC) verified end-to-end through the service layer with mocked LLM dep. SSE streaming with __notfirst__ slug verified. Conversation storage verified.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

---

### Task 7: Integration — Regenerate Confirmation Flow [depends: T5]

## OBJECTIVE

Verify the regeneration flow at the **service level** (mocked deps, no Express route): sendMessage with NEW_DIRECTION stores pending state, then confirmRegenerateBoard performs the full mutation chain (update intent → delete outputs → delete cards → fire-and-forget re-run pipeline). The re-run is asserted via `getColumns`/`executeCard` being invoked (flushed with fake timers), not just the deletes. Also verify cancelRegenerateBoard clears state without mutations. (Route delegation is covered by `resolveMessageAction` in T3.)

Files:

- Test: `server/src/agent/service.test.ts`

Steps:

1. Write failing test for: full regenerate confirmation and cancellation flows
   File: `server/src/agent/service.test.ts`
   Test verifies the chain: sendMessage(NEW_DIRECTION) → confirmRegenerateBoard → updateBoard + deleteOutputs + deleteCards + runPipeline

   ```typescript
   // Add to server/src/agent/service.test.ts — new describe block

   describe("integration: regenerate confirmation flow (T2 + T3)", () => {
     it("full confirm flow: sendMessage(NEW_DIRECTION) → confirmRegenerateBoard updates intent, clears outputs, re-runs pipeline", async () => {
       vi.useFakeTimers();
       const updateBoard = vi.fn(async () => {});
       const deleteOutputsForBoard = vi.fn(async () => {});
       const deleteCardsForBoard = vi.fn(async () => {});
       const insertConversation = vi.fn(async () => {});
       const publishEvent = vi.fn(async () => {});
       const getBoard = vi.fn(async () => ({
         id: 42,
         status: "approved",
         executionStatus: "done",
         workspaceId: 7,
         userId: 1,
         originalIntent: "EV market research in Indonesia",
       }));
       // runPipeline deps — hoisted so we can assert the pipeline re-ran
       const getColumns = vi.fn(async () => [
         {
           columnId: 10,
           columnSlug: "research-specialist",
           systemPrompt: "Research: {original_intent}",
           reasoning: false,
         },
       ]);
       const executeCard = vi.fn(async () => ({ output: "New research output" }));

       const service = createAgentBoardService({
         getBoard,
         updateBoard,
         deleteOutputsForBoard,
         deleteCardsForBoard,
         insertConversation,
         publishEvent,
         getArtifact: vi.fn(async () => null),
         getConversationHistory: vi.fn(async () => []),
         classifyFollowUpIntent: vi.fn(async () => ({
           intent: "NEW_DIRECTION" as const,
           response: "This is a different topic. I will regenerate the board.",
           confidence: 0.93,
         })),
         getColumns,
         executeCard,
         insertOutput: vi.fn(async () => {}),
         insertCard: vi.fn(async () => {}),
       });

       // Step 1: Send NEW_DIRECTION message
       const sendResult = await service.sendMessage({
         boardId: 42,
         userId: 1,
         workspaceId: 7,
         message: "Now research competitor landscape for electric scooters",
       });
       expect(sendResult).toMatchObject({ pendingRegenerate: true });

       // Step 2: Confirm regeneration
       const confirmPromise = service.confirmRegenerateBoard({
         boardId: 42,
         workspaceId: 7,
       });
       await vi.runAllTimersAsync();
       await confirmPromise;

       // Step 3: Verify mutations
       expect(updateBoard).toHaveBeenCalledWith(42, expect.objectContaining({
         original_intent: expect.stringContaining("scooter"),
       }));
       expect(deleteOutputsForBoard).toHaveBeenCalledWith(42);
       expect(deleteCardsForBoard).toHaveBeenCalledWith(42);

       // Step 4: Pipeline actually re-ran. confirmRegenerateBoard fires
       // this.runPipeline non-awaited; vi.runAllTimersAsync() flushes it.
       // Assert the re-execution really happened (Rule 4), not just the deletes.
       expect(getColumns).toHaveBeenCalledWith(42);
       expect(executeCard).toHaveBeenCalled();
       vi.useRealTimers();
     });

     it("cancel flow: sendMessage(NEW_DIRECTION) → cancelRegenerateBoard clears pending without mutations", async () => {
       const updateBoard = vi.fn(async () => {});
       const deleteOutputsForBoard = vi.fn(async () => {});
       const insertConversation = vi.fn(async () => {});

       const service = createAgentBoardService({
         getBoard: vi.fn(async () => ({
           id: 42,
           status: "approved",
           executionStatus: "done",
           workspaceId: 7,
           userId: 1,
           originalIntent: "EV market research",
         })),
         updateBoard,
         deleteOutputsForBoard,
         deleteCardsForBoard: vi.fn(async () => {}),
         insertConversation,
         publishEvent: vi.fn(async () => {}),
         getArtifact: vi.fn(async () => null),
         getConversationHistory: vi.fn(async () => []),
         classifyFollowUpIntent: vi.fn(async () => ({
           intent: "NEW_DIRECTION" as const,
           response: "Regenerating...",
           confidence: 0.9,
         })),
       });

       // Trigger pending state
       await service.sendMessage({
         boardId: 42,
         userId: 1,
         workspaceId: 7,
         message: "Research scooters",
       });

       // Cancel
       await service.cancelRegenerateBoard({ boardId: 42, workspaceId: 7 });

       // No mutations
       expect(updateBoard).not.toHaveBeenCalled();
       expect(deleteOutputsForBoard).not.toHaveBeenCalled();

       // Cancellation message stored
       expect(insertConversation).toHaveBeenCalledWith(
         expect.objectContaining({
           boardId: 42,
           role: "assistant",
           content: expect.stringMatching(/cancel|batal/i),
         }),
       );
     });

     it("conversation history preserved after regeneration", async () => {
       vi.useFakeTimers();
       const existingHistory = [
         { role: "user" as const, content: "What about subsidies?" },
         { role: "assistant" as const, content: "Subsidies are important..." },
       ];
       const insertConversation = vi.fn(async () => {});

       const service = createAgentBoardService({
         getBoard: vi.fn(async () => ({
           id: 42,
           status: "approved",
           executionStatus: "done",
           workspaceId: 7,
           userId: 1,
           originalIntent: "EV market research",
         })),
         updateBoard: vi.fn(async () => {}),
         deleteOutputsForBoard: vi.fn(async () => {}),
         deleteCardsForBoard: vi.fn(async () => {}),
         insertConversation,
         publishEvent: vi.fn(async () => {}),
         getArtifact: vi.fn(async () => null),
         getConversationHistory: vi.fn(async () => existingHistory),
         classifyFollowUpIntent: vi.fn(async () => ({
           intent: "NEW_DIRECTION" as const,
           response: "Regenerating...",
           confidence: 0.9,
         })),
         getColumns: vi.fn(async () => []),
         executeCard: vi.fn(async () => ({ output: "new output" })),
         insertOutput: vi.fn(async () => {}),
         insertCard: vi.fn(async () => {}),
       });

       // Send + confirm
       await service.sendMessage({
         boardId: 42,
         userId: 1,
         workspaceId: 7,
         message: "Research scooters",
       });
       const confirmPromise = service.confirmRegenerateBoard({
         boardId: 42,
         workspaceId: 7,
       });
       await vi.runAllTimersAsync();
       await confirmPromise;

       // Original conversation history is not deleted — only new messages appended
       // deleteOutputsForBoard deletes agent_card_outputs, NOT agent_conversations
       // The history from the old topic survives
       expect(insertConversation).toHaveBeenCalled();
       vi.useRealTimers();
     });
   });
   ```

2. Run tests — verify FAIL:
   `npx vitest run server/src/agent/service.test.ts`
   Expected failure: confirmRegenerateBoard does not exist yet

3. Implement: No new implementation needed — this test exercises T2 code. Tests should pass once T2 is complete.

4. Run tests — verify PASS:
   `npx vitest run server/src/agent/service.test.ts`
   Expected: all integration tests PASS (depends on T2 being complete)

5. Commit:
   `git add server/src/agent/service.test.ts`
   `git commit -m "test(agent): add integration tests for regenerate confirmation flow"`

## DELIVERABLE

Full regenerate flow verified: NEW_DIRECTION → pending state → confirm → mutations → pipeline re-run. Cancel flow verified: no mutations. Conversation history preservation verified.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to (none — all phases complete) ONLY after this gate passes.
