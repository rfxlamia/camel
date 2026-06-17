# Pitch Exploration: agent-multi-turn-conversation

Date: 2026-06-17 | Project: Agentic Kanban | Status: pitch-only

---

## Problem Statement

After the agent board completes its 5-column pipeline (Research → Analysis → Writer → Editor → QA), users can type follow-up messages but get no meaningful response. The `sendMessage` method returns a static acknowledgment for approved boards — there is no LLM call, no context injection, no actionable output. Users are stuck with a one-shot interaction.

## Root Tension

Users want to iterate on agent outputs (ask questions, refine documents, extend analysis) but the system treats every board as a fire-and-forget pipeline. Supporting multi-turn requires balancing response quality (rich context) against cost (LLM calls per message) and scope creep (off-topic requests).

## Key Constraints

- `executeCard` is already a standalone function (systemPrompt + userContent → output) — single LLM calls are ready to use
- `runPipeline` iterates all columns sequentially with an `accumulator` pattern — partial re-run is feasible by pre-populating the accumulator with existing outputs
- `agent_conversations` table already exists with `role + content` schema — context storage is in place
- `agent_card_outputs` stores per-column outputs — full pipeline context is available for injection
- `agent_artifacts` stores the final document — artifact mutation (refine) is possible
- Scope guard is non-negotiable — off-topic requests must be rejected gracefully to prevent cost abuse

---

## Brainstorming Methods Used

### Question Storming — deep

Key insights:

- There are fundamentally different types of follow-up: asking about results, refining the artifact, extending the analysis, or starting a new direction
- Each type has different cost characteristics (single LLM call vs partial pipeline vs full pipeline)
- User intent classification is the core routing problem

### First Principles Thinking — creative

Key insights:

- The system already has all the context it needs (conversations + outputs + artifacts) — this is an implementation gap, not a design gap
- A single LLM call with injected context can handle most follow-up types without re-running the pipeline
- Artifact versioning and branching are V2 concerns that don't address the core gap

### Six Thinking Hats — structured

Key insights:

- (White) 5 column outputs are stored, conversation table exists, client input is active but server ignores it
- (Yellow) Multi-turn makes the board 10x more valuable — one intent, many iterations
- (Black) Full pipeline re-run is expensive; scope creep risks cost abuse
- (Green) Partial re-run (only affected columns), quick refine (single LLM call), and branch-and-compare are all viable

### Reverse Brainstorming — creative

Key insights:

- Worst case: re-run full pipeline every message (expensive, slow), no context injection (user repeats themselves), no scope guard ("make me pizza")
- Anti-patterns reveal requirements: taxonomy of actions, context auto-injection, cost tiers, scope guardrails

---

## Advisor Synthesis

All 4 methods converged on the same framework: a taxonomy of follow-up types (Ask, Refine, Extend, New Direction) mapped to cost tiers. Context is already solved — `agent_conversations` + `agent_card_outputs` + `agent_artifacts` hold everything. The real design axis is: single smart LLM call (auto-detect intent) vs explicit routing layer (classify then dispatch). Branching, versioning, and training data are V2+ concerns that add complexity without addressing the core gap.

---

## Spike Results

**Unknown resolved:** Can `runPipeline` support partial re-run? Can `executeCard` handle single follow-up calls?
**Finding:**

- `runPipeline` iterates `getColumns(boardId)` sequentially with an accumulator — adding a `startFromColumn` param + pre-populating accumulator with existing outputs is straightforward
- `executeCard` is a standalone function that takes `(systemPrompt, intent, previousOutputs, reasoning, onToken, tools, toolBudget, onToolEvent, onThinking, userContent)` — ready for single follow-up calls
**Implication:** All 4 follow-up types are technically feasible. Ask and Refine use `executeCard` directly. Extend uses modified `runPipeline` with partial iteration. New Direction = new board (existing behavior).

---

## Approach Directions

### Direction A: Single Smart Handler

One `sendMessage` endpoint that auto-detects intent from the user's message + injected context. The LLM receives a system prompt describing all 4 action types and determines the appropriate response. No separate classification step.
- Simplest implementation — one LLM call covers routing + response
- Natural for users — no command syntax to learn
- Fast to ship — just upgrade the existing `sendMessage` from placeholder to real LLM call
− No per-type cost optimization (all messages go through same LLM call)
− Extend (partial pipeline) needs special-case handling inside the handler

### Direction B: Explicit Routing Layer

Add a classification step in `sendMessage` — a lightweight LLM call classifies the message into one of 4 types, then routes to a dedicated handler with an optimized system prompt per type.
- Each handler has a focused system prompt (better quality per type)
- Cost can be tuned per type (cheaper model for Ask, stronger for Refine)
- Different UX per type (Ask = text bubble, Refine = artifact preview diff)
− Extra LLM call for classification (latency + cost per message)
− More code — 4 handlers + classifier + routing logic

### Direction C: Hybrid — Command + Auto-detect

Users can type explicit prefixes (`/ask`, `/refine`, `/extend`) or natural language that auto-detects. Commands skip classification; natural language goes through it.
- Power users get instant routing (no classification latency)
- Natural users are still served via auto-detect
- Can be built incrementally — commands first, auto-detect later
− Dual input surface area (commands vs natural)
− Documentation burden — users must learn command syntax

---

## Open Questions for pocket-grinding

- [ ] What system prompt structure best handles all 4 action types in a single LLM call? (Phase 3 Discovery)
- [ ] How should the UI differentiate between Ask responses (text bubble) and Refine responses (artifact update)? (Phase 5 Design)
- [ ] Should Extend re-run from the affected column or from the beginning? How to determine "affected column" from natural language? (Phase 3 Discovery)
- [ ] What scope guard prompt prevents off-topic requests while allowing legitimate follow-ups? (Phase 3 Discovery)
- [ ] How should conversation history be formatted for context injection — raw messages or summarized? (Phase 5 Design)
- [ ] Should artifact mutation create a new version or overwrite? (Phase 5 Design)

---

## Recommended Direction

Direction A: Single Smart Handler — fastest to ship, natural for users, and the simplest path to closing the core gap. The explicit routing layer (Direction B) can be layered on later when cost optimization becomes a real concern. Start simple, optimize when data shows which follow-up types are most used.

---

## Handoff Context (for pocket-grinding)

When pocket-grinding reads this doc:

- Start with this problem statement (Phase 1 context)
- Use Direction A (Single Smart Handler) as the working hypothesis for Phase 5 Design Proposals
- Treat Open Questions above as Phase 3 Discovery targets
- Do NOT treat Approach Directions as final architecture — validate through GWT first
- Key technical reference: `executeCard` in `server/src/agent/llm.ts` for single-call capability, `runPipeline` in `server/src/agent/service.ts` for pipeline structure
