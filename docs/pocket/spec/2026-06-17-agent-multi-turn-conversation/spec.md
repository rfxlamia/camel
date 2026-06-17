# Agent Multi-Turn Conversation

Date: 2026-06-17 | Status: Phase 6 (Architecture Validation — PASS)

---

## Problem Statement

After the agent board completes its 5-column pipeline (Research → Analysis → Writer → Editor → QA), users can type follow-up messages but get no meaningful response. The `sendMessage` method returns a static acknowledgment for approved boards — there is no LLM call, no context injection, no actionable output. Users are stuck with a one-shot interaction.

---

## Scope

### IN-SCOPE

- Upgrade `sendMessage` for done/approved boards to call LLM
- Context injection: original intent + artifact + full conversation history
- LLM auto-detects intent type (ASK, REFINE, NEW_DIRECTION, OFF_TOPIC) via natural language
- Scope guard: reject off-topic requests gracefully
- Store assistant response in `agent_conversations`
- Client: re-enable input after execution done, render LLM response
- **[NEW] New Direction detection → full regenerate (Option A):**
  - LLM asks for confirmation via buttons
  - User clicks "Ya, Regenerate" or "Batal" (structured payload, not text)
  - On confirm: update intent, clear old outputs, re-run pipeline
  - On cancel: clear pending state, board remains unchanged

### OUT-OF-SCOPE (intentionally excluded)

- Artifact versioning / diff view (V2)
- Partial pipeline re-run for Extend (V2)
- Explicit command syntax (`/ask`, `/refine`) — Direction C
- Per-type cost optimization (cheaper model for ASK)
- Branching / compare outputs
- Auto-compact for conversation history (future)

### ARCHITECTURE CONSTRAINTS

- Layers that may be touched: `agent/service.ts`, `agent/llm.ts`, `client/AgentPage.tsx`, `client/api.ts`
- Layers that must NOT be touched: DB schema (no new tables), `agent/templates.ts`
- Patterns: dependency injection (service deps), streaming via SSE
- `sendMessage` must remain a single entry point (Direction A)
- Regenerate: Option A (replace old outputs, no generation tracking)

---

## Design Decisions

### 1. Intent Classification System

**Approach:** Few-Shot + Chain of Thought prompt engineering

**Four intent types:**

| Intent | Behavior | Example |
|--------|----------|---------|
| `ASK` | Answer using artifact context | "What did the analysis find about subsidies?" |
| `REFINE` | Acknowledge and explain improvement | "Add a section about 2025 trends" |
| `NEW_DIRECTION` | Ask for regeneration confirmation via buttons | "Now research competitor landscape for scooters" |
| `OFF_TOPIC` | Politely reject, suggest new board | "Write me a Python script" |

**Scope guard rules:**

- When in doubt between ASK and REFINE → classify as ASK (safer, cheaper)
- When in doubt between REFINE and NEW_DIRECTION → classify as REFINE (keep scope narrow)
- OFF_TOPIC only for clearly unrelated requests

**Output format (JSON):**

```json
{
  "intent": "ASK" | "REFINE" | "NEW_DIRECTION" | "OFF_TOPIC",
  "response": "natural language response",
  "confidence": 0.0-1.0
}
```

### 2. Context Injection

**What to inject:**

```
├── board.originalIntent        ← ~100 chars
├── agent_artifacts.content     ← ~5KB (final document)
└── agent_conversations         ← full history (with prompt caching)
```

**NOT injected:** All column outputs (18-37KB). Reasons:

- `editor` output = editorial notes, not the document
- `qa-guardian` output = ~1KB verdict, not useful
- `writer` output = already captured in artifact
- Artifact is the polished final, sufficient for follow-up context

### 3. Streaming via SSE

**Reuse existing event structure:**

```typescript
// Follow-up tokens use same event type with special slug
{
  type: "agent.card.token",
  columnSlug: "__notfirst__",  // special slug for follow-up
  boardId,
  token: tokenBuffer
}
```

**Client guard:**

- `deriveColumnState` must filter out `__notfirst__` events
- Client renders `__notfirst__` tokens as chat bubble in right panel
- Column state derivation unaffected

### 4. New Direction → Regenerate Flow

```
User: "Sekarang riset kompetitor untuk produk Y"
  ↓
LLM (NEW_DIRECTION): "Ini topik baru. Saya akan regenerate board 
  dengan fokus riset kompetitor untuk produk Y. Lanjutkan?"
  ↓
Client render bubble + 2 buttons:
  [Ya, Regenerate]  [Batal]
  ↓
User klik button → client kirim structured payload:
  { action: "confirm_regenerate" } atau { action: "cancel_regenerate" }
  ↓
Server process action langsung (tanpa LLM call)
```

**Pending state:** In-memory `Map<boardId, newIntent>`. Trade-off: hilang pada restart server, tapi user tinggal ketik ulang (edge case jarang).

**Regenerate steps:**

1. Store confirmation response in `agent_conversations`
2. Update `board.original_intent` to new topic
3. DELETE old `agent_card_outputs` WHERE `board_id = X`
4. DELETE old cards WHERE `column_id IN (columns of board)`
5. Re-run pipeline

**Conversation history:** Preserved across regenerations.

### 5. Edge Cases (Resolved)

| Edge Case | Resolution |
|-----------|------------|
| Follow-up before pipeline done | Return "Board sedang dalam eksekusi. Tunggu hingga selesai." |
| New message during pending confirmation | **Disable input** (same pattern as `isRunning`) |
| Double-click regenerate button | Client disables button after first click |
| Regenerate fails mid-pipeline | Board in "failed" state, user can retry (consistent with existing behavior) |
| Follow-up during regenerate | Same rejection as pipeline running |
| Conversation history too long | **Stop** — no truncation, no auto-compact for now (future feature) |

---

## GWT Scenarios

### Rule 1: Follow-up produces meaningful LLM responses

```
Scenario: Ask about completed board's output
  Given a board with status "done" and artifact "research about EV market"
  And the user sends "What were the key findings about charging infrastructure?"
  When the system processes the follow-up message
  Then the LLM receives the artifact + original intent + conversation history
  And the LLM streams a response via SSE
  And the response is stored in agent_conversations
  And the response appears as a chat bubble in the client

Scenario: Ask before pipeline completes
  Given a board with execution_status "running"
  And the user sends a follow-up message
  When the system processes the message
  Then the system returns "Board sedang dalam eksekusi. Tunggu hingga selesai."
  And the message is stored in agent_conversations
```

### Rule 2: Intent classification determines behavior

```
Scenario: Classify ASK intent
  Given a board about "EV market research"
  And the user sends "What did the analysis say about government subsidies?"
  When the LLM classifies the intent
  Then the response has intent "ASK"
  And the response answers the question using artifact context

Scenario: Classify REFINE intent
  Given a board about "EV market research"
  And the user sends "Add a section about charging infrastructure trends in 2025"
  When the LLM classifies the intent
  Then the response has intent "REFINE"
  And the response acknowledges the refinement request
  And the response explains what will be improved

Scenario: Classify NEW_DIRECTION intent
  Given a board about "EV market research"
  And the user sends "Now analyze the competitor landscape for electric scooters"
  When the LLM classifies the intent
  Then the response has intent "NEW_DIRECTION"
  And the response includes a confirmation message
  And the response includes "Ya, Regenerate" and "Batal" buttons

Scenario: Classify OFF_TOPIC intent
  Given a board about "EV market research"
  And the user sends "Write me a Python script to scrape data"
  When the LLM classifies the intent
  Then the response has intent "OFF_TOPIC"
  And the response politely declines
  And the response suggests creating a new board
```

### Rule 3: New Direction requires explicit confirmation

```
Scenario: Confirm regeneration via button
  Given a board with pending regeneration intent "competitor analysis for scooters"
  And the user clicks "Ya, Regenerate"
  When the server receives { action: "confirm_regenerate" }
  Then the server stores the confirmation response in agent_conversations
  And the server updates board.original_intent to the new topic
  And the server clears old agent_card_outputs for this board
  And the server re-runs the pipeline
  And the client receives pipeline SSE events

Scenario: Cancel regeneration via button
  Given a board with pending regeneration intent
  And the user clicks "Batal"
  When the server receives { action: "cancel_regenerate" }
  Then the server clears the pending regeneration state
  And the server stores a cancellation message in agent_conversations
  And the board remains in its current state
```

### Rule 4: Regenerate replaces old state

```
Scenario: Regenerate replaces old outputs
  Given a board about "EV market research" with 5 column outputs and 1 artifact
  And the user confirms regeneration with new topic "scooter competitor analysis"
  When the pipeline re-runs
  Then old agent_card_outputs are deleted
  And old cards are deleted
  And new agent_card_outputs are created with the new topic
  And a new artifact is created after pipeline completes
  And conversation history from the old topic is preserved

Scenario: Regenerate preserves conversation history
  Given a board with 6 conversation messages (user + assistant from previous topic)
  And the user confirms regeneration
  When the pipeline re-runs
  Then the conversation history still contains all 6 previous messages
  And new messages are appended
```

### Rule 5: Follow-up responses stream via SSE

```
Scenario: Stream follow-up response via SSE
  Given a completed board and a follow-up ASK message
  When the LLM generates a response
  Then the server emits agent.card.token events with columnSlug "__notfirst__"
  And the client receives and renders tokens in real-time
  And the tokens appear as a chat bubble in the right panel
  And the column state derivation ignores __notfirst__ events

Scenario: Follow-up tokens do not affect column state
  Given a completed board with all columns in "done" state
  And a follow-up response is streaming with slug "__notfirst__"
  When the client derives column state
  Then all columns remain in "done" state
  And the __notfirst__ events are excluded from state calculation
```

### Rule 6: Scope guard prevents off-topic abuse

```
Scenario: Scope guard rejects clearly off-topic
  Given a board about "EV market research"
  And the user sends "Help me plan a birthday party"
  When the LLM classifies the intent
  Then the response has intent "OFF_TOPIC"
  And the response says "This request is outside the scope of this board"
  And the response suggests creating a new board

Scenario: Scope guard allows borderline requests
  Given a board about "EV market research"
  And the user sends "What about the impact on oil companies?"
  When the LLM classifies the intent
  Then the response has intent "ASK" or "REFINE"
  And the response addresses the question using artifact context
```

---

## Scope Guard System Prompt (Draft)

```xml
<role>
You are a follow-up message handler for an agent board that has completed its
research pipeline. You receive the user's new message along with full context
(original intent, column outputs, final artifact, conversation history).
</role>

<intent_classification>
Classify the user's message into EXACTLY ONE of these types:

1. ASK — User wants to understand, question, or get clarification about the
   board's existing outputs. No modification requested.
   Examples: "Explain the research section", "What did the analysis find?",
   "Why was this recommendation made?"

2. REFINE — User wants to modify, improve, or iterate on the existing
   artifact or specific column outputs. The scope stays within the
   original intent.
   Examples: "Add more data about 2025 trends", "Make the executive
   summary shorter", "The competitor analysis needs more depth"

3. NEW_DIRECTION — User wants to pivot to a DIFFERENT topic that is outside
   the current board's scope. This is NOT a refinement — it's a fundamentally
   different research question.
   Examples: "Now analyze the competitor landscape for product Y",
   "Switch to researching market trends in Southeast Asia",
   "Actually, I want to study supply chain instead"

4. OFF_TOPIC — User's message has NO relation to research, analysis, or the
   board's domain. Nonsense, unrelated tasks, or requests that cannot be
   fulfilled by an agent board.
   Examples: "Write me a Python script", "What's the weather today?",
   "Help me move to a new apartment"
</intent_classification>

<scope_guard_rules>
CRITICAL RULES:
- When in doubt between ASK and REFINE → classify as ASK (safer, cheaper)
- When in doubt between REFINE and NEW_DIRECTION → classify as REFINE
  (keep scope narrow; user will clarify if they meant new topic)
- OFF_TOPIC is only for clearly unrelated requests. If there's ANY plausible
  connection to the board's domain, do NOT classify as OFF_TOPIC.
- For NEW_DIRECTION: respond with a natural language message that informs the
  user the board will be regenerated. Do NOT attempt to answer the new topic.
- For OFF_TOPIC: respond politely, explain you can only help with the board's
  topic, and suggest creating a new board.
</scope_guard_rules>

<response_guidelines>
- Keep responses concise (2-4 sentences max)
- Be helpful and direct
- For ASK: answer the question using the board's outputs as context
- For REFINE: acknowledge the request and explain what will be improved
- For NEW_DIRECTION: confirm the new topic and state that the board will
  be regenerated
- For OFF_TOPIC: politely decline and redirect
</response_guidelines>
```

---

## Few-Shot Examples

```xml
<examples>
<example>
  <context>Board topic: "Market research for electric vehicles in Indonesia"</context>
  <user_message>What were the key findings about consumer preferences?</user_message>
  <classification>ASK</classification>
  <response>The research identified three key consumer preferences: (1) price
  sensitivity under 300M IDR, (2) charging infrastructure availability as the
  top concern, and (3) preference for local brands with government subsidies.
  Would you like me to elaborate on any of these?</response>
</example>

<example>
  <context>Board topic: "Market research for electric vehicles in Indonesia"</context>
  <user_message>Add a section about government regulations and subsidies</user_message>
  <classification>REFINE</classification>
  <response>I'll update the research to include a dedicated section on
  government regulations and subsidies for electric vehicles in Indonesia.
  This will cover current policies, recent changes, and their impact on
  market adoption.</response>
</example>

<example>
  <context>Board topic: "Market research for electric vehicles in Indonesia"</context>
  <user_message>Now research the competitor landscape for electric scooters</user_message>
  <classification>NEW_DIRECTION</classification>
  <response>This is a different research topic from the current board (electric
  vehicles → electric scooters). I'll regenerate the board with this new focus.
  The pipeline will re-run with the updated topic.</response>
</example>

<example>
  <context>Board topic: "Market research for electric vehicles in Indonesia"</context>
  <user_message>Write me a Python script to scrape EV prices</user_message>
  <classification>OFF_TOPIC</classification>
  <response>I can help with research and analysis for your board, but writing
  code is outside my scope. If you'd like to research EV pricing data, I can
  include that in the current board — or you can create a new board for a
  different task.</response>
</example>
</examples>
```

---

## Implementation Summary

### Files to Modify

| File | Changes |
|------|---------|
| `server/src/agent/service.ts` | Upgrade `sendMessage` to: (1) load context, (2) call LLM with scope guard prompt, (3) handle structured payload for confirm/cancel, (4) implement `regenerateBoard` |
| `server/src/agent/llm.ts` | Add `classifyFollowUpIntent()` function — single LLM call with scope guard prompt, returns JSON |
| `server/src/agent/routes.ts` | Update message endpoint to handle `{ action: "confirm_regenerate" }` payload |
| `client/src/pages/AgentPage.tsx` | (1) Enable input when `isDone`, (2) Render follow-up bubbles, (3) Render confirm/cancel buttons for NEW_DIRECTION, (4) Filter `__notfirst__` from column state |
| `client/src/api.ts` | Update `sendAgentBoardMessage` to accept structured payload |

### New Dependencies

None — all infrastructure exists.

### DB Schema Changes

None — uses existing tables (`agent_conversations`, `agent_card_outputs`, `agent_boards`).

---

## Open Questions (Non-Blocking)

```
? Max token budget for follow-up context injection → default MAX_TOKENS (24576)
? Can regenerate be repeated unlimited times? → yes, no limit (V1)
? Rate limit for follow-up messages? → none (V1), add later
```

---

## Phase 5: Design Proposals

### Option A: Single Smart Handler (Recommended)

**Summary:** Satu `sendMessage` endpoint yang auto-detect intent via LLM, handle semua tipe (ASK, REFINE, NEW_DIRECTION, OFF_TOPIC) dalam satu flow.

```
sendMessage(boardId, message)
  ├─ Load context (artifact + intent + conversations)
  ├─ LLM call with scope guard prompt → JSON { intent, response }
  ├─ Stream response via SSE (agent.card.token, slug: __notfirst__)
  ├─ Store in agent_conversations
  └─ If NEW_DIRECTION: set pending state, render buttons
     If confirm_regenerate: update intent → clear → re-run
     If cancel_regenerate: clear pending state
```

**Scenarios satisfied:** Semua 14 GWT scenarios

**Trade-offs:**

- - Simplest implementation — satu LLM call covers routing + response
- - Natural for users — no command syntax
- - Fast to ship — upgrade existing sendMessage
- − No per-type cost optimization (all messages go through same LLM call)
- − Scope guard prompt cukup panjang (~800 tokens system prompt)

**Risk:** LLM misclassify intent (mitigated by Few-Shot examples + confidence score)

### Option B: Explicit Routing Layer

**Summary:** Tambah classification step terpisah — LLM kecil classify dulu, lalu route ke handler khusus per tipe.

```
sendMessage(boardId, message)
  ├─ Step 1: Lightweight LLM classify → { intent: "ASK" }
  ├─ Step 2: Route to handler
  │   ├─ ASK → focused system prompt, answer only
  │   ├─ REFINE → focused system prompt, acknowledge only
  │   ├─ NEW_DIRECTION → confirmation flow
  │   └─ OFF_TOPIC → reject template (no LLM)
  └─ Stream response via SSE
```

**Scenarios satisfied:** Semua 14 GWT scenarios

**Trade-offs:**

- - Per-handler system prompt lebih fokus (better quality per type)
- - Cost bisa di-tune per type (cheaper model untuk ASK, stronger untuk REFINE)
- − Extra LLM call untuk classification (latency + cost per message)
- - OFF_TOPIC bisa di-handle tanpa LLM (pure template response)
- − Lebih banyak code — 4 handlers + classifier + routing logic

**Risk:** Over-engineering untuk V1 (mitigated: bisa di-build incrementally)

### Recommendation: Option A

**Reasoning:**

1. **Scenario coverage** — semua 14 GWT ter-handle dengan 1 LLM call
2. **Speed to ship** — upgrade sendMessage, tidak perlu routing infrastructure
3. **User experience** — natural, tidak perlu belajar command syntax
4. **Consistency** — konsisten dengan existing pipeline (1 LLM call per card)
5. **Extensibility** — Option B bisa di-layer on nanti kalau cost optimization jadi concern

Satu-satunya downside Option A adalah scope guard prompt yang panjang (~800 tokens), tapi dengan prompt caching ini bukan masalah.

---

## Phase 6: Architecture Validation

```
[✓] Respects layer boundaries?
    — Hanya touch service.ts, llm.ts, AgentPage.tsx, api.ts. Tidak ada DB schema changes.

[✓] Follows existing patterns?
    — Dependency injection (service deps), streaming via SSE, same event structure.

[✓] No new dependencies?
    — Semua infrastructure sudah ada (agent_conversations, agent_card_outputs, etc.)

[✓] Rollback/undo strategy defined?
    — Cancel regeneration = clear in-memory pending state. Board unchanged.
    — Regenerate fails = board in "failed" state, user can retry.

[✓] No silent data migrations or breaking changes?
    — Tidak ada schema changes. DELETE + INSERT on regenerate (same as existing pattern).

[✓] Performance characteristics acceptable?
    — 1 LLM call per follow-up (~2-5s latency). Context injection via prompt caching.
    — Regenerate = full pipeline re-run (same as initial execution).

[✓] No security regressions?
    — requireAuth on all endpoints. Workspace membership checked. No new attack surface.
```

**Result: PASS** — semua checklist terpenuhi.

---

## Remaining Phases

- [ ] Phase 7: Handoff Package (invoke pocket-planning)
