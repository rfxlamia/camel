# AI Chat Page

**Date:** 2026-07-30
**Status:** draft
**Author:** pocket-grinding session
**Spec path:** docs/pocket/spec/2026-07-30-ai-chat/ai-chat.md

---

## Summary

Add a standalone `/chat` page for pure AI conversation — separate from the agentic kanban pipeline at `/agent`. Users get multi-thread chat (ChatGPT-style) with streaming responses, tool use (web search, board queries, file creation), and full transparency (thinking + tool traces). Chat is global per user with private history.

---

## Context

### Current State

- `/agent` runs a multi-stage agentic pipeline (classify → columns → execute → artifact) bound to `agent_boards`.
- Ticket intake overlay provides structured chat for Linear ticket extraction — not free-form.
- Anthropic SDK, tool registry (`web_search`, `query_board_data`, `create_file`), `llm.ts` tool loop, and `ToolTrace` UI already exist.
- Streaming today is workspace SSE for agent column tokens only — no generic chat endpoint.

### Problem / Motivation

Users need a general-purpose AI assistant within Camel without triggering the kanban agent pipeline. Existing chat UIs are task-scoped (board follow-up, ticket intake). A dedicated chat page fills this gap while reusing proven AI infrastructure.

### Related Areas

- `server/src/agent/llm.ts` — Anthropic client, tool loop, extended thinking
- `server/src/agent/tools/` — tool registry and implementations
- `client/src/components/ToolTrace.tsx` — tool trace UI
- `client/src/components/agent/AgentChatPanel.tsx` — markdown rendering patterns
- `client/src/layout/sidebar/navItems.ts` — nav mode grouping
- `client/src/App.tsx` — routing

---

## Scope

### In-Scope

- New `/chat/:threadId` page — pure AI chat UI (sidebar thread list + message area + composer)
- Global per user — only the owning user can see/access their threads
- Multi-thread: new chat, rename, hard delete, auto-title after first successful assistant response
- Streaming token-by-token responses via dedicated chat endpoint (not workspace SSE)
- Full thread history as LLM context; hard fail when context window exceeded
- Message queue: messages sent during streaming are queued and auto-sent after stream completes
- Tool use — reuse existing tools:
  - `web_search` (Tavily)
  - `query_board_data` — AI asks which workspace if unclear
  - `create_file` — thread-scoped attachments (md/txt/csv, max 1MB)
- Extended thinking + ToolTrace visible during streaming; persisted and rehydrated on reload
- Inline error bubble on LLM failure with Retry (regenerate without duplicating user bubble)
- Partial stream failure: delete partial assistant bubble, show error + Retry
- Nav entry in agent mode group (alongside `/agent`, `/history`)
- Frontend libraries permitted to accelerate UI development
- Skip `recordActivity()` — chat has own audit trail in chat tables

### Out-of-Scope

- Agentic kanban pipeline (classify, columns, execute, artifact generation)
- Linear / ticket intake integration
- User file/image upload
- Multi-model picker
- Share chat between users
- Mobile-native app
- Chat events in workspace Activity feed

---

## Architecture Constraints

- **May touch:** client pages/components, `api.ts`, server routes, db schema (`chat-schema.sql`), llm wrapper extraction, tool registry
- **Must NOT touch:** agent pipeline orchestration (`service.ts` stages), kanban board logic, ticket-intake
- **Patterns:** NodeNext ESM (`.js` extensions), creative-brief.md for UI (OKLCH, Work Sans)
- **recordActivity:** skipped for chat mutations (separate domain from kanban)
- **Architecture validation:** PASS

---

## Dependencies

### Existing (to leverage)

- `@anthropic-ai/sdk` — LLM calls, streaming, tool use, extended thinking
- `@tavily/core` — web search tool
- `react-markdown` + `remark-gfm` — message rendering
- `ToolTrace.tsx` + `toolTrace.ts` — tool trace UI and derivation
- `llm.ts` — extract shared `runChatTurn()` from existing tool loop
- `prompt-sanitizer.ts` — input/output sanitization
- `react-router` v7 — `/chat/:threadId` routing

### New (proposed)

- `@assistant-ui/react` — thread list, message list, composer primitives; accelerates ChatGPT-style multi-thread UI without hand-rolling sidebar/message layout. Alternatives rejected: Vercel AI SDK (`ai` + `@ai-sdk/react`) would duplicate `llm.ts` extended thinking and tool loop; fully custom UI is viable but slower for thread management UX.

---

## Stories + Scenarios

### Story 1: Thread management

> As a logged-in user, I want to create and manage chat threads, so that I can organize separate conversations.

**Rule 1: Thread CRUD**

```gherkin
Scenario: Create new thread
  Given user is authenticated on /chat
  When user clicks "New chat" and no empty thread exists
  Then a new thread is created and user navigates to /chat/:threadId

Scenario: Focus existing empty thread
  Given user already has a zero-message thread
  When user clicks "New chat"
  Then the existing empty thread is focused (no duplicate created)

Scenario: Auto-title after first success
  Given a new thread titled "Untitled"
  When user sends first message and assistant responds successfully
  Then thread title is set to truncated first user message

Scenario: Auto-title on failure
  Given a new thread
  When first message fails (LLM error)
  Then title remains "Untitled"

Scenario: Hard delete thread
  Given thread with messages and attachments
  When user confirms delete
  Then thread, messages, attachments are permanently removed

Scenario: Rename thread
  Given thread titled "Budget Q3"
  When user renames to "Q3 Planning"
  Then title is persisted
```

### Story 2: Message exchange

> As a user, I want to chat with AI and see streaming responses.

**Rule 1: Streaming and context**

```gherkin
Scenario: Streaming response
  Given thread with prior messages
  When user sends a message
  Then assistant response streams token-by-token
  And full thread history is sent as LLM context

Scenario: Context overflow
  Given thread exceeds model context window
  When user sends a message
  Then inline error "Thread too long, start a new chat" appears
  And message is not persisted (stays in composer)
  And no Retry button

Scenario: Queue during stream
  Given assistant is streaming
  When user sends another message
  Then message is queued
  And auto-sent after current stream completes (success or failure)

Scenario: LLM failure with retry
  Given LLM API returns error
  When user sends a message
  Then inline error bubble appears with Retry
  And Retry regenerates assistant response without duplicating user bubble

Scenario: Partial stream failure
  Given assistant is streaming
  When LLM fails mid-stream
  Then partial assistant bubble is deleted
  And error bubble with Retry appears
```

### Story 3: Tool use

> As a user, I want AI to use tools when needed.

```gherkin
Scenario: Workspace clarification
  Given user has workspaces "Dev" and "Marketing"
  When user asks "what's our cycle time?" without naming workspace
  Then AI asks which workspace (no tool call yet)

Scenario: Board query after clarification
  Given user clarifies "Marketing"
  When AI calls query_board_data
  Then ToolTrace shows query and results

Scenario: File attachment
  Given user asks AI to create a report
  When create_file succeeds
  Then file appears as downloadable attachment in message bubble
  And file is stored in chat_attachments (not agent_artifacts)

Scenario: Tool failure graceful
  Given web_search returns RATE_LIMIT
  When tool loop completes
  Then ToolTrace shows error badge
  And assistant responds with graceful fallback (not whole-turn failure)
```

### Story 4: Transparency and privacy

```gherkin
Scenario: Thinking and tool trace visible
  Given AI uses extended thinking and web_search
  When response streams
  Then thinking blocks and ToolTrace collapsible UI are visible

Scenario: Rehydrate on reload
  Given completed message with thinking and tool traces
  When user reloads /chat/:threadId
  Then thinking and tool traces are restored from DB

Scenario: User isolation
  Given user A's thread id
  When user B requests that thread
  Then 404 (no existence leak)
```

### Story 5: Navigation

```gherkin
Scenario: Agent mode nav
  Given user switches to agent mode
  Then /chat appears alongside /agent and /history
  And getModeFromPath("/chat") returns "agent"

Scenario: /chat index redirect
  Given user navigates to /chat (no threadId)
  When page loads
  Then redirect to most-recent thread or create new thread → /chat/:threadId
```

---

## Acceptance Criteria

```
ACCEPTANCE CRITERIA — AI Chat Page
Date: 2026-07-30 | Scope confirmed: yes

Rule: Thread management
  ✓ Given authenticated user, When "New chat" clicked, Then new thread at /chat/:threadId
  ✓ Given zero-message thread exists, When "New chat" clicked, Then focus existing empty thread
  ✓ Given first successful assistant response, When complete, Then auto-title from truncated user message
  ✓ Given first message fails, When error, Then title stays "Untitled"
  ✓ Given thread with data, When hard delete confirmed, Then all data permanently removed
  ✓ Given thread, When renamed, Then title persisted

Rule: Message exchange
  ✓ Given thread with history, When message sent, Then streaming response with full history context
  ✓ Given context overflow, When message sent, Then "Thread too long" error, no persist, no Retry
  ✓ Given streaming in progress, When another message sent, Then queued and auto-sent after stream ends
  ✓ Given LLM error, When occurs, Then inline error + Retry regenerates without duplicate user bubble
  ✓ Given mid-stream failure, When occurs, Then partial assistant deleted, error + Retry shown

Rule: Tool use
  ✓ Given ambiguous workspace, When board question asked, Then AI clarifies before tool call
  ✓ Given create_file success, When complete, Then downloadable attachment in thread (md/txt/csv, max 1MB)
  ✓ Given tool failure, When occurs, Then ToolTrace shows error, assistant degrades gracefully

Rule: Transparency
  ✓ Given streaming with thinking/tools, When active, Then visible in UI
  ✓ Given page reload, When on /chat/:threadId, Then thinking + tool traces rehydrated from DB

Rule: Privacy & nav
  ✓ Given other user's threadId, When accessed, Then 404
  ✓ Given agent mode, When sidebar renders, Then /chat visible with /agent and /history
```

---

## Design Decision

**Chosen option:** Option B — Shared LLM Core + assistant-ui

**Summary:** Extract a `runChatTurn()` function from `llm.ts` that accepts a messages array (multi-turn) instead of single intent string. Build a new `server/src/chat/` module with REST + fetch-stream endpoint. Use `@assistant-ui/react` on the frontend for thread list and composer primitives, with custom renderers for ToolTrace, thinking blocks, and attachments. Reuse existing tool registry with a chat-specific `create_file` variant that writes to `chat_attachments`.

**Rejected options:**
- **Option A (fully custom UI):** viable but slower for multi-thread sidebar UX; duplicates layout work assistant-ui solves
- **Option C (Vercel AI SDK full stack):** would duplicate extended thinking, tool loop, and prompt sanitization in `llm.ts`; rejected

**Key tradeoffs accepted:**
- New frontend dependency (`@assistant-ui/react`) for speed; custom renderers still needed for ToolTrace/thinking
- `create_file` needs chat-specific implementation (not reuse agent board-bound version directly)
- Full history context may hit limits on long threads — hard fail is explicit UX cost
- Chat mutations skip `recordActivity` — no kanban activity feed integration

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Workspace sticky context across turns | assumed: AI reuses last clarified workspace in same thread | User may need to re-clarify; acceptable |
| Delete confirmation for non-empty threads | assumed: confirm dialog for threads with messages; empty deletes immediately | Minor UX preference |
| Thread sidebar sort order | assumed: most recent activity first | Low risk |
| Auto-title truncation length | assumed: ~50 chars from first user message | Cosmetic |
| Streaming transport | assumed: HTTP fetch ReadableStream from POST endpoint | Implementation detail |
| Rate limiting | assumed: reuse express-rate-limit pattern from ticket-intake | May need tuning |

---

## Implementation Notes

- DB schema: new `chat-schema.sql` with `chat_threads`, `chat_messages`, `chat_attachments` tables
- `create_file` chat variant: persist LLM-generated content directly to `chat_attachments` (not `agent_artifacts`)
- `query_board_data` needs workspace resolution — AI clarifies via conversation, then passes `workspaceId` to tool
- `AGENT_PATHS` and `AGENT_NAV` in `navItems.ts` must include `/chat`
- `getModeFromPath("/chat")` must return `"agent"`
- Message queue: client-side queue drained after stream `done` or `error` event
- Thinking/tool trace stored as JSONB on `chat_messages` row for rehydration
- No workspace SSE for chat — dedicated per-request stream scoped to `userId + threadId`

---

## Rollback Plan

- Remove `/chat` route and nav entry
- Drop chat tables via migration rollback
- No impact on agent pipeline or kanban (isolated module)
- If `@assistant-ui/react` causes issues, fallback to custom UI (Option A) without backend changes
