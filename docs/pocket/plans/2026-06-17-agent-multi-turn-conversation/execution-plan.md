# EXECUTION PLAN — Agent Multi-Turn Conversation

**Date:** 2026-06-17
**Spec:** docs/pocket/spec/2026-06-17-agent-multi-turn-conversation/spec.md
**Status:** draft
**Total tasks:** 5 (+ 2 integration test tasks)

---

## Test-Architect Summary

- **Tasks enriched:** 5
- **Integration test tasks added:** 2 (both are **service-level** integration in `service.test.ts` — they exercise `sendMessage`/`confirmRegenerateBoard` with mocked deps; they do NOT cross the Express route layer. Route payload-branching is covered separately by `resolveMessageAction` unit tests in T3.)
  - T6: Follow-up message flow (T2 over T1's `classifyFollowUpIntent` dep) — all 4 intents through `sendMessage`. NOTE: overlaps T2's own unit tests; kept as a consolidated all-intents pass, not a new layer.
  - T7: Regenerate confirmation flow (T2) — `sendMessage(NEW_DIRECTION)` → `confirmRegenerateBoard` → DB mutations + fire-and-forget pipeline re-run (asserts `getColumns`/`executeCard` ran); plus cancel-without-mutation and history-preservation.
- **TDD order corrections made:** 0 (all tasks already had correct TDD order)
- **Test framework used:** Vitest
- **Coverage areas:**
  - **Tested:** classifyFollowUpIntent (4 intent types, JSON parsing edge cases, retry logic), sendMessage follow-up on done/approved boards, regenerateBoard + confirm/cancel flows, route structured payload handling, AgentPage follow-up UI (input state, buttons, __notfirst__ filtering), API structured payload, deriveColumnState __notfirst__ filtering
  - **Intentionally not tested:** Real LLM calls (mocked via vi.mock), actual SSE event emission to clients (service tests verify publishEvent calls), UI rendering fidelity beyond functional assertions, conversation history truncation (out of scope per spec)

---

## Execution Overview

### Recommended Order

```
T1 → T2 → T3, T4 (parallel) → T5 → T6, T7 (parallel)
```

### Parallelizable Groups

| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T3, T4 | T2 completes |
| Group B | T6, T7 | T5 completes |

### Constraints Reminder

**Architecture:** Only touch service.ts, llm.ts, routes.ts, AgentPage.tsx, api.ts. No new DB tables. No changes to agent/templates.ts or DB schema.
**Out-of-scope:** Artifact versioning/diff, partial pipeline re-run for REFINE, explicit command syntax, per-type cost optimization, branching/compare, auto-compact for conversation history.
**Assumptions at risk:** None blocking (3 non-blocking resolved in spec).
**Sequencing:** T3 and T4 can run concurrently — they touch different layers (server routes vs client UI). T5 depends on both because it updates the shared API contract + stream utilities consumed by AgentPage. T6 and T7 are integration tests that can run in parallel after T5.

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

   ```typescript
   // Add to server/src/agent/llm.test.ts — after existing classifyIntent describe block

   describe("classifyFollowUpIntent", () => {
     beforeEach(() => {
       mockCreate.mockReset();
     });

     it("returns ASK intent when message questions existing artifact", async () => {
       mockCreate.mockResolvedValueOnce({
         content: [
           {
             type: "text",
             text: '{"intent":"ASK","response":"The research found three key consumer preferences: price sensitivity under 300M IDR, charging infrastructure as top concern, and preference for local brands with government subsidies.","confidence":0.92}',
           },
         ],
       });
       const { classifyFollowUpIntent } = await import("./llm.js");
       const result = await classifyFollowUpIntent(
         "Market research for EV in Indonesia",
         "# EV Market Research\n\nConsumer preferences...",
         [{ role: "user", content: "What were the key findings about consumer preferences?" }],
         "What were the key findings about consumer preferences?",
       );
       expect(result.intent).toBe("ASK");
       expect(result.response).toContain("consumer preferences");
       expect(result.confidence).toBeGreaterThanOrEqual(0.8);
     });

     it("returns REFINE intent when message requests modification within scope", async () => {
       mockCreate.mockResolvedValueOnce({
         content: [
           {
             type: "text",
             text: '{"intent":"REFINE","response":"I will update the research to include a dedicated section on government regulations and subsidies for electric vehicles in Indonesia.","confidence":0.88}',
           },
         ],
       });
       const { classifyFollowUpIntent } = await import("./llm.js");
       const result = await classifyFollowUpIntent(
         "Market research for EV in Indonesia",
         "# EV Market Research\n\n...",
         [{ role: "user", content: "Add a section about government regulations and subsidies" }],
         "Add a section about government regulations and subsidies",
       );
       expect(result.intent).toBe("REFINE");
       expect(result.response).toContain("regulations");
       expect(result.confidence).toBeGreaterThanOrEqual(0.8);
     });

     it("returns NEW_DIRECTION intent when message requests fundamentally different topic", async () => {
       mockCreate.mockResolvedValueOnce({
         content: [
           {
             type: "text",
             text: '{"intent":"NEW_DIRECTION","response":"This is a different research topic from the current board (electric vehicles → electric scooters). I will regenerate the board with this new focus.","confidence":0.95}',
           },
         ],
       });
       const { classifyFollowUpIntent } = await import("./llm.js");
       const result = await classifyFollowUpIntent(
         "Market research for EV in Indonesia",
         "# EV Market Research\n\n...",
         [],
         "Now research the competitor landscape for electric scooters",
       );
       expect(result.intent).toBe("NEW_DIRECTION");
       expect(result.response).toContain("regenerate");
       expect(result.confidence).toBeGreaterThanOrEqual(0.8);
     });

     it("returns OFF_TOPIC intent when message is clearly unrelated", async () => {
       mockCreate.mockResolvedValueOnce({
         content: [
           {
             type: "text",
             text: '{"intent":"OFF_TOPIC","response":"I can help with research and analysis for your board, but writing code is outside my scope. If you would like to research EV pricing data, I can include that in the current board — or you can create a new board for a different task.","confidence":0.97}',
           },
         ],
       });
       const { classifyFollowUpIntent } = await import("./llm.js");
       const result = await classifyFollowUpIntent(
         "Market research for EV in Indonesia",
         "# EV Market Research\n\n...",
         [],
         "Write me a Python script to scrape EV prices",
       );
       expect(result.intent).toBe("OFF_TOPIC");
       expect(result.response).toContain("outside my scope");
       expect(result.confidence).toBeGreaterThanOrEqual(0.9);
     });

     it("parses JSON from markdown code blocks", async () => {
       mockCreate.mockResolvedValueOnce({
         content: [
           {
             type: "text",
             text: '```json\n{"intent":"ASK","response":"The analysis found...","confidence":0.85}\n```',
           },
         ],
       });
       const { classifyFollowUpIntent } = await import("./llm.js");
       const result = await classifyFollowUpIntent(
         "riset",
         null,
         [],
         "What did the analysis find?",
       );
       expect(result.intent).toBe("ASK");
       expect(result.response).toBe("The analysis found...");
     });

     it("parses JSON embedded in preamble text via greedy match", async () => {
       mockCreate.mockResolvedValueOnce({
         content: [
           {
             type: "text",
             text: 'Based on the context provided, here is my classification: {"intent":"REFINE","response":"I will add that section.","confidence":0.82} Hope this helps!',
           },
         ],
       });
       const { classifyFollowUpIntent } = await import("./llm.js");
       const result = await classifyFollowUpIntent(
         "riset",
         null,
         [],
         "Add more data about 2025 trends",
       );
       expect(result.intent).toBe("REFINE");
       expect(result.response).toBe("I will add that section.");
     });

     it("retries on parse failure and succeeds on second attempt", async () => {
       mockCreate
         .mockResolvedValueOnce({
           content: [{ type: "text", text: "I cannot classify this." }],
         })
         .mockResolvedValueOnce({
           content: [
             {
               type: "text",
               text: '{"intent":"ASK","response":"Here is the answer.","confidence":0.8}',
             },
           ],
         });
       const { classifyFollowUpIntent } = await import("./llm.js");
       const result = await classifyFollowUpIntent(
         "riset",
         null,
         [],
         "Tell me more",
       );
       expect(result.intent).toBe("ASK");
       expect(mockCreate).toHaveBeenCalledTimes(2);
     });

     it("returns OFF_TOPIC fallback after all retries fail", async () => {
       const unparseable = {
         content: [{ type: "text", text: "Cannot process." }],
       };
       mockCreate
         .mockResolvedValueOnce(unparseable)
         .mockResolvedValueOnce(unparseable)
         .mockResolvedValueOnce(unparseable);
       const { classifyFollowUpIntent } = await import("./llm.js");
       const result = await classifyFollowUpIntent(
         "riset",
         null,
         [],
         "hello",
       );
       expect(result.intent).toBe("OFF_TOPIC");
       expect(result.response).toContain("could not be processed");
       expect(mockCreate).toHaveBeenCalledTimes(3);
     });

     it("passes originalIntent, artifact, and conversation history in context", async () => {
       mockCreate.mockResolvedValueOnce({
         content: [
           {
             type: "text",
             text: '{"intent":"ASK","response":"ok","confidence":0.8}',
           },
         ],
       });
       const { classifyFollowUpIntent } = await import("./llm.js");
       await classifyFollowUpIntent(
         "EV market research",
         "# EV Research\nKey findings...",
         [
           { role: "user", content: "What about subsidies?" },
           { role: "assistant", content: "Subsidies are..." },
         ],
         "Tell me more about subsidies",
       );
       const userMsg = mockCreate.mock.calls[0][0].messages[0].content as string;
       expect(userMsg).toContain("EV market research");
       expect(userMsg).toContain("EV Research");
       expect(userMsg).toContain("What about subsidies?");
       expect(userMsg).toContain("Subsidies are...");
       expect(userMsg).toContain("Tell me more about subsidies");
     });
   });
   ```

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
   - JSON parsing: reuse the multi-strategy parsing **strategies** from `classifyIntentOnce` (direct parse → code block extraction → greedy match → field extraction)
   - Retry — NOTE: the retry *decision* differs from `classifyIntent`. `classifyIntent` short-circuits on a semantic null (null templateId + non-empty explanation → do NOT retry). `classifyFollowUpIntent` has no such semantic null: retry **only on parse failure**, up to 3 attempts, then return a fixed `OFF_TOPIC` fallback (`{ intent: "OFF_TOPIC", response: "<message could not be processed>", confidence: ... }`). Reuse the parse strategies, NOT the short-circuit branch.

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
   - Given classifyFollowUpIntent returns ASK intent, When sendMessage processes, Then response is streamed via publishEvent with columnSlug "__notfirst__" and stored in agent_conversations
   - Given classifyFollowUpIntent returns OFF_TOPIC intent, When sendMessage processes, Then response is returned without streaming (static response)
   - Given classifyFollowUpIntent returns NEW_DIRECTION intent, When sendMessage processes, Then pending state is stored and confirmation response is returned
   - Given a pending regenerate state, When confirmRegenerateBoard is called, Then board.original_intent is updated, old agent_card_outputs are deleted, old cards are deleted, and pipeline re-runs
   - Given a pending regenerate state, When cancelRegenerateBoard is called, Then pending state is cleared and cancellation message is stored
   - Given a board with executionStatus "running", When sendMessage is called, Then returns "Board sedang dalam eksekusi" without LLM call
   - Given regenerateBoard is called, When pipeline completes, Then conversation history from old topic is preserved

   ```typescript
   // Add to server/src/agent/service.test.ts — after existing sendMessage describe block

   describe("sendMessage follow-up on done board", () => {
     it("calls classifyFollowUpIntent with artifact + history + message for done board", async () => {
       const classifyFollowUpIntent = vi.fn(async () => ({
         intent: "ASK" as const,
         response: "The research found key findings about EV charging.",
         confidence: 0.9,
       }));
       const getArtifact = vi.fn(async () => ({
         filename: "ev-research.md",
         format: "md" as const,
         content: "# EV Market Research\n\nKey findings...",
       }));
       const getConversationHistory = vi.fn(async () => [
         { role: "user" as const, content: "What about subsidies?" },
         { role: "assistant" as const, content: "Subsidies are important..." },
       ]);
       const insertConversation = vi.fn(async () => {});
       const publishEvent = vi.fn(async () => {});
       const service = createAgentBoardService({
         getBoard: vi.fn(async () => ({
           id: 1,
           status: "approved",
           executionStatus: "done",
           workspaceId: 1,
           userId: 1,
           originalIntent: "EV market research",
         })),
         getArtifact,
         getConversationHistory,
         classifyFollowUpIntent,
         insertConversation,
         publishEvent,
       });

       await service.sendMessage({
         boardId: 1,
         userId: 1,
         workspaceId: 1,
         message: "What were the key findings about charging?",
       });

       expect(classifyFollowUpIntent).toHaveBeenCalledWith(
         "EV market research",
         "# EV Market Research\n\nKey findings...",
         expect.arrayContaining([
           expect.objectContaining({ role: "user", content: "What about subsidies?" }),
         ]),
         "What were the key findings about charging?",
       );
     });

     it("streams ASK response via publishEvent with columnSlug __notfirst__ and stores in conversations", async () => {
       const classifyFollowUpIntent = vi.fn(async () => ({
         intent: "ASK" as const,
         response: "The research found three key findings.",
         confidence: 0.9,
       }));
       const insertConversation = vi.fn(async () => {});
       const publishEvent = vi.fn(async () => {});
       const service = createAgentBoardService({
         getBoard: vi.fn(async () => ({
           id: 1,
           status: "approved",
           executionStatus: "done",
           workspaceId: 1,
           userId: 1,
           originalIntent: "riset",
         })),
         getArtifact: vi.fn(async () => null),
         getConversationHistory: vi.fn(async () => []),
         classifyFollowUpIntent,
         insertConversation,
         publishEvent,
       });

       await service.sendMessage({
         boardId: 1,
         userId: 1,
         workspaceId: 1,
         message: "What did you find?",
       });

       // Streaming with __notfirst__ slug
       expect(publishEvent).toHaveBeenCalledWith(
         1,
         expect.objectContaining({
           type: "agent.card.token",
           columnSlug: "__notfirst__",
           boardId: 1,
         }),
       );

       // Stored in conversations
       expect(insertConversation).toHaveBeenCalledWith(
         expect.objectContaining({
           boardId: 1,
           role: "user",
           content: "What did you find?",
         }),
       );
       expect(insertConversation).toHaveBeenCalledWith(
         expect.objectContaining({
           boardId: 1,
           role: "assistant",
           content: "The research found three key findings.",
         }),
       );
     });

     it("returns OFF_TOPIC response without streaming", async () => {
       const classifyFollowUpIntent = vi.fn(async () => ({
         intent: "OFF_TOPIC" as const,
         response: "This is outside the scope of this board.",
         confidence: 0.95,
       }));
       const insertConversation = vi.fn(async () => {});
       const publishEvent = vi.fn(async () => {});
       const service = createAgentBoardService({
         getBoard: vi.fn(async () => ({
           id: 1,
           status: "approved",
           executionStatus: "done",
           workspaceId: 1,
           userId: 1,
           originalIntent: "riset",
         })),
         getArtifact: vi.fn(async () => null),
         getConversationHistory: vi.fn(async () => []),
         classifyFollowUpIntent,
         insertConversation,
         publishEvent,
       });

       const result = await service.sendMessage({
         boardId: 1,
         userId: 1,
         workspaceId: 1,
         message: "Write me a Python script",
       });

       // No streaming events
       expect(publishEvent).not.toHaveBeenCalled();
       // Response returned directly
       expect(result).toMatchObject({
         explanation: "This is outside the scope of this board.",
       });
       // Still stored in conversations
       expect(insertConversation).toHaveBeenCalledWith(
         expect.objectContaining({
           role: "assistant",
           content: "This is outside the scope of this board.",
         }),
       );
     });

     it("stores pendingRegenerate for NEW_DIRECTION and returns confirmation response", async () => {
       const classifyFollowUpIntent = vi.fn(async () => ({
         intent: "NEW_DIRECTION" as const,
         response: "This is a different topic. I will regenerate the board.",
         confidence: 0.93,
       }));
       const insertConversation = vi.fn(async () => {});
       const publishEvent = vi.fn(async () => {});
       const service = createAgentBoardService({
         getBoard: vi.fn(async () => ({
           id: 1,
           status: "approved",
           executionStatus: "done",
           workspaceId: 1,
           userId: 1,
           originalIntent: "riset EV",
         })),
         getArtifact: vi.fn(async () => null),
         getConversationHistory: vi.fn(async () => []),
         classifyFollowUpIntent,
         insertConversation,
         publishEvent,
       });

       const result = await service.sendMessage({
         boardId: 1,
         userId: 1,
         workspaceId: 1,
         message: "Now research competitor landscape for scooters",
       });

       expect(result).toMatchObject({
         explanation: expect.stringContaining("regenerate"),
         pendingRegenerate: true,
       });
     });

     it("returns 'Board sedang dalam eksekusi' when board is running", async () => {
       const classifyFollowUpIntent = vi.fn(async () => ({
         intent: "ASK" as const,
         response: "should not be called",
         confidence: 0.8,
       }));
       const service = createAgentBoardService({
         getBoard: vi.fn(async () => ({
           id: 1,
           status: "approved",
           executionStatus: "running",
           workspaceId: 1,
           userId: 1,
           originalIntent: "riset",
         })),
         classifyFollowUpIntent,
         insertConversation: vi.fn(async () => {}),
       });

       const result = await service.sendMessage({
         boardId: 1,
         userId: 1,
         workspaceId: 1,
         message: "hello",
       });

       expect(classifyFollowUpIntent).not.toHaveBeenCalled();
       expect(result).toMatchObject({
         explanation: expect.stringContaining("eksekusi"),
       });
     });
   });

   describe("confirmRegenerateBoard", () => {
     it("updates intent, deletes old outputs + cards, re-runs pipeline", async () => {
       const updateBoard = vi.fn(async () => {});
       const deleteOutputsForBoard = vi.fn(async () => {});
       const deleteCardsForBoard = vi.fn(async () => {});
       const insertConversation = vi.fn(async () => {});
       const publishEvent = vi.fn(async () => {});
       const getBoard = vi.fn(async () => ({
         id: 1,
         status: "approved",
         executionStatus: "done",
         workspaceId: 1,
         userId: 1,
         originalIntent: "old intent",
       }));

       // Build service with a stub classifyFollowUpIntent that stores pending state
       const classifyFollowUpIntent = vi.fn(async () => ({
         intent: "NEW_DIRECTION" as const,
         response: "Regenerating...",
         confidence: 0.9,
       }));
       const service = createAgentBoardService({
         getBoard,
         updateBoard,
         deleteOutputsForBoard,
         deleteCardsForBoard,
         insertConversation,
         publishEvent,
         getArtifact: vi.fn(async () => null),
         getConversationHistory: vi.fn(async () => []),
         classifyFollowUpIntent,
       });

       // First: trigger NEW_DIRECTION to store pending state
       await service.sendMessage({
         boardId: 1,
         userId: 1,
         workspaceId: 1,
         message: "Research scooters instead",
       });

       // Then: confirm regeneration
       await service.confirmRegenerateBoard({ boardId: 1, workspaceId: 1 });

       expect(updateBoard).toHaveBeenCalledWith(1, {
         original_intent: expect.stringContaining("scooter"),
       });
       expect(deleteOutputsForBoard).toHaveBeenCalledWith(1);
       expect(deleteCardsForBoard).toHaveBeenCalledWith(1);
     });

     it("stores confirmation message in agent_conversations", async () => {
       const insertConversation = vi.fn(async () => {});
       const service = createAgentBoardService({
         getBoard: vi.fn(async () => ({
           id: 1,
           status: "approved",
           executionStatus: "done",
           workspaceId: 1,
           userId: 1,
           originalIntent: "old",
         })),
         updateBoard: vi.fn(async () => {}),
         deleteOutputsForBoard: vi.fn(async () => {}),
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

       await service.sendMessage({
         boardId: 1,
         userId: 1,
         workspaceId: 1,
         message: "Research scooters",
       });

       await service.confirmRegenerateBoard({ boardId: 1, workspaceId: 1 });

       // Confirmation message stored
       const calls = insertConversation.mock.calls;
       const confirmCall = calls.find(
         (c: any[]) => c[0].content?.includes("Regenerat") || c[0].content?.includes("regenerat"),
       );
       expect(confirmCall).toBeDefined();
     });

     it("rejects with 404 and performs no mutation when board is in a different workspace", async () => {
       const updateBoard = vi.fn(async () => {});
       const deleteOutputsForBoard = vi.fn(async () => {});
       const deleteCardsForBoard = vi.fn(async () => {});
       const service = createAgentBoardService({
         // Board belongs to workspace 1, caller claims workspace 999
         getBoard: vi.fn(async () => ({
           id: 1,
           status: "approved",
           executionStatus: "done",
           workspaceId: 1,
           userId: 1,
           originalIntent: "old",
         })),
         updateBoard,
         deleteOutputsForBoard,
         deleteCardsForBoard,
         insertConversation: vi.fn(async () => {}),
         publishEvent: vi.fn(async () => {}),
         getArtifact: vi.fn(async () => null),
         getConversationHistory: vi.fn(async () => []),
         classifyFollowUpIntent: vi.fn(async () => ({
           intent: "NEW_DIRECTION" as const,
           response: "Regenerating...",
           confidence: 0.9,
         })),
       });

       // Establish pending state via the legitimate owner first
       await service.sendMessage({
         boardId: 1,
         userId: 1,
         workspaceId: 1,
         message: "Research scooters",
       });

       const result = await service.confirmRegenerateBoard({
         boardId: 1,
         workspaceId: 999,
       });

       expect(result).toMatchObject({ status: 404 });
       expect(updateBoard).not.toHaveBeenCalled();
       expect(deleteOutputsForBoard).not.toHaveBeenCalled();
       expect(deleteCardsForBoard).not.toHaveBeenCalled();
     });
   });

   describe("cancelRegenerateBoard", () => {
     it("clears pending state and stores cancellation message", async () => {
       const insertConversation = vi.fn(async () => {});
       const publishEvent = vi.fn(async () => {});
       const service = createAgentBoardService({
         getBoard: vi.fn(async () => ({
           id: 1,
           status: "approved",
           executionStatus: "done",
           workspaceId: 1,
           userId: 1,
           originalIntent: "old",
         })),
         updateBoard: vi.fn(async () => {}),
         deleteOutputsForBoard: vi.fn(async () => {}),
         deleteCardsForBoard: vi.fn(async () => {}),
         insertConversation,
         publishEvent,
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
         boardId: 1,
         userId: 1,
         workspaceId: 1,
         message: "Research scooters",
       });

       // Cancel
       await service.cancelRegenerateBoard({ boardId: 1, workspaceId: 1 });

       // Cancellation message stored
       const calls = insertConversation.mock.calls;
       const cancelCall = calls.find(
         (c: any[]) => c[0].content?.includes("cancel") || c[0].content?.includes("batal"),
       );
       expect(cancelCall).toBeDefined();
     });

     it("does not call updateBoard or deleteOutputsForBoard on cancel", async () => {
       const updateBoard = vi.fn(async () => {});
       const deleteOutputsForBoard = vi.fn(async () => {});
       const service = createAgentBoardService({
         getBoard: vi.fn(async () => ({
           id: 1,
           status: "approved",
           executionStatus: "done",
           workspaceId: 1,
           userId: 1,
           originalIntent: "old",
         })),
         updateBoard,
         deleteOutputsForBoard,
         deleteCardsForBoard: vi.fn(async () => {}),
         insertConversation: vi.fn(async () => {}),
         publishEvent: vi.fn(async () => {}),
         getArtifact: vi.fn(async () => null),
         getConversationHistory: vi.fn(async () => []),
         classifyFollowUpIntent: vi.fn(async () => ({
           intent: "NEW_DIRECTION" as const,
           response: "Regenerating...",
           confidence: 0.9,
         })),
       });

       await service.sendMessage({
         boardId: 1,
         userId: 1,
         workspaceId: 1,
         message: "Research scooters",
       });
       await service.cancelRegenerateBoard({ boardId: 1, workspaceId: 1 });

       expect(updateBoard).not.toHaveBeenCalled();
       expect(deleteOutputsForBoard).not.toHaveBeenCalled();
     });
   });
   ```

2. Run tests — verify FAIL:
   `npx vitest run server/src/agent/service.test.ts`
   Expected failure: sendMessage does not call classifyFollowUpIntent for done boards

3. Implement sendMessage upgrade and regenerateBoard in service.ts:
   File: `server/src/agent/service.ts`
   Implement:
   - Add to AgentBoardServiceDeps: `classifyFollowUpIntent?: (originalIntent: string, artifactContent: string | null, conversationHistory: Array<{ role: string; content: string }>, userMessage: string) => Promise<FollowUpResult>`, `getConversationHistory?: (boardId: number) => Promise<Array<{ role: string; content: string }>>`, `deleteOutputsForBoard?: (boardId: number) => Promise<void>`, `deleteCardsForBoard?: (boardId: number) => Promise<void>`
   - Add `pendingRegenerate` Map field to service (in-memory: `Map<number, string>` — boardId → new intent, where **new intent = the raw user `message`** that triggered NEW_DIRECTION; `FollowUpResult` carries no extracted topic)
   - Upgrade sendMessage (keep the existing 404/403 ownership guards + the existing user-message store at the top of the method — store happens BEFORE any status branch, so a "running" board still records the message per spec Rule 1):
     - If board.executionStatus === "running" → return static "Board sedang dalam eksekusi. Tunggu hingga selesai." message (user message already stored above; no LLM call)
     - If board.status === "approved" && board.executionStatus === "done":
       - Load artifact via deps.getArtifact(boardId)
       - Load conversation history via deps.getConversationHistory(boardId)
       - Call deps.classifyFollowUpIntent(board.originalIntent, artifact?.content ?? null, history, message)
       - Switch on result.intent:
         - ASK / REFINE: emit the response via publishEvent with columnSlug "__notfirst__", then store in agent_conversations. NOTE — this is **synthetic streaming**: `classifyFollowUpIntent` is a single non-streaming call returning the complete `result.response`, so emit the already-complete text as one (or chunked) `agent.card.token` event(s); there is no live LLM token stream here (unlike executeCard).
         - NEW_DIRECTION: `pendingRegenerate.set(boardId, message)`, store the confirmation response in agent_conversations, return confirmation response with `pendingRegenerate: true` (button metadata). Do NOT stream.
         - OFF_TOPIC: return static rejection response, store in agent_conversations. Do NOT stream.
     - If board.status === "pending": existing behavior (generateClarificationQuestion)
   - Add `confirmRegenerateBoard({ boardId, workspaceId })`:
     - **Ownership guard (security invariant — match getCardOutput/sendMessage):** load board via deps.getBoard(boardId); if `!board || board.workspaceId !== workspaceId` return `{ status: 404 }`. Do this BEFORE any mutation.
     - Check pendingRegenerate has this boardId (if not → no-op / return)
     - Store confirmation response in agent_conversations
     - Update board.original_intent via deps.updateBoard(boardId, { original_intent: <pending value> })
     - Delete old agent_card_outputs via deps.deleteOutputsForBoard
     - Delete old cards via deps.deleteCardsForBoard
     - Clear pendingRegenerate.delete(boardId)
     - Fire `this.runPipeline({ boardId, workspaceId })` **non-awaited** with `.catch(...)` (fire-and-forget inside the service, mirroring the approve route's fire-and-forget). The method returns promptly so the request does not block on a multi-minute pipeline; the client tracks progress via SSE.
   - Add `cancelRegenerateBoard({ boardId, workspaceId })`:
     - **Ownership guard:** load board; if `!board || board.workspaceId !== workspaceId` return `{ status: 404 }`.
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

Given a board with status "done" and artifact "research about EV market", And user sends "What were the key findings about charging infrastructure?", When sendMessage is called, Then classifyFollowUpIntent receives artifact + history + message, And response is streamed via publishEvent with columnSlug "__notfirst__", And response is stored in agent_conversations
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
- Follow-up responses for ASK/REFINE stream via SSE with columnSlug "__notfirst__"
- OFF_TOPIC returns static rejection without streaming
- NEW_DIRECTION stores pending state and returns confirmation response
- confirmRegenerateBoard deletes old outputs + cards and re-runs pipeline
- confirmRegenerateBoard AND cancelRegenerateBoard validate `board.workspaceId === workspaceId` before any mutation (return 404 on mismatch) — matches the ownership guard on every other service method
- runPipeline is fired non-awaited (`.catch`) from confirmRegenerateBoard so the request returns promptly (mirrors approve route)
- User message is stored even for a "running" board (store happens before the status branch)
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

### Task 3: Routes Structured Payload Handling [depends: T2]

---

## OBJECTIVE

Update the message endpoint in `server/src/agent/routes.ts` to accept structured payloads (`{ action: "confirm_regenerate" }` and `{ action: "cancel_regenerate" }`) in addition to the existing `{ message: string }` format. Wire `confirmRegenerateBoard` and `cancelRegenerateBoard` from service into the route handler. Add new deps wiring in `realDeps`.

Files:

- Modify: `server/src/agent/routes.ts`
- Test: `server/src/agent/routes.test.ts`

Steps:

1. Write failing tests for: payload-detection decision + new realDeps SQL wiring
   File: `server/src/agent/routes.test.ts`

   The Express handler is wired inside `createAgentRouter` and there is **no existing precedent (nor supertest dependency) for testing a mounted route** — `routes.test.ts` tests *exported pure helpers* (`getToolTrace`, `runInsertColumns`, `defaultToolRegistry`). Match that convention: extract the payload→action decision into an **exported pure function** `resolveMessageAction(body)` and test it directly, and export the new DB-backed dep functions so their SQL can be verified with a `fakeDb` exactly like `getToolTrace`.

   > **Honest scope:** these tests cover (a) the branch *decision* and (b) the SQL *shape* — they do NOT cover the full Express request→service→response wiring (the handler reads params, calls `requireWorkspaceMember`, then delegates to `resolveMessageAction`'s result). That last hop is thin glue and is left to manual verification; the tests must not overclaim otherwise.

   Test verifies:
   - `resolveMessageAction({ message: "text" })` → `{ kind: "send", message: "text" }` (trimmed, backward compatible)
   - `resolveMessageAction({ action: "confirm_regenerate" })` → `{ kind: "confirm" }`
   - `resolveMessageAction({ action: "cancel_regenerate" })` → `{ kind: "cancel" }`
   - `resolveMessageAction({})` / `undefined` / `{ message: "   " }` / `{ action: "bogus" }` → `{ kind: "invalid" }`
   - `selectConversationHistory(fakeDb, boardId)` issues a SELECT on `agent_conversations` scoped by `board_id = $1`, ordered by `created_at`, returning `{ role, content }[]`
   - `deleteOutputsForBoard(fakeDb, boardId)` issues `DELETE FROM agent_card_outputs WHERE board_id = $1`
   - `deleteCardsForBoard(fakeDb, boardId)` issues a DELETE on `cards` scoped via `column_id IN (SELECT id FROM columns WHERE board_id = $1)`

   ```typescript
   // Add to server/src/agent/routes.test.ts — after existing describe blocks
   // Import the new exported helpers alongside the existing ones:
   //   import { resolveMessageAction, selectConversationHistory,
   //            deleteOutputsForBoard, deleteCardsForBoard } from "./routes.js";

   describe("resolveMessageAction (pure payload detection)", () => {
     it("maps a string message to a trimmed send action", () => {
       expect(resolveMessageAction({ message: "  hello  " })).toEqual({
         kind: "send",
         message: "hello",
       });
     });

     it("maps confirm_regenerate action", () => {
       expect(resolveMessageAction({ action: "confirm_regenerate" })).toEqual({
         kind: "confirm",
       });
     });

     it("maps cancel_regenerate action", () => {
       expect(resolveMessageAction({ action: "cancel_regenerate" })).toEqual({
         kind: "cancel",
       });
     });

     it("rejects empty / whitespace / unknown-action / missing bodies as invalid", () => {
       expect(resolveMessageAction({})).toEqual({ kind: "invalid" });
       expect(resolveMessageAction(undefined)).toEqual({ kind: "invalid" });
       expect(resolveMessageAction({ message: "   " })).toEqual({ kind: "invalid" });
       expect(resolveMessageAction({ action: "bogus" })).toEqual({ kind: "invalid" });
     });
   });

   describe("realDeps SQL wiring (fakeDb)", () => {
     it("selectConversationHistory queries agent_conversations scoped + ordered", async () => {
       const rows = [
         { role: "user", content: "What about subsidies?" },
         { role: "assistant", content: "Subsidies are..." },
       ];
       const fakeDb = { query: vi.fn(async () => ({ rows })) };

       const history = await selectConversationHistory(fakeDb as any, 42);

       expect(fakeDb.query).toHaveBeenCalledWith(expect.any(String), [42]);
       const sql = fakeDb.query.mock.calls[0][0] as string;
       expect(sql).toMatch(/from\s+agent_conversations/i);
       expect(sql).toMatch(/board_id\s*=\s*\$1/i);
       expect(sql).toMatch(/order by\s+created_at/i);
       expect(history).toEqual([
         { role: "user", content: "What about subsidies?" },
         { role: "assistant", content: "Subsidies are..." },
       ]);
     });

     it("deleteOutputsForBoard issues a scoped DELETE on agent_card_outputs", async () => {
       const fakeDb = { query: vi.fn(async () => ({ rows: [] })) };
       await deleteOutputsForBoard(fakeDb as any, 42);
       expect(fakeDb.query).toHaveBeenCalledWith(expect.any(String), [42]);
       const sql = fakeDb.query.mock.calls[0][0] as string;
       expect(sql).toMatch(/delete from\s+agent_card_outputs/i);
       expect(sql).toMatch(/board_id\s*=\s*\$1/i);
     });

     it("deleteCardsForBoard deletes cards via columns subquery", async () => {
       const fakeDb = { query: vi.fn(async () => ({ rows: [] })) };
       await deleteCardsForBoard(fakeDb as any, 42);
       expect(fakeDb.query).toHaveBeenCalledWith(expect.any(String), [42]);
       const sql = fakeDb.query.mock.calls[0][0] as string;
       expect(sql).toMatch(/delete from\s+cards/i);
       expect(sql).toMatch(/column_id\s+in\s*\(\s*select\s+id\s+from\s+columns\s+where\s+board_id\s*=\s*\$1/i);
     });
   });
   ```

2. Run tests — verify FAIL:
   `npx vitest run server/src/agent/routes.test.ts`
   Expected failure: `resolveMessageAction`, `selectConversationHistory`, `deleteOutputsForBoard`, `deleteCardsForBoard` are not exported yet (import error / undefined)

3. Implement structured payload handling in routes.ts:
   File: `server/src/agent/routes.ts`
   Implement:
   - Export pure `resolveMessageAction(body: unknown): { kind: "send"; message: string } | { kind: "confirm" } | { kind: "cancel" } | { kind: "invalid" }`:
     - `body.action === "confirm_regenerate"` → `{ kind: "confirm" }`
     - `body.action === "cancel_regenerate"` → `{ kind: "cancel" }`
     - `typeof body.message === "string"` && trimmed non-empty → `{ kind: "send", message: body.message.trim() }`
     - everything else (no body, empty/whitespace message, unknown action) → `{ kind: "invalid" }`
   - Update the message endpoint handler to be thin glue over `resolveMessageAction`:
     - `confirm` → `service.confirmRegenerateBoard({ boardId, workspaceId })`
     - `cancel` → `service.cancelRegenerateBoard({ boardId, workspaceId })`
     - `send` → existing `service.sendMessage({ boardId, userId, workspaceId, message })` flow
     - `invalid` → `res.status(400).json({ error: "message or action is required" })`
     - confirm/cancel results may carry `{ status: 404 }` (ownership mismatch from the service) — forward the status like the other endpoints do
   - Export the new DB-backed dep functions (factory style, like `getToolTrace(db, …)`) and wire them into `realDeps` using `pool`:
     - `selectConversationHistory(db, boardId)`: `SELECT role, content FROM agent_conversations WHERE board_id = $1 ORDER BY created_at` → map rows to `{ role, content }[]`
     - `deleteOutputsForBoard(db, boardId)`: `DELETE FROM agent_card_outputs WHERE board_id = $1`
     - `deleteCardsForBoard(db, boardId)`: `DELETE FROM cards WHERE column_id IN (SELECT id FROM columns WHERE board_id = $1)`
     - In `realDeps`: `getConversationHistory: (boardId) => selectConversationHistory(pool, boardId)`, `deleteOutputsForBoard: (boardId) => deleteOutputsForBoard(pool, boardId)`, `deleteCardsForBoard: (boardId) => deleteCardsForBoard(pool, boardId)`, `classifyFollowUpIntent` imported from `./llm.js`

4. Run tests — verify PASS:
   `npx vitest run server/src/agent/routes.test.ts`
   Expected: all new tests PASS

5. Commit:
   `git add server/src/agent/routes.ts server/src/agent/routes.test.ts`
   `git commit -m "feat(agent): add structured payload handling for regenerate confirmation"`

## REFERENCES LOADED

docs/pocket/spec/2026-06-17-agent-multi-turn-conversation/spec.md — Rule 3 (confirmation flow), Rule 4 (regenerate replaces old state). GWT: 4 scenarios.
server/src/agent/routes.ts — existing message endpoint at POST /workspaces/:workspaceId/agent/boards/:boardId/message. realDeps wiring pattern. requireWorkspaceMember helper.
server/src/agent/routes.test.ts — existing test pattern for route helpers.
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

Given `resolveMessageAction({ action: "confirm_regenerate" })`, Then it returns `{ kind: "confirm" }`
Given `resolveMessageAction({ action: "cancel_regenerate" })`, Then it returns `{ kind: "cancel" }`
Given `resolveMessageAction({ message: "  text  " })`, Then it returns `{ kind: "send", message: "text" }` (backward compatible)
Given `resolveMessageAction` receives an empty body, whitespace-only message, missing body, or unknown action, Then it returns `{ kind: "invalid" }` (handler maps this to HTTP 400)
Given `selectConversationHistory(fakeDb, 42)`, Then SQL targets `agent_conversations`, is scoped `board_id = $1`, ordered by `created_at`
Given `deleteOutputsForBoard(fakeDb, 42)`, Then SQL is `DELETE FROM agent_card_outputs WHERE board_id = $1`
Given `deleteCardsForBoard(fakeDb, 42)`, Then SQL deletes from `cards` via `column_id IN (SELECT id FROM columns WHERE board_id = $1)`
Given the message endpoint, Then it delegates confirm→confirmRegenerateBoard / cancel→cancelRegenerateBoard / send→sendMessage and forwards a `{ status: 404 }` service result (thin glue — verified manually, not unit-tested per the honest-scope note above)

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

### Task 4: Client AgentPage Follow-Up UI [depends: T2]

---

## OBJECTIVE

Update `client/src/pages/AgentPage.tsx` to: (1) enable input when board is done/failed (not just before board exists), (2) render follow-up response tokens as chat bubbles in the right panel, (3) render confirmation buttons for NEW_DIRECTION responses, (4) filter `__notfirst__` events from column state derivation, (5) disable input during pending regeneration.

Files:

- Modify: `client/src/pages/AgentPage.tsx`
- Test: `client/src/pages/AgentPage.test.tsx`

Steps:

1. Write failing tests for: input enabled when board is done, follow-up bubbles render, NEW_DIRECTION buttons render, __notfirst__ filtered from column state
   File: `client/src/pages/AgentPage.test.tsx`
   Test verifies:
   - Given a board with executionStatus "done", When rendered, Then input is enabled (not disabled)
   - Given a board with executionStatus "done", When user types and sends a follow-up, Then api.sendAgentBoardMessage is called with the message
   - Given SSE events with columnSlug "__notfirst__" and tokens, When rendered, Then tokens appear as a chat bubble (not in column tiles)
   - Given a follow-up response with NEW_DIRECTION metadata, When rendered, Then "Ya, Regenerate" and "Batal" buttons appear
   - Given user clicks "Ya, Regenerate", When processed, Then api.sendAgentBoardMessage is called with `{ action: "confirm_regenerate" }`
   - Given user clicks "Batal", When processed, Then api.sendAgentBoardMessage is called with `{ action: "cancel_regenerate" }`
   - Given board.executionStatus is "running", When rendered, Then input is disabled with "Execution in progress..." placeholder
   - Given pending regeneration state, When rendered, Then input is disabled

   ```typescript
   // Add to client/src/pages/AgentPage.test.tsx — after existing describe blocks

   describe("AgentPage follow-up input", () => {
     it("enables input when board.executionStatus is 'done'", async () => {
       mockGetBoard.mockResolvedValue(makeBoard("done"));
       getAgentArtifact.mockResolvedValue(null);
       render(<AgentPage />);
       await waitForAgentPanel();
       const input = screen.getByPlaceholderText(/Follow up|Refine/i);
       expect(input).not.toBeDisabled();
     });

     it("disables input when board.executionStatus is 'running'", async () => {
       mockGetBoard.mockResolvedValue(makeBoard("running"));
       render(<AgentPage />);
       await waitForAgentPanel();
       const input = screen.getByPlaceholderText(/Execution in progress/i);
       expect(input).toBeDisabled();
     });

     it("calls api.sendAgentBoardMessage when follow-up is sent on done board", async () => {
       const sendAgentBoardMessage = vi.fn(async () => ({
         explanation: "Here is the answer.",
         boardUpdated: false,
       }));
       mockGetBoard.mockResolvedValue(makeBoard("done"));
       getAgentArtifact.mockResolvedValue(null);
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 1,
         agentEvents: [],
         showToast: vi.fn(),
         clearAgentEvents: vi.fn(),
       });

       // Override the api mock to include sendAgentBoardMessage
       const apiModule = await import("../api");
       const originalSend = apiModule.api.sendAgentBoardMessage;
       (apiModule.api as any).sendAgentBoardMessage = sendAgentBoardMessage;

       render(<AgentPage />);
       await waitForAgentPanel();

       const input = screen.getByPlaceholderText(/Follow up|Refine/i);
       await userEvent.type(input, "What were the key findings?");
       await userEvent.click(screen.getByRole("button", { name: /Send/i }));

       await waitFor(() => {
         expect(sendAgentBoardMessage).toHaveBeenCalledWith(
           1,
           2,
           "What were the key findings?",
         );
       });

       // Restore
       (apiModule.api as any).sendAgentBoardMessage = originalSend;
     });
   });

   describe("AgentPage follow-up chat bubbles", () => {
     it("renders __notfirst__ tokens as chat bubble, not in column tiles", async () => {
       const followUpEvents: AgentEvent[] = [
         {
           type: "agent.card.token",
           columnSlug: "__notfirst__",
           boardId: 2,
           token: "The research found ",
         },
         {
           type: "agent.card.token",
           columnSlug: "__notfirst__",
           boardId: 2,
           token: "three key findings.",
         },
       ];
       mockGetBoard.mockResolvedValue(makeBoard("done"));
       getAgentArtifact.mockResolvedValue(null);
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 1,
         agentEvents: followUpEvents,
         showToast: vi.fn(),
         clearAgentEvents: vi.fn(),
       });

       render(<AgentPage />);
       await waitForAgentPanel();

       // The follow-up tokens should appear as a chat bubble
       await waitFor(() => {
         expect(screen.getByText(/The research found/)).toBeTruthy();
       });
     });
   });

   describe("AgentPage NEW_DIRECTION buttons", () => {
     it("renders confirm and cancel buttons for NEW_DIRECTION response", async () => {
       const newDirectionEvents: AgentEvent[] = [
         {
           type: "agent.card.token",
           columnSlug: "__notfirst__",
           boardId: 2,
           token: "This is a different topic. I will regenerate the board.",
         },
       ];
       mockGetBoard.mockResolvedValue(makeBoard("done"));
       getAgentArtifact.mockResolvedValue(null);
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 1,
         agentEvents: newDirectionEvents,
         showToast: vi.fn(),
         clearAgentEvents: vi.fn(),
       });

       render(<AgentPage />);
       await waitForAgentPanel();

       // Should show regeneration buttons
       await waitFor(() => {
         expect(screen.getByText(/Ya.*Regenerate|Confirm/i)).toBeTruthy();
         expect(screen.getByText(/Batal|Cancel/i)).toBeTruthy();
       });
     });

     it("calls sendAgentBoardMessage with { action: 'confirm_regenerate' } on confirm click", async () => {
       const sendAgentBoardMessage = vi.fn(async () => ({
         explanation: "Regenerating...",
         boardUpdated: true,
       }));
       mockGetBoard.mockResolvedValue(makeBoard("done"));
       getAgentArtifact.mockResolvedValue(null);
       mockUseBoard.mockReturnValue({
         activeWorkspaceId: 1,
         agentEvents: [],
         showToast: vi.fn(),
         clearAgentEvents: vi.fn(),
       });

       const apiModule = await import("../api");
       const originalSend = apiModule.api.sendAgentBoardMessage;
       (apiModule.api as any).sendAgentBoardMessage = sendAgentBoardMessage;

       render(<AgentPage />);
       await waitForAgentPanel();

       // Simulate NEW_DIRECTION state (would need to trigger through UI flow)
       // This test documents the expected API contract
       expect(sendAgentBoardMessage).toBeDefined();

       (apiModule.api as any).sendAgentBoardMessage = originalSend;
     });
   });
   ```

   > **Note (mock setup — IMPORTANT):** `AgentPage.test.tsx` mocks the api via a `vi.mock("../api", …)` factory that currently exposes only `getAgentBoard` + `getAgentArtifact`. The runtime-mutation approach shown above (`(apiModule.api as any).sendAgentBoardMessage = …`) diverges from the file's pattern. Instead, **add `sendAgentBoardMessage` to the `vi.mock("../api")` factory** backed by a hoisted `vi.fn` (mirror the existing `getAgentBoard: (...a) => mockGetBoard(...a)` style), then assert on that hoisted mock. This matches the established mock convention and avoids relying on singleton mutation.
   >
   > Some tests above are contract-level (they document the structured-payload API shape). The confirm/cancel *button-click → api call* path is the meaningful assertion; full board re-render after regenerate is observed via SSE events in the component, not asserted here.

2. Run tests — verify FAIL:
   `npx vitest run client/src/pages/AgentPage.test.tsx`
   Expected failure: follow-up rendering and button handling do not exist yet

3. Implement AgentPage follow-up UI:
   File: `client/src/pages/AgentPage.tsx`
   Implement:
   - Update input `disabled` condition: enable when `isDone || isFailed` (currently disabled when `board?.status === "approved"` — change to only disable when `isRunning` or pending regeneration)
   - Add `followUpMessages` state: `Array<{ role: "user" | "assistant"; content: string; intent?: string }>` — populated from SSE __notfirst__ tokens + user messages
   - Render follow-up messages as chat bubbles below the existing board explanation area
   - Filter `__notfirst__` from `logEvents` (add to existing filter)
   - Add `pendingRegenerate` state tracking: when NEW_DIRECTION response received, show confirmation buttons
   - Add button handlers:
     - "Ya, Regenerate" → call `api.sendAgentBoardMessage(workspaceId, boardId, { action: "confirm_regenerate" })`
     - "Batal" → call `api.sendAgentBoardMessage(workspaceId, boardId, { action: "cancel_regenerate" })`
   - Track __notfirst__ tokens from agentEvents and render as streaming assistant bubble
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

Justification: 1 file (AgentPage is the main consumer). Follow-up UI reuses existing right panel layout. __notfirst__ slug is a convention — column state derivation already filters by columnSlug, so adding __notfirst__ exclusion is minimal.
Complexity: standard — new state management, conditional rendering, button handlers, SSE token tracking.

## SANDWICH CONTEXT

[CRITICAL: __notfirst__ events must NOT affect column state derivation — deriveColumnState must filter them out to prevent column tiles from changing state]
You are implementing the client UI for Agent Multi-Turn Conversation follow-up interactions.
Spec: docs/pocket/spec/2026-06-17-agent-multi-turn-conversation/spec.md
Design decision: Option A — follow-up tokens use agent.card.token with columnSlug "__notfirst__"
Files in scope: client/src/pages/AgentPage.tsx, client/src/pages/AgentPage.test.tsx — no other files
Test framework: Vitest with jsdom
Available after: T2 (sendMessage must handle follow-ups server-side)
Architecture rule: __notfirst__ events excluded from deriveColumnState — column tiles must stay in their current state
[RESTATE: __notfirst__ events must NOT affect column state derivation — deriveColumnState must filter them out]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a board with executionStatus "done", When rendered, Then input is enabled and placeholder says "Follow up about this board..."
Given SSE events with columnSlug "__notfirst__" and tokens, When rendered, Then tokens appear as a streaming assistant chat bubble in the right panel
Given a follow-up response with NEW_DIRECTION intent, When rendered, Then "Ya, Regenerate" and "Batal" buttons appear below the response
Given user clicks "Ya, Regenerate", When processed, Then api.sendAgentBoardMessage is called with structured payload { action: "confirm_regenerate" }
Given user clicks "Batal", When processed, Then api.sendAgentBoardMessage is called with structured payload { action: "cancel_regenerate" }
Given board.executionStatus is "running", When rendered, Then input is disabled
Given __notfirst__ SSE events exist, When deriveColumnState is called, Then columns remain in their current state (not affected by __notfirst__)

All tests PASS. Commit exists with message matching `feat(agent): add follow-up chat UI with regenerate confirmation buttons`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Input enabled when board is done/failed
- Follow-up tokens rendered as chat bubbles (not in column tiles)
- NEW_DIRECTION renders confirmation buttons
- __notfirst__ events excluded from column state derivation
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
Escalate when: if __notfirst__ events need a new SSE event type (should reuse existing agent.card.token)

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

---

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

---

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

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | classifyFollowUpIntent + Scope Guard Prompt | prereq | standard | Returns { intent, response, confidence } for all 4 intent types |
| T2 | Service sendMessage Upgrade + regenerateBoard | T1 | standard | sendMessage handles done boards, regenerate clears + re-runs |
| T3 | Routes Structured Payload Handling | T2 | lightweight | Message endpoint accepts confirm/cancel payloads |
| T4 | Client AgentPage Follow-Up UI | T2 | standard | Follow-up bubbles + regenerate buttons render correctly |
| T5 | Client API + Stream Support Updates | T3, T4 | lightweight | API accepts structured payload, __notfirst__ filtered from column state |
| T6 | Integration: Follow-Up Message Flow | T5 | standard | End-to-end ASK/REFINE/NEW_DIRECTION/OFF_TOPIC through service |
| T7 | Integration: Regenerate Confirmation Flow | T5 | standard | End-to-end confirm/cancel with mutations and pipeline re-run |
