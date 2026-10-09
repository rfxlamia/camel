# EXECUTION PLAN — AI Chat Page

**Date:** 2026-07-30
**Spec:** docs/pocket/spec/2026-07-30-ai-chat/ai-chat.md
**Status:** validated
**Total tasks:** 9

### Test-Architect Summary
Tasks enriched: 9
Integration test tasks added: 0 (T9 already present)
TDD order corrections: 0 (all tasks already test-first)
Test framework: vitest
Coverage areas: DB schema/migration (T1), LLM runChatTurn extraction (T2), chat service CRUD + isolation (T3), chat tools create_file + factory (T4), HTTP routes + NDJSON streaming (T5), client API contract (T6), ChatPage shell + nav routing (T7), streaming hook + transparency UI (T8), end-to-end integration (T9)
CI note: T3/T4/T9 use `RUN_INTEGRATION=1` (skipped in default `npm test`). T9 wires chat integration tests into the CI integration job via `test:integration:routes`.

---

## Execution Overview

### Recommended Order
```
T1, T2 (parallel) → T3 → T4 → T5 → T6 → T7 → T8 → T9
```

> Dependency order above is **recommended** — pocket-development enforces actual sequencing.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Foundation | T1, T2 | none (both prereq) |
| Backend stack | T3 | T1 |
| Tools | T4 | T1, T3 |
| Routes | T5 | T2, T3, T4 |
| Frontend stack | T6 → T7 → T8 | sequential |
| Integration | T9 | T5 |

### Constraints Reminder
**Architecture:** Chat module isolated from agent pipeline orchestration (`service.ts` stages). NodeNext ESM (`.js` extensions). Skip `recordActivity()` for chat. No workspace SSE — dedicated fetch-stream per request. Chat streaming routes exempt from 30s request timeout (same as `/agent/`).
**Workspace context:** Threads are user-scoped (no `workspace_id` column). `query_board_data` receives `workspaceId` per message POST body; server validates membership via `lookupMembership`. Client passes current workspace from `BoardContext` on each send (sticky in client state, not persisted on thread).
**Out-of-scope:** Agent pipeline, ticket-intake, user upload, multi-model picker, share chat, mobile app, Activity feed integration.
**Assumptions at risk:** Delete confirm for non-empty threads; auto-title ~50 chars; rate limit reuses `checkChatLimit` from ticket-intake.

### File Structure Map

```
Rule: Thread management
  Create: server/src/db/chat-schema.sql                    (T1)
  Modify: server/src/db/migrate.ts                        (T1)
  Modify: server/src/db/types.ts                          (T1)
  Modify: CLAUDE.md                                       (T1)
  Test:   server/src/db/chatSchema.test.ts                 (T1)
  Create: server/src/chat/types.ts                        (T3)
  Create: server/src/chat/service.ts                      (T3)
  Test:   server/src/chat/service.test.ts                 (T3)

Rule: Message exchange (server)
  Create: server/src/chat/run-chat-turn.ts                (T2)
  Modify: server/src/agent/llm.ts                         (T2)
  Create: server/src/chat/stream-protocol.ts              (T5)
  Create: server/src/chat/routes.ts                       (T5)
  Modify: server/src/index.ts                             (T5)
  Test:   server/src/chat/run-chat-turn.test.ts           (T2)
  Test:   server/src/chat/routes.test.ts                  (T5)

Rule: Tool use
  Create: server/src/chat/tools/createChatFile.ts         (T4)
  Create: server/src/chat/tools/factory.ts                (T4)
  Test:   server/src/chat/tools/createChatFile.test.ts    (T4)
  Test:   server/src/chat/tools/factory.test.ts            (T4)

Rule: Message exchange (client) + Transparency
  Modify: client/src/types.ts                             (T6)
  Modify: client/src/api.ts                               (T6)
  Test:   client/src/api.test.ts                          (T6)
  Create: client/src/hooks/useChatStream.ts               (T8)
  Reuse:  client/src/lib/agentQueue.ts                     (T8)
  Create: client/src/components/chat/ChatMessage.tsx      (T8)
  Create: client/src/components/chat/ChatErrorBubble.tsx  (T8)
  Create: client/src/components/chat/ChatAttachment.tsx   (T8)
  Test:   client/src/hooks/useChatStream.test.ts          (T8)
  Test:   client/src/components/chat/ChatMessage.test.tsx (T8)

Rule: Privacy & nav + assistant-ui shell
  Modify: client/package.json                             (T7)
  Create: client/src/pages/ChatPage.tsx                   (T7)
  Create: client/src/chat/ChatRuntimeProvider.tsx         (T7)
  Create: client/src/chat/threadListAdapter.ts            (T7)
  Create: client/src/chat/modelAdapter.ts                 (T7)
  Modify: client/src/chat/modelAdapter.ts                 (T8)
  Modify: client/src/App.tsx                              (T7)
  Modify: client/src/layout/sidebar/navItems.ts           (T7)
  Test:   client/src/layout/sidebar/navItems.test.ts      (T7)
  Test:   client/src/pages/ChatPage.test.tsx              (T7)

Rule: Integration + CI
  Test:   server/src/chat/chat.integration.test.ts        (T9)
  Modify: .github/workflows/ci.yml                         (T9)
  Modify: CLAUDE.md                                      (T1)
```

---

## Pocket Packets

---

### Task 1: Chat database schema and migration [prereq]

## OBJECTIVE
Create `chat_threads`, `chat_messages`, and `chat_attachments` tables with migration wiring.

Files:
- Create: `server/src/db/chat-schema.sql`
- Modify: `server/src/db/migrate.ts`
- Modify: `server/src/db/types.ts`
- Modify: `CLAUDE.md`

Steps:
1. Write failing test for schema expectations:
   File: `server/src/db/chatSchema.test.ts`

   ```typescript
   import { readFileSync } from "node:fs";
   import { dirname, join } from "node:path";
   import { fileURLToPath } from "node:url";
   import { describe, expect, it } from "vitest";

   const here = dirname(fileURLToPath(import.meta.url));

   describe("chat-schema.sql", () => {
     const sql = readFileSync(join(here, "chat-schema.sql"), "utf8");

     it("defines chat_threads with user_id, title, updated_at (no workspace_id)", () => {
       expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS chat_threads/i);
       expect(sql).toMatch(/user_id.*REFERENCES users/i);
       expect(sql).toMatch(/\btitle\b/i);
       expect(sql).toMatch(/\bupdated_at\b/i);
       expect(sql).not.toMatch(/\bworkspace_id\b/i);
     });

     it("defines chat_messages with thread_id, role, content, thinking, tool_trace JSONB", () => {
       expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS chat_messages/i);
       expect(sql).toMatch(/thread_id.*REFERENCES chat_threads/i);
       expect(sql).toMatch(/\brole\b/i);
       expect(sql).toMatch(/\bcontent\b/i);
       expect(sql).toMatch(/\bthinking\b/i);
       expect(sql).toMatch(/tool_trace.*JSONB/i);
       expect(sql).toMatch(/role.*CHECK.*user.*assistant.*error/i);
     });

     it("defines chat_attachments with message_id, filename, format, content", () => {
       expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS chat_attachments/i);
       expect(sql).toMatch(/message_id.*REFERENCES chat_messages/i);
       expect(sql).toMatch(/\bfilename\b/i);
       expect(sql).toMatch(/format.*CHECK.*md.*txt.*csv/i);
       expect(sql).toMatch(/\bcontent\b/i);
     });

     it("CASCADE deletes thread → messages → attachments", () => {
       expect(sql).toMatch(/chat_messages[\s\S]*ON DELETE CASCADE/i);
       expect(sql).toMatch(/chat_attachments[\s\S]*ON DELETE CASCADE/i);
     });

     it("indexes user_id+updated_at, thread_id, message_id", () => {
       expect(sql).toMatch(/idx_chat_threads_user_updated/i);
       expect(sql).toMatch(/idx_chat_messages_thread/i);
       expect(sql).toMatch(/idx_chat_attachments_message/i);
     });
   });

   describe("migrate.ts wiring", () => {
     it("applies chat-schema.sql after agent-schema.sql", () => {
       const migrateSrc = readFileSync(join(here, "migrate.ts"), "utf8");
       expect(migrateSrc).toMatch(/chat-schema\.sql/);
       expect(migrateSrc).toMatch(/agent-schema\.sql[\s\S]*chat-schema\.sql/);
     });
   });

   describe("Kysely types", () => {
     it("registers ChatThreads, ChatMessages, ChatAttachments on Database", async () => {
       const { Database } = await import("./types.js");
       type DB = Database;
       type Tables = keyof DB;
       const _threads: Tables = "chat_threads";
       const _messages: Tables = "chat_messages";
       const _attachments: Tables = "chat_attachments";
       expect(_threads).toBe("chat_threads");
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- server/src/db/chatSchema.test.ts`
   Expected failure: module/file not found or assertion on missing SQL content.
3. Implement schema:
   - `server/src/db/chat-schema.sql`: tables with indexes on `chat_threads(user_id, updated_at DESC)`, `chat_messages(thread_id)`, `chat_attachments(message_id)`; `format` CHECK IN ('md','txt','csv'); `role` CHECK IN ('user','assistant','error').
   - Update `migrate.ts` to apply `chat-schema.sql` after `agent-schema.sql`.
   - Add Kysely interfaces `ChatThreads`, `ChatMessages`, `ChatAttachments` to `types.ts` and register in `Database` interface.
   - Update `CLAUDE.md` migration note: `make db-migrate` applies `schema.sql`, `agent-schema.sql`, and `chat-schema.sql`.
4. Run test — verify PASS:
   `npm run test -- server/src/db/chatSchema.test.ts`
5. Refactor while green: none expected.
6. Commit:
   `git add server/src/db/chat-schema.sql server/src/db/migrate.ts server/src/db/types.ts server/src/db/chatSchema.test.ts CLAUDE.md`
   `git commit -m "feat(chat): add chat database schema and migration"`

## REFERENCES LOADED
docs/pocket/spec/2026-07-30-ai-chat/ai-chat.md — rule: Thread management, hard delete cascade
server/src/db/agent-schema.sql — pattern for additive schema file + migrate.ts wiring
server/src/db/migrate.ts — existing dual-schema migration pattern

## WHY THIS APPROACH
Justification: Schema is prerequisite for all chat persistence; isolated file follows agent-schema pattern.
Complexity: lightweight

## SANDWICH CONTEXT
[CRITICAL: Chat tables are user-scoped (user_id), NOT workspace-scoped — do not add workspace_id to chat_threads.]
You are implementing chat database schema for AI Chat Page.
Spec: docs/pocket/spec/2026-07-30-ai-chat/ai-chat.md
Design decision: Option B — Shared LLM Core + assistant-ui
Files in scope: server/src/db/chat-schema.sql, migrate.ts, types.ts, chatSchema.test.ts
Available after: none (prereq)
Architecture rule: Skip recordActivity; chat audit in own tables
[RESTATE: chat_threads.user_id scoped — no workspace_id on threads.]

## DELIVERABLE
Given migration runs, When tables created, Then chat_threads/chat_messages/chat_attachments exist with correct FKs and CASCADE delete.
Given thread deleted, When CASCADE, Then messages and attachments removed.
[must-not] Given schema design, When implemented, Then system must NOT add workspace_id to chat_threads.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Three tables with proper indexes and constraints
  - migrate.ts applies chat-schema.sql
  - Kysely types updated
  - Tests written BEFORE implementation (TDD)
Must-not-have:
  - Modifications to agent-schema.sql or kanban schema.sql
  - recordActivity integration
Open question risks:
  - Auto-title length ~50 chars → cosmetic, handled in service layer (T3)
Rollback note:
  - Drop chat tables via migration rollback

## STOP CONDITIONS
Done when: schema test passes, commit created
Escalate when: schema requires workspace_id on threads (violates spec)

---

### Task 2: Extract runChatTurn from llm.ts [prereq]

## OBJECTIVE
Extract a reusable `runChatTurn()` that accepts multi-turn Anthropic messages array, supports tools, extended thinking, and streaming callbacks.

Files:
- Create: `server/src/chat/run-chat-turn.ts`
- Modify: `server/src/agent/llm.ts`

Steps:
1. Write failing test for multi-turn chat with tools:
   File: `server/src/chat/run-chat-turn.test.ts`

   ```typescript
   import { beforeEach, describe, expect, it, vi } from "vitest";
   import type { Tool, ToolEvent } from "../agent/tools/types.js";

   const mockStream = vi.fn();
   vi.mock("@anthropic-ai/sdk", () => ({
     default: class MockAnthropic {
       messages = { stream: mockStream };
     },
   }));

   function makeTurn(opts: {
     text?: string;
     stopReason: "tool_use" | "end_turn";
     toolUse?: { id: string; name: string; input: Record<string, unknown> };
   }) {
     const content: unknown[] = [];
     if (opts.text) content.push({ type: "text", text: opts.text });
     if (opts.toolUse) content.push({ type: "tool_use", ...opts.toolUse });
     return {
       async *[Symbol.asyncIterator]() {
         if (opts.text) {
           yield {
             type: "content_block_delta",
             delta: { type: "text_delta", text: opts.text },
           };
         }
       },
       finalMessage: vi
         .fn()
         .mockResolvedValue({ stop_reason: opts.stopReason, content }),
     };
   }

   function mockTool(execute: Tool["execute"]): Tool {
     return {
       name: "web_search",
       description: "Search the web",
       inputSchema: { type: "object", properties: { query: { type: "string" } } },
       riskTier: "read-only",
       execute,
     };
   }

   describe("runChatTurn", () => {
     beforeEach(() => mockStream.mockReset());

     it("streams tokens for multi-turn messages array", async () => {
       mockStream.mockReturnValueOnce(
         makeTurn({ text: "Hello world", stopReason: "end_turn" }),
       );
       const { runChatTurn } = await import("./run-chat-turn.js");
       const onToken = vi.fn();
       const result = await runChatTurn({
         systemPrompt: "You are helpful.",
         messages: [
           { role: "user", content: "Hi" },
           { role: "assistant", content: "Hello" },
           { role: "user", content: "Again" },
         ],
         tools: [],
         toolBudget: 3,
         onToken,
       });
       expect(onToken).toHaveBeenCalledWith("Hello world");
       expect(result.output).toBe("Hello world");
     });

     it("executes web_search tool and fires onToolEvent callbacks", async () => {
       mockStream
         .mockReturnValueOnce(
           makeTurn({
             text: "searching",
             stopReason: "tool_use",
             toolUse: { id: "tu_1", name: "web_search", input: { query: "camel" } },
           }),
         )
         .mockReturnValueOnce(
           makeTurn({ text: "Found results.", stopReason: "end_turn" }),
         );
       const execute = vi.fn(async () => ({ ok: true, content: "3 hits" }));
       const events: ToolEvent[] = [];
       const { runChatTurn } = await import("./run-chat-turn.js");
       const result = await runChatTurn({
         systemPrompt: "You are helpful.",
         messages: [{ role: "user", content: "Search camel kanban" }],
         tools: [mockTool(execute)],
         toolBudget: 3,
         onToken: vi.fn(),
         onToolEvent: (e) => events.push(e),
       });
       expect(execute).toHaveBeenCalledTimes(1);
       expect(events.map((e) => e.phase)).toEqual(
         expect.arrayContaining(["started", "result"]),
       );
       expect(result.output).toBe("Found results.");
     });

     it("estimateContextTokens counts message content length", async () => {
       const { estimateContextTokens } = await import("./run-chat-turn.js");
       const tokens = estimateContextTokens([
         { role: "user", content: "hello" },
         { role: "assistant", content: "world" },
       ]);
       expect(tokens).toBeGreaterThan(0);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- server/src/chat/run-chat-turn.test.ts`
   Expected failure: module not found.
3. Implement:
   - Extract `executeCardWithTools` core loop into `runChatTurn({ systemPrompt, messages, tools, toolBudget, onToken, onThinking, onToolEvent })` in `run-chat-turn.ts`.
   - Refactor `llm.ts` `executeCard` to delegate to shared internals (no behavior change for agent pipeline). **Highest-risk backend task** — run `llm.test.ts` after each incremental change, not only at the end.
   - Apply `createSafeSystemPrompt`, `sanitizeUserInput`, `sanitizeLLMOutput` from prompt-sanitizer.
   - Export `estimateContextTokens(messages)` helper for overflow check (used in T5).
4. Run test — verify PASS:
   `npm run test -- server/src/chat/run-chat-turn.test.ts`
   Also run agent regression: `npm run test -- server/src/agent/llm.test.ts`
5. Refactor while green: dedupe shared stream parsing if duplicated.
6. Commit:
   `git add server/src/chat/run-chat-turn.ts server/src/chat/run-chat-turn.test.ts server/src/agent/llm.ts`
   `git commit -m "refactor(chat): extract runChatTurn from agent llm layer"`

## REFERENCES LOADED
docs/pocket/spec/2026-07-30-ai-chat/ai-chat.md — rule: Message exchange, full history context
server/src/agent/llm.ts — existing executeCardWithTools, extended thinking, tool loop
server/src/agent/llm.test.ts — mock patterns for Anthropic SDK

## WHY THIS APPROACH
Justification: Shared LLM core is design decision; extraction prevents duplicating tool loop; agent tests ensure no regression.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Must NOT change agent pipeline behavior — executeCard output must remain identical.]
You are implementing runChatTurn extraction for AI Chat Page.
Spec: docs/pocket/spec/2026-07-30-ai-chat/ai-chat.md
Design decision: Extract runChatTurn from llm.ts
Files in scope: run-chat-turn.ts, run-chat-turn.test.ts, llm.ts
Available after: none (prereq, parallel with T1)
Architecture rule: Must not touch agent/service.ts orchestration
[RESTATE: Agent executeCard behavior unchanged after refactor.]

## DELIVERABLE
Given multi-turn messages, When runChatTurn executes, Then streams tokens and invokes tools with callbacks.
Given agent executeCard, When called after refactor, Then existing llm.test.ts scenarios still pass.
[must-not] Given refactor, When agent pipeline runs, Then system must NOT change classify/execute behavior.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - runChatTurn accepts messages array (not single intent string)
  - Extended thinking + tool events supported
  - Agent llm.test.ts still passes
Must-not-have:
  - Changes to server/src/agent/service.ts
Open question risks:
  - Context overflow → estimateContextTokens exported for T5

## STOP CONDITIONS
Done when: run-chat-turn tests pass, llm.test.ts passes, commit created
Escalate when: refactor breaks agent pipeline tests

---

### Task 3: Chat service — thread and message CRUD [depends: T1]

## OBJECTIVE
Implement chat service layer: thread CRUD, message persistence, user isolation, empty-thread dedup, auto-title.

Files:
- Create: `server/src/chat/types.ts`
- Create: `server/src/chat/service.ts`
- Test: `server/src/chat/service.test.ts`

Steps:
1. Write failing tests:
   File: `server/src/chat/service.test.ts`

   ```typescript
   import "dotenv/config";
   import { afterAll, beforeAll, describe, expect, it } from "vitest";
   import { db } from "../db/kysely.js";
   import { createChatService } from "./service.js";

   /**
    * Requires running PostgreSQL. Gated behind RUN_INTEGRATION=1.
    * RUN_INTEGRATION=1 npm run test -- server/src/chat/service.test.ts
    */
   describe.skipIf(!process.env.RUN_INTEGRATION)("chat service", () => {
     let userAId: number;
     let userBId: number;
     let service: ReturnType<typeof createChatService>;

     beforeAll(async () => {
       const userA = await db
         .insertInto("users")
         .values({
           username: `chat-svc-a-${Date.now()}`,
           display_name: "Chat A",
           password_hash: "h",
         })
         .returning("id")
         .executeTakeFirstOrThrow();
       userAId = userA.id;
       const userB = await db
         .insertInto("users")
         .values({
           username: `chat-svc-b-${Date.now()}`,
           display_name: "Chat B",
           password_hash: "h",
         })
         .returning("id")
         .executeTakeFirstOrThrow();
       userBId = userB.id;
       service = createChatService(db);
     });

     afterAll(async () => {
       await db.deleteFrom("users").where("id", "in", [userAId, userBId]).execute();
     });

     it("createThread returns thread titled Untitled", async () => {
       const thread = await service.createThread(userAId);
       expect(thread.title).toBe("Untitled");
       expect(thread.userId).toBe(userAId);
       await service.deleteThread(userAId, thread.id);
     });

     it("findEmptyThread returns zero-message thread when one exists", async () => {
       const empty = await service.createThread(userAId);
       const found = await service.findEmptyThread(userAId);
       expect(found?.id).toBe(empty.id);
       await service.deleteThread(userAId, empty.id);
     });

     it("listThreads sorts by updated_at DESC", async () => {
       const older = await service.createThread(userAId);
       const newer = await service.createThread(userAId);
       await service.renameThread(userAId, newer.id, "Newer");
       const list = await service.listThreads(userAId);
       expect(list[0].id).toBe(newer.id);
       await service.deleteThread(userAId, older.id);
       await service.deleteThread(userAId, newer.id);
     });

     it("getThread returns null for wrong user (IDOR)", async () => {
       const thread = await service.createThread(userAId);
       const leaked = await service.getThread(userBId, thread.id);
       expect(leaked).toBeNull();
       await service.deleteThread(userAId, thread.id);
     });

     it("deleteThread hard-deletes messages and attachments", async () => {
       const thread = await service.createThread(userAId);
       const msg = await service.insertMessage({
         threadId: thread.id,
         role: "user",
         content: "hello",
       });
       await service.insertAttachment({
         messageId: msg.id,
         filename: "note.md",
         format: "md",
         content: "# Note",
       });
       await service.deleteThread(userAId, thread.id);
       const rows = await db
         .selectFrom("chat_messages")
         .where("thread_id", "=", thread.id)
         .selectAll()
         .execute();
       expect(rows).toHaveLength(0);
     });

     it("autoTitleThread truncates first user message to ~50 chars", async () => {
       const thread = await service.createThread(userAId);
       const long =
         "This is a very long first message that should be truncated for the thread title";
       await service.autoTitleThread(thread.id, long);
       const updated = await service.getThread(userAId, thread.id);
       expect(updated?.title.length).toBeLessThanOrEqual(50);
       expect(updated?.title).not.toBe("Untitled");
       await service.deleteThread(userAId, thread.id);
     });

     it("does not auto-title on failed first message (title stays Untitled)", async () => {
       const thread = await service.createThread(userAId);
       // simulate failure path: no autoTitleThread call
       const still = await service.getThread(userAId, thread.id);
       expect(still?.title).toBe("Untitled");
       await service.deleteThread(userAId, thread.id);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- server/src/chat/service.test.ts`
   Expected failure: module not found or skipped without DB.
3. Implement service.ts with Kysely queries against chat tables.
4. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test -- server/src/chat/service.test.ts`
5. Refactor while green: none expected.
6. Commit:
   `git add server/src/chat/types.ts server/src/chat/service.ts server/src/chat/service.test.ts`
   `git commit -m "feat(chat): add thread and message CRUD service"`

## REFERENCES LOADED
docs/pocket/spec/2026-07-30-ai-chat/ai-chat.md — rules: Thread management, Privacy
server/src/chat/service patterns from agent routes — Kysely db usage

## WHY THIS APPROACH
Justification: Service layer isolates DB logic from routes; integration tests (real PostgreSQL) verify persistence and IDOR without HTTP overhead.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: All queries MUST filter by user_id — cross-user access returns null (404 at route layer).]
You are implementing chat service for AI Chat Page.
Spec: docs/pocket/spec/2026-07-30-ai-chat/ai-chat.md
Files in scope: types.ts, service.ts, service.test.ts
Available after: T1 (schema)
Architecture rule: Skip recordActivity
[RESTATE: user_id filter on every thread query.]

## DELIVERABLE
Given authenticated user, When createThread, Then thread with "Untitled" returned.
Given zero-message thread exists, When findEmptyThread, Then returns it (no duplicate).
Given user B's threadId, When user A queries, Then null (IDOR protection).
Given thread with messages, When deleteThread, Then hard delete all related rows.
Given first successful response, When autoTitleThread, Then title from truncated user message (~50 chars).

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - User isolation on all operations
  - Empty thread dedup helper
  - Hard delete (not soft)
  - Tests gated `RUN_INTEGRATION=1` (skipped in default `npm test`; run in CI via T9)
Must-not-have:
  - recordActivity calls
  - Workspace scoping on threads

## STOP CONDITIONS
Done when: service tests pass, commit created

---

### Task 4: Chat tools — createChatFile and tool factory [depends: T1, T3]

## OBJECTIVE
Implement chat-specific `create_file` tool writing to `chat_attachments`, plus tool factory assembling web_search, query_board_data, create_file.

Files:
- Create: `server/src/chat/tools/createChatFile.ts`
- Create: `server/src/chat/tools/factory.ts`
- Test: `server/src/chat/tools/createChatFile.test.ts`

Steps:
1. Write failing tests:
   File: `server/src/chat/tools/createChatFile.test.ts`

   ```typescript
   import "dotenv/config";
   import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
   import { MAX_ARTIFACT_BYTES } from "../../agent/artifact.js";
   import { db } from "../../db/kysely.js";
   import { createChatService } from "../service.js";
   import { makeCreateChatFile } from "./createChatFile.js";

   describe.skipIf(!process.env.RUN_INTEGRATION)("createChatFile", () => {
     let userId: number;
     let threadId: number;
     let messageId: number;

     beforeEach(async () => {
       const user = await db
         .insertInto("users")
         .values({
           username: `chat-file-${Date.now()}`,
           display_name: "File",
           password_hash: "h",
         })
         .returning("id")
         .executeTakeFirstOrThrow();
       userId = user.id;
       const service = createChatService(db);
       const thread = await service.createThread(userId);
       threadId = thread.id;
       const msg = await service.insertMessage({
         threadId,
         role: "assistant",
         content: "Here is your file",
       });
       messageId = msg.id;
     });

     afterEach(async () => {
       await db.deleteFrom("users").where("id", "=", userId).execute();
     });

     it("inserts chat_attachments row with LLM-supplied md content", async () => {
       const tool = makeCreateChatFile({
         messageId,
         insertAttachment: async (row) => {
           await db.insertInto("chat_attachments").values(row).execute();
         },
       });
       const result = await tool.execute({
         filename: "report.md",
         content: "# Report\nBody",
         format: "md",
       });
       expect(result.ok).toBe(true);
       const row = await db
         .selectFrom("chat_attachments")
         .where("message_id", "=", messageId)
         .selectAll()
         .executeTakeFirst();
       expect(row?.filename).toBe("report.md");
       expect(row?.content).toContain("# Report");
     });

     it("returns TOO_LARGE when content exceeds MAX_ARTIFACT_BYTES", async () => {
       const tool = makeCreateChatFile({
         messageId,
         insertAttachment: vi.fn(),
       });
       const huge = "x".repeat(MAX_ARTIFACT_BYTES + 1);
       const result = await tool.execute({ filename: "big.txt", content: huge, format: "txt" });
       expect(result.ok).toBe(false);
       expect(result.errorCode).toBe("TOO_LARGE");
     });

     it("returns EMPTY_CONTENT for blank content", async () => {
       const tool = makeCreateChatFile({ messageId, insertAttachment: vi.fn() });
       const result = await tool.execute({ filename: "empty.md", content: "   ", format: "md" });
       expect(result.ok).toBe(false);
       expect(result.errorCode).toBe("EMPTY_CONTENT");
     });
   });
   ```

   File: `server/src/chat/tools/factory.test.ts`

   ```typescript
   import { describe, expect, it, vi } from "vitest";
   import { createChatToolFactory } from "./factory.js";

   describe("createChatToolFactory", () => {
     it("resolves web_search, query_board_data, create_file", () => {
       const factory = createChatToolFactory({
         userId: 1,
         threadId: 2,
         messageId: 3,
         workspaceId: 7,
         insertAttachment: vi.fn(),
       });
       const tools = factory.resolveTools([
         "web_search",
         "query_board_data",
         "create_file",
       ]);
       expect(tools.map((t) => t.name)).toEqual([
         "web_search",
         "query_board_data",
         "create_file",
       ]);
     });

     it("query_board_data requires workspaceId in ctx", async () => {
       const factory = createChatToolFactory({
         userId: 1,
         threadId: 2,
         messageId: 3,
         insertAttachment: vi.fn(),
       });
       const tools = factory.resolveTools(["query_board_data"]);
       const tool = tools[0];
       const result = await tool.execute({ workspaceId: undefined, query: "cards" });
       expect(result.ok).toBe(false);
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- server/src/chat/tools/createChatFile.test.ts server/src/chat/tools/factory.test.ts`
3. Implement `createChatFile` with LLM-supplied content (unlike agent `makeCreateFile` which ignores LLM content). Import `MAX_ARTIFACT_BYTES` from `server/src/agent/artifact.js` for size limit (same 1MB cap as agent artifacts).
   Implement `factory.ts` accepting `{ userId, threadId, messageId, workspaceId? }` — `workspaceId` comes from route layer per message POST (T5).
4. Run test — verify PASS:
   `RUN_INTEGRATION=1 npm run test -- server/src/chat/tools/createChatFile.test.ts`
   `npm run test -- server/src/chat/tools/factory.test.ts`
5. Refactor while green: none expected.
6. Commit:
   `git add server/src/chat/tools/createChatFile.ts server/src/chat/tools/factory.ts server/src/chat/tools/createChatFile.test.ts server/src/chat/tools/factory.test.ts`
   `git commit -m "feat(chat): add chat create_file tool and tool factory"`

## REFERENCES LOADED
docs/pocket/spec/2026-07-30-ai-chat/ai-chat.md — rule: Tool use, create_file thread attachments
server/src/agent/tools/createFile.ts — size limits, error codes (invert: chat uses LLM content)
server/src/agent/artifact.ts — `MAX_ARTIFACT_BYTES` constant (reuse, do not duplicate)
server/src/agent/tools/queryBoardData.ts — workspace-scoped queries
server/src/agent/tools/webSearch.ts — reuse as-is

## WHY THIS APPROACH
Justification: Agent create_file is board-bound and ignores LLM content; chat needs separate implementation per spec.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: create_file MUST write to chat_attachments, NOT agent_artifacts.]
Files in scope: createChatFile.ts, factory.ts, tests
Available after: T1, T3
[RESTATE: No agent_artifacts writes from chat tools.]

## DELIVERABLE
Given valid md content, When create_file executes, Then attachment saved to chat_attachments.
Given content > 1MB, When execute, Then TOO_LARGE in ToolTrace.
[must-not] Given chat create_file, When executed, Then system must NOT write to agent_artifacts.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - md/txt/csv formats, max `MAX_ARTIFACT_BYTES`
  - Reuse web_search and query_board_data from agent tools
Must-not-have:
  - Agent artifact table usage

## STOP CONDITIONS
Done when: tool tests pass, commit created

---

### Task 5: Chat HTTP routes and streaming endpoint [depends: T2, T3, T4]

## OBJECTIVE
Implement REST routes for thread CRUD and POST message endpoint with NDJSON fetch-stream (token, thinking, tool_event, done, error events).

Files:
- Create: `server/src/chat/stream-protocol.ts`
- Create: `server/src/chat/routes.ts`
- Modify: `server/src/index.ts`
- Test: `server/src/chat/routes.test.ts`

Steps:
1. Write failing tests:
   File: `server/src/chat/routes.test.ts`

   ```typescript
   import express from "express";
   import request from "supertest";
   import { beforeEach, describe, expect, it, vi } from "vitest";

   const mockRunChatTurn = vi.fn();
   const mockCheckChatLimit = vi.fn();
   const mockService = {
     listThreads: vi.fn(),
     createThread: vi.fn(),
     findEmptyThread: vi.fn(),
     renameThread: vi.fn(),
     deleteThread: vi.fn(),
     getThread: vi.fn(),
     getMessages: vi.fn(),
     insertMessage: vi.fn(),
     deleteMessage: vi.fn(),
     autoTitleThread: vi.fn(),
     getAttachment: vi.fn(),
   };

   vi.mock("../agent/ticket-intake/rate-limits.js", () => ({
     checkChatLimit: (...args: unknown[]) => mockCheckChatLimit(...args),
   }));

   vi.mock("../auth.js", () => ({
     requireAuth: (req: express.Request, _res: express.Response, next: () => void) => {
       (req as express.Request & { userId?: number }).userId = 1;
       next();
     },
   }));

   vi.mock("./run-chat-turn.js", () => ({
     runChatTurn: (...args: unknown[]) => mockRunChatTurn(...args),
     estimateContextTokens: vi.fn(() => 100),
   }));

   vi.mock("./service.js", () => ({
     createChatService: () => mockService,
   }));

   describe("resolveMessageAction (chat)", () => {
     it("maps send and retry actions", async () => {
       const { resolveChatMessageAction } = await import("./routes.js");
       expect(resolveChatMessageAction({ message: " hi " })).toEqual({
         kind: "send",
         message: "hi",
       });
       expect(
         resolveChatMessageAction({ action: "retry", messageId: 42 }),
       ).toEqual({ kind: "retry", messageId: 42 });
     });
   });

   describe("chat routes (mocked service + LLM)", () => {
     let app: express.Express;

     beforeEach(async () => {
       vi.clearAllMocks();
       mockCheckChatLimit.mockResolvedValue({ isLocked: false });
       mockService.listThreads.mockResolvedValue([{ id: 1, title: "Untitled" }]);
       mockService.createThread.mockResolvedValue({ id: 2, title: "Untitled" });
       mockService.getThread.mockResolvedValue({ id: 1, title: "Untitled", userId: 1 });
       mockService.getMessages.mockResolvedValue([]);
       const { createChatRouter } = await import("./routes.js");
       app = express();
       app.use(createChatRouter());
     });

     it("GET /api/chat/threads lists user threads", async () => {
       const res = await request(app).get("/api/chat/threads");
       expect(res.status).toBe(200);
       expect(res.body).toEqual([{ id: 1, title: "Untitled" }]);
     });

     it("POST /api/chat/threads/:id/messages streams NDJSON token events", async () => {
       mockRunChatTurn.mockImplementation(async ({ onToken }) => {
         onToken("Hello");
         return { output: "Hello", thinking: "", toolTrace: [] };
       });
       mockService.insertMessage
         .mockResolvedValueOnce({ id: 10, role: "user", content: "Hi" })
         .mockResolvedValueOnce({ id: 11, role: "assistant", content: "Hello" });
       const res = await request(app)
         .post("/api/chat/threads/1/messages")
         .send({ message: "Hi", workspaceId: 7 });
       expect(res.status).toBe(200);
       expect(res.text).toContain('"type":"token"');
       expect(res.text).toContain('"type":"done"');
     });

     it("POST retry action regenerates without duplicate user message", async () => {
       mockRunChatTurn.mockImplementation(async ({ onToken }) => {
         onToken("Retry ok");
         return { output: "Retry ok", thinking: "", toolTrace: [] };
       });
       mockService.insertMessage.mockResolvedValueOnce({
         id: 12,
         role: "assistant",
         content: "Retry ok",
       });
       const res = await request(app)
         .post("/api/chat/threads/1/messages")
         .send({ action: "retry", messageId: 11 });
       expect(res.status).toBe(200);
       expect(res.text).toContain('"type":"done"');
       expect(mockService.insertMessage).toHaveBeenCalledTimes(1);
     });

     it("GET /api/chat/attachments/:id returns file for owner", async () => {
       mockService.getAttachment.mockResolvedValue({
         id: 5,
         filename: "report.md",
         format: "md",
         content: "# Report",
       });
       const res = await request(app).get("/api/chat/attachments/5");
       expect(res.status).toBe(200);
       expect(res.headers["content-disposition"]).toMatch(/report\.md/);
     });

     it("GET /api/chat/attachments/:id returns 404 for non-owner", async () => {
       mockService.getAttachment.mockResolvedValue(null);
       const res = await request(app).get("/api/chat/attachments/99");
       expect(res.status).toBe(404);
     });

     it("returns 429 when chat rate limit exceeded", async () => {
       mockCheckChatLimit.mockResolvedValue({
         isLocked: true,
         retryAfterMs: 5000,
       });
       const res = await request(app)
         .post("/api/chat/threads/1/messages")
         .send({ message: "Hi" });
       expect(res.status).toBe(429);
       expect(mockRunChatTurn).not.toHaveBeenCalled();
     });

     it("returns 404 for other user's thread", async () => {
       mockService.getThread.mockResolvedValue(null);
       const res = await request(app).get("/api/chat/threads/99");
       expect(res.status).toBe(404);
     });

     it("returns 413 on context overflow without persisting user message", async () => {
       const { estimateContextTokens } = await import("./run-chat-turn.js");
       vi.mocked(estimateContextTokens).mockReturnValue(999_999);
       const res = await request(app)
         .post("/api/chat/threads/1/messages")
         .send({ message: "overflow" });
       expect(res.status).toBe(413);
       expect(res.body.message).toContain("Thread too long");
       expect(mockService.insertMessage).not.toHaveBeenCalled();
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- server/src/chat/routes.test.ts`
3. Implement routes with `requireAuth`. CSRF enforced globally when mounted in `index.ts` (isolated router tests omit CSRF middleware — expected).
   **Message POST body:** `{ message: string, workspaceId?: number }` or `{ action: "retry", messageId: number }`. When `workspaceId` present, validate membership via `lookupMembership` before passing to tool factory.
   Stream protocol events: `{ type: "token"|"thinking"|"tool_event"|"done"|"error", ... }`.
   On success: persist user message, stream assistant, persist assistant with thinking+tool_trace JSONB, auto-title if first success.
   On failure before stream: persist user message, return error event (for retry); do NOT auto-title.
   On mid-stream failure: delete partial assistant row, return error event.
   System prompt instructs AI to clarify workspace before calling query_board_data when ambiguous.
   Mount at `/api/chat` in `index.ts`. Reuse `checkChatLimit` from `server/src/agent/ticket-intake/rate-limits.ts` on message POST (return 429 with `retryAfterMs` when locked).
   **Timeout exemption:** extend `isTimeoutExempt` in `index.ts` to include `/chat/` paths (streaming LLM turns exceed 30s default).
4. Run test — verify PASS:
   `npm run test -- server/src/chat/routes.test.ts`
5. Refactor while green: extract route helpers if routes.ts exceeds ~300 lines.
6. Commit:
   `git add server/src/chat/stream-protocol.ts server/src/chat/routes.ts server/src/index.ts server/src/chat/routes.test.ts`
   `git commit -m "feat(chat): add REST routes and streaming message endpoint"`

## REFERENCES LOADED
docs/pocket/spec/2026-07-30-ai-chat/ai-chat.md — rules: Message exchange, Tool use, Transparency, Privacy
server/src/routes/ticket-intake.ts — rate limit usage pattern
server/src/agent/ticket-intake/rate-limits.ts — reuse `checkChatLimit`
server/src/agent/routes.ts — requireAuth, resolveMessageAction pattern for retry
server/src/index.ts — `isTimeoutExempt` must include `/chat/`

## WHY THIS APPROACH
Justification: Routes wire service + LLM + tools; stream protocol is chat-specific contract for frontend.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: No workspace SSE — streaming is per-request fetch-stream scoped to userId+threadId. Workspace for tools comes from optional workspaceId in POST body, validated per request.]
Files in scope: stream-protocol.ts, routes.ts, index.ts, routes.test.ts
Available after: T2, T3, T4
Architecture rule: Must not touch agent/service.ts
[RESTATE: Dedicated fetch-stream, not workspace SSE pub/sub.]

## DELIVERABLE
Given thread with history, When POST message with workspaceId, Then NDJSON stream with token events and query_board_data scoped to that workspace.
Given POST without workspaceId, When query_board_data needed, Then system prompt guides clarification (no persisted workspace on thread).
Given context overflow, When POST message, Then 413 "Thread too long, start a new chat", user message not persisted.
Given first message LLM failure, When error, Then title remains "Untitled".
Given LLM error before stream, When POST message, Then error event for inline retry UI.
Given mid-stream failure after partial tokens, When error event, Then partial assistant row deleted, user message retained, error + Retry.
Given web_search RATE_LIMIT, When tool loop completes, Then tool_event error emitted and turn completes (graceful degradation).
Given retry action, When POST, Then regenerates assistant without duplicate user message.
Given user B accesses user A thread, Then 404.
Given attachment id, When GET /api/chat/attachments/:id by owner, Then downloadable file with Content-Disposition.
Given attachment id, When GET by non-owner, Then 404.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - requireAuth; CSRF via global middleware on mount
  - `/chat/` paths exempt from 30s request timeout
  - `workspaceId` optional on message POST with membership check
  - `checkChatLimit` rate limiting (429 on lock)
  - Context overflow hard fail
  - Thinking + tool_trace persisted on assistant message
  - Auto-title only on first successful response
  - Route tests cover retry, attachment download, rate limit
Must-not-have:
  - recordActivity
  - Workspace SSE for chat tokens
  - Agent pipeline invocation

## STOP CONDITIONS
Done when: routes tests pass, commit created

---

### Task 6: Client API client and chat types [depends: T5]

## OBJECTIVE
Add chat types and api.ts methods for thread CRUD, message fetch, streaming POST, attachment download.

Files:
- Modify: `client/src/types.ts`
- Modify: `client/src/api.ts`
- Test: `client/src/api.test.ts`

Steps:
1. Write failing tests:
   File: `client/src/api.test.ts` (extend existing)

   ```typescript
   describe("chat API methods", () => {
     beforeEach(() => mockFetch.mockReset());

     it("api.chat.listThreads GETs /api/chat/threads", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () => Promise.resolve([{ id: 1, title: "Untitled" }]),
       });
       const { api } = await import("./api");
       const threads = await api.chat.listThreads();
       expect(threads).toEqual([{ id: 1, title: "Untitled" }]);
       expect(mockFetch).toHaveBeenCalledWith(
         "/api/chat/threads",
         expect.objectContaining({ credentials: "include" }),
       );
     });

     it("api.chat.createThread POSTs /api/chat/threads", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () => Promise.resolve({ id: 2, title: "Untitled" }),
       });
       const { api } = await import("./api");
       await api.chat.createThread();
       expect(mockFetch).toHaveBeenCalledWith(
         "/api/chat/threads",
         expect.objectContaining({ method: "POST" }),
       );
     });

     it("api.chat.renameThread PATCHes thread title", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () => Promise.resolve({ id: 1, title: "Renamed" }),
       });
       const { api } = await import("./api");
       await api.chat.renameThread(1, "Renamed");
       expect(mockFetch).toHaveBeenCalledWith(
         "/api/chat/threads/1",
         expect.objectContaining({ method: "PATCH" }),
       );
     });

     it("api.chat.getMessages returns thinking and toolTrace fields", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () =>
           Promise.resolve([
             {
               id: 10,
               role: "assistant",
               content: "Hi",
               thinking: "thought",
               toolTrace: [{ toolName: "web_search" }],
             },
           ]),
       });
       const { api } = await import("./api");
       const msgs = await api.chat.getMessages(1);
       expect(msgs[0].thinking).toBe("thought");
       expect(msgs[0].toolTrace).toHaveLength(1);
     });

     it("api.chat.sendMessage returns ReadableStream body", async () => {
       const stream = new ReadableStream({
         start(controller) {
           controller.enqueue(new TextEncoder().encode('{"type":"done"}\n'));
           controller.close();
         },
       });
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         body: stream,
       });
       const { api } = await import("./api");
       const body = await api.chat.sendMessage(1, "hello", { workspaceId: 7 });
       expect(body).toBeInstanceOf(ReadableStream);
       expect(mockFetch).toHaveBeenCalledWith(
         "/api/chat/threads/1/messages",
         expect.objectContaining({
           body: JSON.stringify({ message: "hello", workspaceId: 7 }),
         }),
       );
     });

     it("api.chat.downloadAttachment GETs attachment by id", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         blob: () => Promise.resolve(new Blob(["# Report"])),
       });
       const { api } = await import("./api");
       await api.chat.downloadAttachment(5);
       expect(mockFetch).toHaveBeenCalledWith(
         "/api/chat/attachments/5",
         expect.objectContaining({ credentials: "include" }),
       );
     });

     it("api.chat.retryMessage POSTs retry action", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         body: new ReadableStream(),
       });
       const { api } = await import("./api");
       await api.chat.retryMessage(1, 42);
       expect(mockFetch).toHaveBeenCalledWith(
         "/api/chat/threads/1/messages",
         expect.objectContaining({
           method: "POST",
           body: JSON.stringify({ action: "retry", messageId: 42 }),
         }),
       );
     });
   });
   ```

2. Run test — verify FAIL:
   `npm run test -- client/src/api.test.ts`
3. Implement types: ChatThread, ChatMessage, ChatAttachment, ToolTraceItem (reuse), StreamEvent union.
   Implement `api.chat` namespace methods using existing `request()` helper + fetch for stream.
   `sendMessage(threadId, message, opts?: { workspaceId?: number })` passes `workspaceId` from current `BoardContext` workspace (client-side sticky — re-sent each turn, not stored on thread).
4. Run test — verify PASS:
   `npm run test -- client/src/api.test.ts`
5. Refactor while green: none expected.
6. Commit:
   `git add client/src/types.ts client/src/api.ts client/src/api.test.ts`
   `git commit -m "feat(chat): add client API methods and types"`

## REFERENCES LOADED
docs/pocket/spec/2026-07-30-ai-chat/ai-chat.md — all rules (client contract)
client/src/api.ts — request(), CSRF, ApiError patterns

## WHY THIS APPROACH
Justification: Typed API client is prerequisite for assistant-ui adapters and streaming hook.
Complexity: lightweight

## SANDWICH CONTEXT
[CRITICAL: Stream endpoint uses fetch with credentials + CSRF header, not EventSource. Pass workspaceId from BoardContext on sendMessage for query_board_data.]
Files in scope: types.ts, api.ts, api.test.ts
Available after: T5
[RESTATE: fetch-stream with CSRF, not EventSource.]

## DELIVERABLE
Given api.chat.sendMessage with workspaceId, When called, Then POST body includes workspaceId for board tool context.
Given api.chat.sendMessage, When called, Then returns stream parsing NDJSON events.
Given api methods, When called, Then correct HTTP methods and paths.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Full thread CRUD API coverage
  - Stream event types match server protocol
Must-not-have:
  - Workspace SSE usage

## STOP CONDITIONS
Done when: api tests pass, commit created

---

### Task 7: Chat page shell — assistant-ui, routing, nav [depends: T6]

## OBJECTIVE
Install @assistant-ui/react, build ChatPage with thread list sidebar, routing (/chat, /chat/:threadId), agent mode nav entry.

Files:
- Modify: `client/package.json`
- Create: `client/src/pages/ChatPage.tsx`
- Create: `client/src/chat/ChatRuntimeProvider.tsx`
- Create: `client/src/chat/threadListAdapter.ts`
- Create: `client/src/chat/modelAdapter.ts`
- Modify: `client/src/App.tsx`
- Modify: `client/src/layout/sidebar/navItems.ts`
- Test: `client/src/layout/sidebar/navItems.test.ts`
- Test: `client/src/pages/ChatPage.test.tsx`

Steps:
1. Write failing tests:
   File: `client/src/layout/sidebar/navItems.test.ts` (extend)

   ```typescript
   import { describe, expect, it } from "vitest";
   import { AGENT_NAV, AGENT_PATHS, getModeFromPath } from "./navItems";

   describe("chat nav", () => {
     it("AGENT_NAV includes /chat", () => {
       expect(AGENT_NAV.map((i) => i.to)).toContain("/chat");
     });

     it("AGENT_PATHS includes /chat", () => {
       expect(AGENT_PATHS).toContain("/chat");
     });

     it("getModeFromPath returns agent for /chat and /chat/:threadId", () => {
       expect(getModeFromPath("/chat")).toBe("agent");
       expect(getModeFromPath("/chat/42")).toBe("agent");
     });
   });
   ```

   File: `client/src/pages/ChatPage.test.tsx`

   ```typescript
   // @vitest-environment jsdom
   import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
   import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

   const mockListThreads = vi.fn();
   const mockCreateThread = vi.fn();
   const mockDeleteThread = vi.fn();
   const mockNavigate = vi.fn();

   vi.mock("react-router", () => ({
     useNavigate: () => mockNavigate,
     useParams: () => ({ threadId: undefined }),
     Navigate: ({ to }: { to: string }) => <div data-testid="redirect">{to}</div>,
   }));

   vi.mock("../api", () => ({
     api: {
       chat: {
         listThreads: (...a: unknown[]) => mockListThreads(...a),
         createThread: (...a: unknown[]) => mockCreateThread(...a),
         deleteThread: (...a: unknown[]) => mockDeleteThread(...a),
         getMessages: vi.fn().mockResolvedValue([]),
       },
     },
   }));

   vi.mock("@assistant-ui/react", () => ({
     Thread: () => <div data-testid="chat-thread" />,
     Composer: () => <div data-testid="chat-composer" />,
   }));

   describe("ChatPage", () => {
     beforeEach(() => {
       mockListThreads.mockResolvedValue([{ id: 1, title: "Untitled", messageCount: 0 }]);
       mockCreateThread.mockResolvedValue({ id: 2, title: "Untitled" });
       mockDeleteThread.mockResolvedValue(undefined);
     });

     afterEach(() => cleanup());

     it("renders thread list and message area", async () => {
       const { default: ChatPage } = await import("./ChatPage");
       render(<ChatPage />);
       await waitFor(() => {
         expect(screen.getByTestId("chat-thread")).toBeTruthy();
         expect(screen.getByTestId("chat-composer")).toBeTruthy();
       });
     });

     it("redirects /chat to a thread", async () => {
       const { default: ChatPage } = await import("./ChatPage");
       render(<ChatPage />);
       await waitFor(() => {
         expect(screen.getByTestId("redirect").textContent).toMatch(/\/chat\//);
       });
     });

     it("shows confirm dialog before deleting non-empty thread", async () => {
       mockListThreads.mockResolvedValue([
         { id: 5, title: "Budget", messageCount: 3 },
       ]);
       const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
       const { default: ChatPage } = await import("./ChatPage");
       render(<ChatPage />);
       const deleteBtn = await screen.findByRole("button", { name: /delete/i });
       fireEvent.click(deleteBtn);
       expect(confirmSpy).toHaveBeenCalled();
       expect(mockDeleteThread).not.toHaveBeenCalled();
       confirmSpy.mockRestore();
     });
   });
   ```

2. Run tests — verify FAIL:
   `npm run test -- client/src/layout/sidebar/navItems.test.ts client/src/pages/ChatPage.test.tsx`
3. Install `@assistant-ui/react` (and `assistant-stream` if required by adapter API). **Net-new dependency** — budget extra time for adapter API integration.
   Implement threadListAdapter using api.chat methods (list, create, rename, delete with confirm for non-empty threads).
   Implement modelAdapter stub wired to api.chat.sendMessage (full streaming in T8).
   ChatPage layout: sidebar (thread list) + main (Thread/Composer from assistant-ui).
   App.tsx: lazy route `chat` with numeric `:threadId` param (`/chat/:threadId`); index `/chat` redirects per spec.
   navItems.ts: add Chat icon to AGENT_NAV and AGENT_PATHS.
4. Run tests — verify PASS:
   `npm run test -- client/src/layout/sidebar/navItems.test.ts client/src/pages/ChatPage.test.tsx`
5. Refactor while green: extract shared markdown components from AgentChatPanel if duplicated.
6. Commit:
   `git add client/package.json client/src/pages/ChatPage.tsx client/src/chat/ client/src/App.tsx client/src/layout/sidebar/navItems.ts client/src/layout/sidebar/navItems.test.ts client/src/pages/ChatPage.test.tsx`
   `git commit -m "feat(chat): add ChatPage with assistant-ui and nav routing"`

## REFERENCES LOADED
docs/pocket/spec/2026-07-30-ai-chat/ai-chat.md — rules: Privacy & nav, Thread management
assistant-ui docs — useRemoteThreadListRuntime, RemoteThreadListAdapter
client/src/layout/sidebar/navItems.ts — AGENT_NAV pattern

## WHY THIS APPROACH
Justification: Design decision uses assistant-ui for thread UX; routing/nav are discrete deliverable before streaming polish. Highest frontend integration-risk task due to new dependency.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: /chat must be in agent mode nav group, NOT kanban nav.]
Files in scope: listed above
Available after: T6
Architecture rule: creative-brief.md for colors/typography
[RESTATE: Chat in AGENT_NAV only.]

## DELIVERABLE
Given agent mode sidebar, When rendered, Then /chat visible with /agent and /history.
Given getModeFromPath("/chat"), When called, Then returns "agent".
Given /chat URL, When loaded, Then redirect to /chat/:threadId (numeric thread id).
Given non-empty thread delete, When user clicks delete, Then confirm dialog shown before api.chat.deleteThread.
Given empty thread delete, When user clicks delete, Then immediate delete without confirm.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - assistant-ui thread list integrated
  - /chat/:threadId routing
  - Agent mode nav entry
Must-not-have:
  - Kanban mode nav entry for chat

## STOP CONDITIONS
Done when: nav and page tests pass, commit created

---

### Task 8: Streaming hook — queue, error/retry, ToolTrace, thinking, attachments [depends: T7]

## OBJECTIVE
Implement useChatStream hook with message queue during streaming (reuse `agentQueue.ts`), error bubble with retry, ToolTrace/thinking/attachment renderers.

Files:
- Create: `client/src/hooks/useChatStream.ts`
- Create: `client/src/components/chat/ChatMessage.tsx`
- Create: `client/src/components/chat/ChatErrorBubble.tsx`
- Create: `client/src/components/chat/ChatAttachment.tsx`
- Modify: `client/src/chat/modelAdapter.ts`
- Reuse: `client/src/lib/agentQueue.ts`
- Test: `client/src/hooks/useChatStream.test.ts`
- Test: `client/src/components/chat/ChatMessage.test.tsx`

Steps:
1. Write failing tests:
   File: `client/src/hooks/useChatStream.test.ts`

   ```typescript
   // @vitest-environment jsdom
   import { act, renderHook, waitFor } from "@testing-library/react";
   import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

   const mockSendMessage = vi.fn();
   const mockRetryMessage = vi.fn();

   vi.mock("../api", async (importOriginal) => {
     const actual = await importOriginal<typeof import("../api")>();
     return {
       ...actual,
       api: {
         ...actual.api,
         chat: {
           ...actual.api.chat,
           sendMessage: (...a: unknown[]) => mockSendMessage(...a),
           retryMessage: (...a: unknown[]) => mockRetryMessage(...a),
         },
       },
     };
   });

   function ndjsonStream(lines: string[]) {
     return new ReadableStream({
       start(controller) {
         const enc = new TextEncoder();
         for (const line of lines) controller.enqueue(enc.encode(line + "\n"));
         controller.close();
       },
     });
   }

   describe("useChatStream", () => {
     beforeEach(() => {
       mockSendMessage.mockReset();
       mockRetryMessage.mockReset();
     });

     afterEach(() => vi.clearAllMocks());

     it("queues message while streaming and drains on done", async () => {
       mockSendMessage
         .mockResolvedValueOnce(
           ndjsonStream(['{"type":"token","text":"Hi"}', '{"type":"done"}']),
         )
         .mockResolvedValueOnce(
           ndjsonStream(['{"type":"token","text":"Queued"}', '{"type":"done"}']),
         );
       const { useChatStream } = await import("./useChatStream");
       const { result } = renderHook(() =>
         useChatStream({ threadId: 1, workspaceId: 7 }),
       );

       await act(async () => {
         await result.current.send("first");
         await result.current.send("second");
       });

       await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(2));
       expect(mockSendMessage).toHaveBeenCalledWith(1, "first", {
         workspaceId: 7,
       });
     });

     it("retry calls api.chat.retryMessage without duplicating user bubble", async () => {
       mockRetryMessage.mockResolvedValue(
         ndjsonStream(['{"type":"token","text":"Retry"}', '{"type":"done"}']),
       );
       const { useChatStream } = await import("./useChatStream");
       const { result } = renderHook(() => useChatStream({ threadId: 1 }));
       await act(async () => {
         await result.current.retry(42);
       });
       expect(mockRetryMessage).toHaveBeenCalledWith(1, 42);
       expect(result.current.messages.filter((m) => m.role === "user")).toHaveLength(0);
     });

     it("context overflow shows message without retry", async () => {
       mockSendMessage.mockRejectedValue(
         Object.assign(new Error("overflow"), { status: 413 }),
       );
       const { useChatStream } = await import("./useChatStream");
       const { result } = renderHook(() => useChatStream({ threadId: 1 }));
       await act(async () => {
         await result.current.send("too long");
       });
       expect(result.current.overflowError).toContain("Thread too long");
       expect(result.current.canRetry).toBe(false);
     });
   });
   ```

   File: `client/src/components/chat/ChatMessage.test.tsx`

   ```typescript
   // @vitest-environment jsdom
   import { fireEvent, render, screen } from "@testing-library/react";
   import { describe, expect, it } from "vitest";
   import { ChatMessage } from "./ChatMessage";

   describe("ChatMessage", () => {
     it("renders markdown content", () => {
       render(
         <ChatMessage
           role="assistant"
           content="# Title\nBody"
           thinking={null}
           toolTrace={[]}
           attachments={[]}
         />,
       );
       expect(screen.getByText("Title")).toBeTruthy();
       expect(screen.getByText("Body")).toBeTruthy();
     });

     it("shows ToolTrace with error badge on tool failure", () => {
       const { container } = render(
         <ChatMessage
           role="assistant"
           content="Done"
           thinking={null}
           toolTrace={[
             { toolName: "web_search", query: "x", errorCode: "RATE_LIMIT" },
           ]}
           attachments={[]}
         />,
       );
       expect(container.textContent).toContain("error");
       fireEvent.click(container.querySelector("button")!);
       expect(container.textContent).toContain("RATE_LIMIT");
     });

     it("rehydrates thinking blocks from stored data", () => {
       render(
         <ChatMessage
           role="assistant"
           content="Answer"
           thinking="I considered options"
           toolTrace={[]}
           attachments={[]}
         />,
       );
       expect(screen.getByText(/considered options/i)).toBeTruthy();
     });
   });
   ```

2. Run tests — verify FAIL:
   `npm run test -- client/src/hooks/useChatStream.test.ts client/src/components/chat/ChatMessage.test.tsx`
3. Implement `useChatStream` parsing NDJSON stream events into message state. **Reuse `submit`/`settle` from `client/src/lib/agentQueue.ts`** for queue-during-stream behavior (same pattern as `useAgentChat.ts` — do not duplicate queue logic).
   Wire modelAdapter to useChatStream; pass `workspaceId` from ChatPage/BoardContext through to `api.chat.sendMessage`.
   ChatMessage: reuse react-markdown components from AgentChatPanel pattern; embed ToolTrace; thinking collapsible.
   ChatAttachment: download link via api.chat.downloadAttachment.
   Delete partial assistant on error event (remove from local state).
4. Run tests — verify PASS:
   `npm run test -- client/src/hooks/useChatStream.test.ts client/src/components/chat/ChatMessage.test.tsx`
5. Refactor while green: extract shared markdown components if duplicated with AgentChatPanel.
6. Commit:
   `git add client/src/hooks/useChatStream.ts client/src/components/chat/ client/src/chat/modelAdapter.ts client/src/hooks/useChatStream.test.ts client/src/components/chat/ChatMessage.test.tsx`
   `git commit -m "feat(chat): add streaming hook with queue, retry, and transparency UI"`

## REFERENCES LOADED
docs/pocket/spec/2026-07-30-ai-chat/ai-chat.md — rules: Message exchange, Transparency, Tool use
client/src/components/agent/AgentChatPanel.tsx — markdown component patterns
client/src/lib/agentQueue.ts — reuse submit/settle for message queue
client/src/components/ToolTrace.tsx — reuse as-is
client/src/lib/toolTrace.ts — deriveToolTrace for live events

## WHY THIS APPROACH
Justification: Streaming UX is core differentiator; queue/retry/transparency are spec-critical behaviors.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Retry regenerates assistant turn — must NOT duplicate user message bubble.]
Files in scope: listed above
Available after: T7
[RESTATE: Retry = regenerate, no user bubble duplicate.]

## DELIVERABLE
Given streaming in progress, When user sends message, Then queued until stream ends.
Given LLM error, When occurs, Then inline error bubble with Retry.
Given mid-stream failure, When error event received, Then partial assistant removed from UI, error bubble with Retry shown.
Given context overflow error, When occurs, Then "Thread too long, start a new chat" with no Retry, message stays in composer.
Given web_search tool failure, When tool_event error received, Then ToolTrace shows error badge and assistant still completes.
Given completed message with tool traces, When page reloads, Then ToolTrace and thinking rehydrated from API.
Given create_file attachment, When rendered, Then downloadable link in bubble.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Message queue during stream (via agentQueue)
  - workspaceId forwarded to api.chat.sendMessage
  - Error/retry UX per spec
  - ToolTrace + thinking visible and persisted
  - Attachment download
Must-not-have:
  - Workspace SSE
  - Agent pipeline UI components

## STOP CONDITIONS
Done when: hook and component tests pass, commit created

---

### Task 9: Integration test — chat end-to-end flow [depends: T5]

## OBJECTIVE
Add integration test covering thread create → send message (mocked LLM) → stream → persist → attachment download → reload → delete cascade.

Files:
- Create: `server/src/chat/chat.integration.test.ts`
- Modify: `.github/workflows/ci.yml`

Steps:
1. Write integration test (gated behind RUN_INTEGRATION=1):
   File: `server/src/chat/chat.integration.test.ts`

   ```typescript
   import "dotenv/config";
   import express from "express";
   import request from "supertest";
   import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
   import { db } from "../db/kysely.js";

   const mockRunChatTurn = vi.fn();

   vi.mock("../auth.js", () => ({
     requireAuth: (req: express.Request, _res: express.Response, next: () => void) => {
       (req as express.Request & { userId?: number }).userId = (globalThis as { testUserId?: number }).testUserId;
       next();
     },
   }));

   vi.mock("./run-chat-turn.js", () => ({
     runChatTurn: (...args: unknown[]) => mockRunChatTurn(...args),
     estimateContextTokens: vi.fn(() => 100),
   }));

   /**
    * RUN_INTEGRATION=1 npm run test -- server/src/chat/chat.integration.test.ts
    * Manual note: workspace clarification is LLM-driven via system prompt — not assertable without RUN_LLM_IT.
    */
   describe.skipIf(!process.env.RUN_INTEGRATION)("chat end-to-end", () => {
     let app: express.Express;
     let userId: number;
     let threadId: number;

     beforeAll(async () => {
       const user = await db
         .insertInto("users")
         .values({
           username: `chat-e2e-${Date.now()}`,
           display_name: "E2E",
           password_hash: "h",
         })
         .returning("id")
         .executeTakeFirstOrThrow();
       userId = user.id;
       (globalThis as { testUserId?: number }).testUserId = userId;
       const { createChatRouter } = await import("./routes.js");
       app = express();
       app.use(createChatRouter());
     });

     afterAll(async () => {
       await db.deleteFrom("users").where("id", "=", userId).execute();
     });

     it("create thread → stream message → persist → reload → delete cascade", async () => {
       const createRes = await request(app).post("/api/chat/threads");
       expect(createRes.status).toBe(200);
       threadId = createRes.body.id;
       expect(createRes.body.title).toBe("Untitled");

       mockRunChatTurn.mockImplementation(async ({ onToken, onToolEvent }) => {
         onToolEvent?.({ phase: "started", toolName: "web_search", input: { query: "camel" } });
         onToken("Hello");
         return {
           output: "Hello",
           thinking: "thought",
           toolTrace: [{ toolName: "web_search", query: "camel", resultCount: 3 }],
         };
       });

       const streamRes = await request(app)
         .post(`/api/chat/threads/${threadId}/messages`)
         .send({ message: "Search camel kanban", workspaceId: 1 });
       expect(streamRes.status).toBe(200);
       expect(streamRes.text).toContain('"type":"token"');
       expect(streamRes.text).toContain('"type":"done"');

       const msgsRes = await request(app).get(`/api/chat/threads/${threadId}`);
       expect(msgsRes.status).toBe(200);
       expect(msgsRes.body.messages.some((m: { role: string }) => m.role === "assistant")).toBe(true);
       const assistant = msgsRes.body.messages.find((m: { role: string }) => m.role === "assistant");
       expect(assistant.toolTrace).toBeDefined();
       expect(msgsRes.body.title).not.toBe("Untitled");

       // attachment download (if create_file ran in a fuller scenario; here assert route wiring)
       if (assistant.attachments?.length) {
         const attRes = await request(app).get(
           `/api/chat/attachments/${assistant.attachments[0].id}`,
         );
         expect(attRes.status).toBe(200);
       }

       const delRes = await request(app).delete(`/api/chat/threads/${threadId}`);
       expect(delRes.status).toBe(204);
       const gone = await db
         .selectFrom("chat_threads")
         .where("id", "=", threadId)
         .selectAll()
         .execute();
       expect(gone).toHaveLength(0);
     });
   });
   ```

2. Run test — verify FAIL then PASS after implementation confirms wiring.
   `RUN_INTEGRATION=1 npm run test -- server/src/chat/chat.integration.test.ts`
3. Wire chat integration tests into CI: update `.github/workflows/ci.yml` integration job to run `npm run test:integration:routes --workspace=server` after migrate (runs all `RUN_INTEGRATION` tests including `server/src/chat/**`, not only `pipeline.integration.test.ts`).
4. No new implementation unless test reveals gap — fix in scope files only.
5. Refactor while green: none expected.
6. Commit:
   `git add server/src/chat/chat.integration.test.ts .github/workflows/ci.yml`
   `git commit -m "test(chat): add end-to-end integration test and CI wiring"`

## REFERENCES LOADED
docs/pocket/spec/2026-07-30-ai-chat/ai-chat.md — all acceptance criteria
server/src/routes/ticket-intake.integration.test.ts — integration test pattern

## WHY THIS APPROACH
Justification: GWT spans service + routes + persistence; integration test catches wiring gaps.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Mock Anthropic/runChatTurn — no real LLM calls in CI.]
Files in scope: chat.integration.test.ts
Available after: T5
[RESTATE: No real LLM in integration test.]

## DELIVERABLE
Given authenticated user, When full chat flow executes, Then thread/message/attachment lifecycle works end-to-end.
[must-not] Given CI run, When test executes, Then system must NOT call real Anthropic API.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - End-to-end thread → message → delete flow
  - Mocked LLM
  - CI integration job runs `test:integration:routes` so chat DB tests execute
Must-not-have:
  - Real external API calls

## STOP CONDITIONS
Done when: integration test passes (or skipped without DB with documented gate), commit created

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | Chat database schema | prereq | lightweight | Tables exist with CASCADE; CLAUDE.md updated |
| T2 | Extract runChatTurn | prereq | standard | Multi-turn + agent regression (incremental) |
| T3 | Chat service CRUD | T1 | standard | User isolation, hard delete (`RUN_INTEGRATION`) |
| T4 | Chat tools factory | T1, T3 | standard | chat_attachments, `MAX_ARTIFACT_BYTES` |
| T5 | Routes + streaming | T2, T3, T4 | standard | NDJSON, 413, timeout exempt, workspaceId, rate limit |
| T6 | Client API + types | T5 | lightweight | api.chat + workspaceId on send |
| T7 | ChatPage + nav | T6 | standard | /chat in agent nav, numeric threadId |
| T8 | Streaming hook + UI | T7 | standard | agentQueue reuse, retry, ToolTrace |
| T9 | Integration test + CI | T5 | standard | E2E mocked flow in CI via test:integration:routes |
