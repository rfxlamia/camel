# EXECUTION PLAN — Agentic Kanban Phase 1

**Date:** 2026-06-14
**Spec:** docs/pocket/spec/2026-06-14-agentic-kanban-phase1/agent-board-phase1.md
**Status:** reviewed → validated (2026-06-14)
**Total tasks:** 6

> **Validation revisions applied** (see `validation-report.md`). Fixed 4 blockers +
> 4 warnings + info: (C1) replaced the tautological GET /board test with a real
> query-contract test via an extracted `getHumanColumns`; (C2) added `slug/reasoning/
> system_prompt` columns so agent-column metadata has storage; (C3) execution now
> loads `original_intent` from the board instead of running on `""`; (C4) wired
> agent.* SSE consumption through BoardContext (`agentEvents`) — there is no
> SSEContext/useSSE; (W1) added template placeholder substitution; (W2) made
> migrate.ts apply agent-schema.sql; (W3) extracted a tested `lib/agentQueue.ts`
> reducer; (W4) corrected client context fields to `activeWorkspaceId`/`showToast`.

---

## Test-Architect Summary

| Metric | Value |
|--------|-------|
| Tasks enriched | 6 (T1–T6 — test code filled into every Step 1) |
| Integration test tasks added | 0 (cross-unit interactions already covered by DI mocks in T3 service tests) |
| TDD order corrections | 0 (all 6 tasks already followed correct TDD order) |
| Test framework | vitest (both server and client) |
| Coverage areas | Server: service layer (DI mocks via `createAgentBoardService`), template structure, board isolation, route contract. Client: API functions (fetch mock via `vi.stubGlobal`), component render (`@testing-library/react` if available) |
| Patterns followed | Server: DI pattern from `workspaceAccess.test.ts`. Client: fetch mock pattern from `api.test.ts` |

**Notes:**
- T1 test uses the `createScopedBoardService` mock pattern from existing codebase
- T3 tests use a new `createAgentBoardService` DI pattern (mirrors existing `createScopedBoardService`)
- T4 tests use `vi.stubGlobal("fetch", mockFetch)` from existing `api.test.ts`
- T5 render tests depend on `@testing-library/react` availability — fallback: skip + note in `DONE_WITH_CONCERNS`
- T6 tests follow same client mock pattern as T4
- No separate integration test tasks needed — T3 service tests already cover DB + LLM + realtime interaction via dependency injection

---

## Execution Overview

### Recommended Order
```
(T1, T2 parallel) → T3 → T4 → (T5, T6 parallel)
```

> Dependency order above is **recommended** — pocket skill enforces actual parallelism and sequencing.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T1, T2 | — (both prereqs) |
| Group B | T5, T6 | T4 completes |

### Constraints Reminder
**Architecture:**
- `@anthropic-ai/sdk` server-side only — never imported in client
- `columns.board_id IS NULL` filter on GET /board — CRITICAL, must be atomic with T1 schema
- Agent events use `agent_card_outputs` — NEVER write to `card_events`
- `core/position.ts`, `core/wip.ts`, `core/metrics.ts` — untouched
- All data workspace-scoped, `requireAuth` on all endpoints

**Out-of-scope:** worker execution beyond first card, cross-card handoff, QA execution, Approval Gate 2, re-run, template marketplace

**Assumptions at risk:**
- SSE reconnect on return during execution (medium risk — load from DB as fallback)
- Chat input disabled after approval (low risk — UX assumption)

**Sequencing:** Dependency order is recommended — pocket enforces actual blocking rules.

### File Structure Map

```
Rule: Board Generation
  Create: server/src/db/agent-schema.sql           (created by: T1)
  Create: server/src/agent/templates.ts             (created by: T2)
  Create: server/src/agent/llm.ts                  (created by: T2)
  Create: server/src/agent/service.ts              (created by: T3)
  Create: server/src/agent/routes.ts               (created by: T3)
  Modify: server/src/routes.ts                     (modified by: T1 — extract getHumanColumns + board_id filter)
  Modify: server/src/db/migrate.ts                 (modified by: T1 — also apply agent-schema.sql)
  Modify: server/src/index.ts                      (modified by: T3)
  Modify: server/package.json                      (modified by: T2)
  Test:   server/src/agent/service.test.ts         (created by: T3)
  Test:   server/src/agent/templates.test.ts       (created by: T2)

Rule: Generate-Explain-Refine
  Modify: server/src/agent/llm.ts                  (modified by: T2)
  Modify: server/src/agent/service.ts              (modified by: T3)
  Test:   server/src/agent/service.test.ts

Rule: Approval Gate 1 + Thin Execution
  Modify: server/src/agent/routes.ts               (modified by: T3)
  Modify: server/src/realtime.ts                   (modified by: T2)
  Test:   server/src/agent/service.test.ts

Rule: Client Types + API
  Modify: client/src/types.ts                      (modified by: T4)
  Modify: client/src/api.ts                        (modified by: T4)
  Modify: client/src/App.tsx                       (modified by: T4)
  Modify: client/src/layout/Sidebar.tsx            (modified by: T4)
  Modify: client/src/context/BoardContext.tsx      (modified by: T4 — consume agent.* SSE)
  Test:   client/src/api.test.ts                   (modified by: T4)

Rule: AgentPage + Card Detail
  Create: client/src/lib/agentQueue.ts             (created by: T5 — pure queue reducer)
  Create: client/src/pages/AgentPage.tsx           (created by: T5)
  Create: client/src/components/AgentCardDetail.tsx (created by: T5)
  Test:   client/src/lib/agentQueue.test.ts        (created by: T5)

Rule: History Page
  Create: client/src/pages/HistoryPage.tsx         (created by: T6)
```

---

## Pocket Packets

---

### Task 1: DB Schema + GET /board Fix [prereq]

## OBJECTIVE
Create agent DB tables and fix the critical GET /board query isolation gap. This task must complete before any agent routes can be written.

Files:
- Create: `server/src/db/agent-schema.sql`
- Modify: `server/src/routes.ts` (add `AND columns.board_id IS NULL` to getBoardRows query)
- Test: `server/src/agent/service.test.ts` (scaffold — grows in T3)

Steps:
1. Write failing test that exercises the REAL GET /board column query:
   The current GET /board handler (`routes.ts:686-688`) runs a raw `pool.query` that
   does NOT route through `createScopedBoardService` — so a service-level mock cannot
   test the isolation filter. First extract the human-columns fetch into a small,
   unit-testable exported helper, then test that helper directly.

   File: `server/src/routes.ts` (extract — used by the GET /board handler):
   ```ts
   // Pool-like surface so the test can inject a fake (matches existing `pg` shape).
   type Queryable = { query: (sql: string, params: unknown[]) => Promise<{ rows: any[] }> };

   export async function getHumanColumns(db: Queryable, workspaceId: number) {
     const { rows } = await db.query(
       `SELECT id, title, position, wip_limit, policy, is_done
        FROM columns WHERE workspace_id = $1 AND board_id IS NULL ORDER BY position`,
       [workspaceId],
     );
     return rows;
   }
   ```

   File: `server/src/agent/service.test.ts` (create — will grow in T3):
   ```ts
   import { describe, it, expect, vi } from "vitest";
   import { getHumanColumns } from "../routes.js";

   describe("board isolation", () => {
     it("getHumanColumns filters agent columns via board_id IS NULL", async () => {
       // Capture the SQL actually issued — this goes RED if the filter is dropped.
       const calls: string[] = [];
       const fakeDb = {
         query: vi.fn(async (sql: string, _params: unknown[]) => {
           calls.push(sql);
           return { rows: [] };
         }),
       };

       await getHumanColumns(fakeDb, 1);

       expect(fakeDb.query).toHaveBeenCalledWith(expect.any(String), [1]);
       expect(calls[0]).toMatch(/board_id IS NULL/i);
       // Guard against a partial-match regression (e.g. only `board_id IS NOT NULL`).
       expect(calls[0]).not.toMatch(/board_id IS NOT NULL/i);
     });
   });
   ```
   This test fails RED today (the filter and `getHumanColumns` don't exist yet) and
   only goes green once the real query carries `AND board_id IS NULL`.
   Test verifies: Given the column query is issued, When it runs, Then it filters
   `board_id IS NULL` — i.e. a column with `board_id = 5` can never be returned.

   > Note: this is a query-contract unit test. A full DB-backed integration test
   > (insert an agent column, assert GET /board omits it) is stronger and recommended
   > as a follow-up, but is out of scope for the pure-function test layer this repo uses.

2. Run test — verify FAIL:
   `cd server && npx vitest run src/agent/service.test.ts`
   Expected: module not found (scaffold file doesn't exist yet)

3. Create `server/src/db/agent-schema.sql`:
   ```sql
   -- Agent board tables (additive — no existing tables modified except columns)

   CREATE TABLE IF NOT EXISTS agent_boards (
     id               SERIAL PRIMARY KEY,
     workspace_id     INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
     user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     template_id      TEXT NOT NULL DEFAULT 'research-report',
     original_intent  TEXT NOT NULL,
     status           TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved')),
     execution_status TEXT NOT NULL DEFAULT 'idle'
                      CHECK (execution_status IN ('idle', 'running', 'done', 'failed')),
     created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
   );

   CREATE TABLE IF NOT EXISTS agent_conversations (
     id         SERIAL PRIMARY KEY,
     board_id   INTEGER NOT NULL REFERENCES agent_boards(id) ON DELETE CASCADE,
     role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
     content    TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );

   CREATE TABLE IF NOT EXISTS agent_card_outputs (
     id          SERIAL PRIMARY KEY,
     board_id    INTEGER NOT NULL REFERENCES agent_boards(id) ON DELETE CASCADE,
     column_slug TEXT NOT NULL,
     card_index  INTEGER NOT NULL DEFAULT 0,
     output      TEXT NOT NULL,
     thinking    TEXT,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   );

   -- Nullable board_id on columns — agent columns have non-null board_id.
   -- Agent columns also carry their routing metadata so card-detail (Story 4)
   -- and execution can read it directly. Human columns leave these NULL.
   -- Decision: store slug + reasoning + system_prompt on the column row
   -- (denormalized from templates.ts). For Phase 1's single hardcoded template
   -- the drift risk is negligible and this keeps reads single-query — no
   -- template resolution layer on either server or client.
   ALTER TABLE columns ADD COLUMN IF NOT EXISTS board_id
     INTEGER REFERENCES agent_boards(id) ON DELETE CASCADE;
   ALTER TABLE columns ADD COLUMN IF NOT EXISTS slug TEXT;
   ALTER TABLE columns ADD COLUMN IF NOT EXISTS reasoning BOOLEAN NOT NULL DEFAULT false;
   ALTER TABLE columns ADD COLUMN IF NOT EXISTS system_prompt TEXT;

   CREATE INDEX IF NOT EXISTS idx_agent_boards_workspace ON agent_boards(workspace_id);
   CREATE INDEX IF NOT EXISTS idx_agent_conversations_board ON agent_conversations(board_id);
   CREATE INDEX IF NOT EXISTS idx_columns_board ON columns(board_id);
   ```

4. Apply schema. `server/src/db/migrate.ts:9` reads ONLY `schema.sql` — it will not
   pick up a separate `agent-schema.sql`. Decision (do not improvise in-task):
   extend `migrate.ts` to also read and execute `agent-schema.sql` after `schema.sql`.
   Keep the agent DDL in its own file (matches the spec's additive design); add the
   second `readFileSync` + `pool.query` to migrate.ts. Then run `npm run db:migrate`
   and confirm both files applied (agent tables + the new `columns` metadata fields exist).

5. Modify the GET /board handler (`server/src/routes.ts:686-688`) to use the
   extracted helper from Step 1 so the query carries the isolation filter:
   ```ts
   // Before: inline raw query
   //   const columns = await pool.query(`SELECT ... FROM columns WHERE workspace_id = $1 ORDER BY position`, [workspaceId]);
   // After: route through the tested helper (now includes AND board_id IS NULL)
   const columnRows = await getHumanColumns(pool, workspaceId);
   ```
   The `SELECT` column list and downstream `columns.rows.map(...)` shape are unchanged —
   only the source query gains `AND board_id IS NULL`.

6. Run isolation test — verify PASS:
   `cd server && npx vitest run src/agent/service.test.ts`

7. Commit:
   `git add server/src/db/agent-schema.sql server/src/db/migrate.ts server/src/routes.ts server/src/agent/service.test.ts`
   `git commit -m "feat(agent): add agent DB schema and fix GET /board workspace isolation"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-14-agentic-kanban-phase1/agent-board-phase1.md — rule: Board Generation, Schema Additions section
server/src/db/schema.sql — existing migration pattern (IF NOT EXISTS, DO $$ blocks)
server/src/routes/workspaceAccess.test.ts — createScopedBoardService mock pattern for board isolation tests
server/src/routes.ts L688 — exact query location for GET /board columns

## WHY THIS APPROACH
Complexity: standard
Justification: Schema creation is structural but the GET /board fix is a behavioral change that requires a test to verify isolation is correct. 3 files touched, judgment needed on migrate.ts integration.

## SANDWICH CONTEXT
[CRITICAL: GET /board MUST add `AND board_id IS NULL` filter — without this, agent columns pollute human kanban immediately when T3 inserts agent columns]
You are implementing DB Schema + GET /board Fix for Agentic Kanban Phase 1.
Spec: docs/pocket/spec/2026-06-14-agentic-kanban-phase1/agent-board-phase1.md
Design decision: Option C — server-managed conversation state; columns.board_id nullable
Files in scope: server/src/db/agent-schema.sql, server/src/routes.ts, server/src/agent/service.test.ts (scaffold only)
Available after: none (prereq)
Architecture rule: agent_card_outputs is separate from card_events — never write agent execution to card_events
[RESTATE: GET /board filter `AND board_id IS NULL` is the most critical change — if missed, human kanban breaks immediately]

## DELIVERABLE
Given column with board_id = 5 exists in workspace, When GET /board is called, Then that column does NOT appear in board response
Given agent-schema.sql is applied, When agent_boards table is queried, Then it exists with correct columns and constraints
[must-not] Given agent column with board_id IS NOT NULL, When GET /board fetches columns, Then system must NOT return agent columns

All tests PASS. Commit exists.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - agent-schema.sql applied via migrate.ts (migrate.ts reads it after schema.sql)
  - columns.board_id added as nullable; columns.slug/reasoning/system_prompt added (agent-only metadata)
  - GET /board routes through getHumanColumns with `AND board_id IS NULL`
  - Test exercises the real query contract (goes RED if the filter is removed)

Must-not-have:
  - Modifications to card_events table
  - Touching core/position.ts, core/wip.ts, core/metrics.ts
  - board_id NOT NULL (must remain nullable)
  - A test that mocks getBoardRows and never touches the real query (tautology)

Rollback note:
  - DROP TABLE agent_card_outputs, agent_conversations, agent_boards CASCADE
  - ALTER TABLE columns DROP COLUMN board_id, DROP COLUMN slug, DROP COLUMN reasoning, DROP COLUMN system_prompt
  - Revert GET /board to the inline query; revert migrate.ts

## STOP CONDITIONS
Done when: schema tables + columns metadata exist, getHumanColumns isolation test passes, commit created
Uncertain when: migrate.ts multi-file execution behaves unexpectedly — investigate and adapt
Escalate when: adding board_id/metadata columns breaks existing human kanban tests

---

### Task 2: Server LLM Layer + realtime.ts Agent Events [prereq]

## OBJECTIVE
Install @anthropic-ai/sdk, define the hardcoded Research & Report template, implement all LLM call functions (classify, explain, refine/clarify, executeCard), and add agent.* event types to realtime.ts.

Files:
- Modify: `server/package.json` (add @anthropic-ai/sdk)
- Create: `server/src/agent/templates.ts`
- Create: `server/src/agent/llm.ts`
- Modify: `server/src/realtime.ts` (agent.* event types)
- Test: `server/src/agent/templates.test.ts`

Steps:
1. Write failing test for template structure:
   File: `server/src/agent/templates.test.ts`
   ```ts
   import { describe, it, expect } from "vitest";
   import { TEMPLATES, getTemplate } from "./templates.js";

   describe("Research & Report template", () => {
     it("has exactly 5 columns in order", () => {
       const t = getTemplate("research-report");
       expect(t.columns).toHaveLength(5);
       expect(t.columns.map(c => c.slug)).toEqual([
         "research-specialist", "analysis-specialist", "writer", "editor", "qa-guardian"
       ]);
     });

     it("last column is always QA Guardian", () => {
       const t = getTemplate("research-report");
       expect(t.columns[t.columns.length - 1].slug).toBe("qa-guardian");
     });

     it("each column has a non-empty system_prompt", () => {
       const t = getTemplate("research-report");
       t.columns.forEach(col => {
         expect(col.system_prompt.length).toBeGreaterThan(50);
       });
     });

     it("analysis-specialist and qa-guardian have reasoning=true", () => {
       const t = getTemplate("research-report");
       const reasoningSlugs = t.columns.filter(c => c.reasoning).map(c => c.slug);
       expect(reasoningSlugs).toContain("analysis-specialist");
       expect(reasoningSlugs).toContain("qa-guardian");
     });

     it("returns null for unknown template id", () => {
       expect(getTemplate("nonexistent")).toBeNull();
     });
   });

   describe("renderSystemPrompt", () => {
     it("substitutes {original_intent} with the provided value", () => {
       const out = renderSystemPrompt("The user has requested: {original_intent}", {
         original_intent: "riset kompetitor fintech",
       });
       expect(out).toBe("The user has requested: riset kompetitor fintech");
       expect(out).not.toMatch(/\{original_intent\}/);
     });

     it("leaves unfilled placeholders intact (Phase 2 tokens)", () => {
       const out = renderSystemPrompt("{original_intent} / {previous_output}", {
         original_intent: "x",
       });
       expect(out).toBe("x / {previous_output}");
     });
   });
   ```
   (Add `renderSystemPrompt` to the import: `import { TEMPLATES, getTemplate, renderSystemPrompt } from "./templates.js";`)

2. Run test — verify FAIL:
   `cd server && npx vitest run src/agent/templates.test.ts`
   Expected: module not found error

3. Install SDK:
   `cd server && npm install @anthropic-ai/sdk`

4. Create `server/src/agent/templates.ts` with the Research & Report template definition (all 5 columns with their full system prompts from spec's Template Definition section). Each column object must have: `{ slug, name, position, reasoning, system_prompt }`.

   Also export a pure placeholder-substitution helper — the system prompts contain
   `{original_intent}`, `{previous_output}`, `{research_output}`, `{analysis_output}`,
   `{writer_output}`, `{editor_output}`. These are NOT auto-substituted by the SDK;
   without this step the LLM literally reads `The user has requested: {original_intent}`.
   ```ts
   export function renderSystemPrompt(
     template: string,
     vars: Record<string, string>,
   ): string {
     // Replace every {key} that has a provided value; leave unknown tokens intact.
     return template.replace(/\{(\w+)\}/g, (m, key) =>
       key in vars ? vars[key] : m,
     );
   }
   ```
   For Phase 1 thin execution only `{original_intent}` is populated (first card has no
   previous output); the `{previous_output}`-style tokens stay unfilled until Phase 2.

5. Create `server/src/agent/llm.ts` with these exported pure async functions:
   - `classifyIntent(intent: string): Promise<{ templateId: string | null; explanation: string }>` — calls Claude, returns matched template or null with user-facing message
   - `generateExplanation(board: AgentBoardShape, intent: string): Promise<string>` — returns natural language explanation of generated board
   - `generateClarificationQuestion(intent: string, board: AgentBoardShape, feedback: string): Promise<string>` — returns 1 targeted clarification question
   - `executeCard(systemPrompt: string, intent: string, previousOutputs: string[], reasoning: boolean, onToken: (t: string) => void): Promise<{ output: string; thinking?: string }>` — streaming LLM call. MUST substitute placeholders before the call: `const filledSystem = renderSystemPrompt(systemPrompt, { original_intent: intent });`
   
   Use Anthropic SDK. The active deployment target is **MiMo** (Xiaomi), an
   Anthropic-compatible facade over a non-Claude model — so the request must stay on
   the lowest-common-denominator Messages API surface. Two backend-specific facts,
   verified against the MiMo docs and the @anthropic-ai/sdk source:
   - **Auth header differs.** The SDK maps `apiKey` → `X-Api-Key`, but MiMo expects
     `api-key`. Send the key as BOTH (same value) via `defaultHeaders` — each backend
     reads the header it knows and ignores the other.
   - **`thinking` and `cache_control` are Claude-only.** MiMo's `/anthropic/v1/messages`
     takes a plain-string `system` and no `thinking`. Send those Claude extras ONLY when
     pointed at the real Anthropic API (i.e. `ANTHROPIC_BASE_URL` unset).

   ```ts
   import Anthropic from "@anthropic-ai/sdk";
   import { renderSystemPrompt } from "./templates.js";

   const KEY = process.env.ANTHROPIC_API_KEY;
   // baseURL may carry a path prefix; the SDK appends "/v1/messages".
   //   MiMo: ANTHROPIC_BASE_URL=https://token-plan-sgp.xiaomimimo.com/anthropic
   //         → POSTs to .../anthropic/v1/messages   (NO trailing slash on the env value)
   const client = new Anthropic({
     apiKey: KEY,                          // → X-Api-Key (real Anthropic)
     baseURL: process.env.ANTHROPIC_BASE_URL, // unset → api.anthropic.com
     defaultHeaders: { "api-key": KEY },   // → api-key (MiMo); harmless extra on real Anthropic
   });
   const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6"; // MiMo: mimo-v2.5-pro
   const NATIVE = !process.env.ANTHROPIC_BASE_URL; // true → real Anthropic, Claude extras allowed

   // For streaming executeCard:
   const filledSystem = renderSystemPrompt(systemPrompt, { original_intent: intent });
   const stream = client.messages.stream({
     model: MODEL,
     max_tokens: 4096,
     // system: cacheable block on real Anthropic; plain string on MiMo (no cache_control).
     system: NATIVE
       ? [{ type: "text", text: filledSystem, cache_control: { type: "ephemeral" } }]
       : filledSystem,
     // thinking: Claude-only. Real Anthropic + reasoning → adaptive (budget_tokens is
     // deprecated on Sonnet 4.6 — do NOT use). MiMo → omit entirely (would 400).
     ...(NATIVE && reasoning ? { thinking: { type: "adaptive", display: "summarized" } } : {}),
     messages: [{ role: "user", content: intent }],
   });
   for await (const event of stream) { /* emit tokens via onToken */ }
   const final = await stream.finalMessage();
   // return { output: <joined text>, thinking: <summary if any> }
   ```
   > ⚠️ VERIFY DURING T2 (MiMo streaming): the Anthropic SDK's `messages.stream()` parser
   > expects Anthropic-format SSE (`event: content_block_delta`). MiMo's `stream:true` may
   > emit a different SSE shape. If streaming fails to parse, fall back to non-streaming
   > `await client.messages.create({ ...params })` and emit the full text once via
   > `onToken(output)` — the started/done SSE events still drive the right-panel log;
   > only per-token streaming is lost. Note the chosen path in DONE_WITH_CONCERNS.
   > Phase 1's first executing card (Research Specialist) is `reasoning=false`, so the
   > `reasoning=true` columns (Analysis, QA — Phase 2) never hit MiMo's thinking gap here.

6. Modify `server/src/realtime.ts` — extend BoardEvent type union:
   ```ts
   type: | ... existing types ...
         | "agent.board.generating"
         | "agent.board.ready"
         | "agent.board.failed"
         | "agent.card.started"
         | "agent.card.token"
         | "agent.card.done"
         | "agent.card.failed"
   ```

7. Run template tests — verify PASS:
   `cd server && npx vitest run src/agent/templates.test.ts`

8. Commit:
   `git add server/package.json server/src/agent/templates.ts server/src/agent/llm.ts server/src/realtime.ts server/src/agent/templates.test.ts`
   `git commit -m "feat(agent): add LLM layer, Research & Report template, agent SSE events"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-14-agentic-kanban-phase1/agent-board-phase1.md — Template Definition section (all 5 system prompts verbatim)
@anthropic-ai/sdk TypeScript docs — stream API, cache_control ephemeral, thinking param
server/src/realtime.ts — BoardEvent union type location

## WHY THIS APPROACH
Complexity: standard
Justification: LLM functions are pure async (no DB dependency) — fully unit-testable via mocks. Template is hardcoded per spec. 4 files, judgment needed on streaming pattern and SDK API.

## SANDWICH CONTEXT
[CRITICAL: @anthropic-ai/sdk must only be imported in server/ — never in client/src/]
You are implementing Server LLM Layer for Agentic Kanban Phase 1.
Spec: docs/pocket/spec/2026-06-14-agentic-kanban-phase1/agent-board-phase1.md
Design decision: Option C — server manages conversation state; client sends only new message
Files in scope: server/package.json, server/src/agent/templates.ts, server/src/agent/llm.ts, server/src/realtime.ts, server/src/agent/templates.test.ts
Available after: none (prereq)
Architecture rule: API key from process.env.ANTHROPIC_API_KEY only; never hardcode or expose to client. Endpoint via process.env.ANTHROPIC_BASE_URL (optional) and model via process.env.ANTHROPIC_MODEL (optional) — server-side env only
[RESTATE: @anthropic-ai/sdk import must never appear in any file under client/src/]

## DELIVERABLE
Given template id "research-report", When getTemplate() called, Then returns 5 columns with QA Guardian last
Given any column in template, When system_prompt accessed, Then non-empty string with XML structure
Given "research-report" is the only template, When getTemplate("unknown") called, Then returns null
Given realtime.ts, When BoardEvent type is checked, Then includes all agent.* event types

All tests PASS. Commit exists.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - All 5 system prompts from spec Template Definition — verbatim
  - QA Guardian always last column
  - agent.* events in realtime.ts BoardEvent union
  - @anthropic-ai/sdk installed in server/package.json

Must-not-have:
  - @anthropic-ai/sdk in client/src/
  - Hardcoded ANTHROPIC_API_KEY string
  - Modification of core/* files

Open question risks:
  - ANTHROPIC_API_KEY not set in .env → executeCard will throw at runtime; note in DONE_WITH_CONCERNS
  - MiMo .env (active target): ANTHROPIC_BASE_URL=https://token-plan-sgp.xiaomimimo.com/anthropic
    (no trailing slash), ANTHROPIC_MODEL=mimo-v2.5-pro, ANTHROPIC_API_KEY=<MiMo key>
  - Auth: MiMo reads `api-key` header (sent via defaultHeaders); SDK also sends X-Api-Key —
    if MiMo rejects the extra header, drop X-Api-Key by constructing with apiKey:null and
    keeping only defaultHeaders. Flag if 401.
  - MiMo streaming SSE may not be Anthropic-format → fall back to non-streaming create()
    (see VERIFY note in Step 5); note in DONE_WITH_CONCERNS
  - thinking/cache_control are gated behind NATIVE (real Anthropic only); on MiMo they are
    omitted by design — not a bug

## STOP CONDITIONS
Done when: template tests pass, llm.ts exports all 4 functions, agent events in realtime.ts, commit created
Uncertain when: MiMo `messages.stream()` SSE doesn't parse as Anthropic format → switch executeCard to non-streaming create() and note in DONE_WITH_CONCERNS
Escalate when: MiMo returns 401 (auth header) or SDK types conflict with existing TypeScript config

---

### Task 3: Agent API Routes [depends: T1, T2]

## OBJECTIVE
Implement all workspace-scoped agent endpoints (`/api/workspaces/:workspaceId/agent/*`) and mount the router. This task wires T1 (DB) and T2 (LLM) together into a working server API.

Files:
- Create: `server/src/agent/service.ts`
- Create: `server/src/agent/routes.ts`
- Modify: `server/src/index.ts` (mount agent router)
- Test: `server/src/agent/service.test.ts` (extend from T1 scaffold)

Endpoints:
- `POST /api/workspaces/:workspaceId/agent/boards` — create board from intent (calls classifyIntent → generate columns from template)
- `POST /api/workspaces/:workspaceId/agent/boards/:boardId/message` — send message (refine feedback or clarification answer)
- `POST /api/workspaces/:workspaceId/agent/boards/:boardId/approve` — approve board + trigger first card execution (fire-and-forget background)
- `GET  /api/workspaces/:workspaceId/agent/boards` — list approved boards (history)
- `GET  /api/workspaces/:workspaceId/agent/boards/:id` — load specific board (for history navigation)
- `GET  /api/workspaces/:workspaceId/agent/boards/:boardId/outputs/:columnSlug` — fetch execution output for a card column

Steps:
1. Write failing service tests:
   File: `server/src/agent/service.test.ts` (extend from T1 scaffold)
   ```ts
   import { describe, it, expect, vi } from "vitest";
   import { createAgentBoardService } from "./service.js";

   describe("intent classification", () => {
     it("returns 422 when LLM cannot match intent to template", async () => {
       const service = createAgentBoardService({
         classifyIntent: vi.fn(async () => ({
           templateId: null,
           explanation: "This request isn't supported yet.",
         })),
         insertBoard: vi.fn(),
         insertConversation: vi.fn(),
         insertColumns: vi.fn(),
         publishEvent: vi.fn(),
       });
       const result = await service.createBoard({ workspaceId: 1, userId: 1, intent: "build a rocket" });
       expect(result).toMatchObject({ status: 422, message: expect.stringContaining("supported") });
     });

     it("creates board with pending status on successful classification", async () => {
       const insertBoard = vi.fn(async () => ({ id: 42 }));
       const insertConversation = vi.fn(async () => {});
       const service = createAgentBoardService({
         classifyIntent: vi.fn(async () => ({
           templateId: "research-report",
           explanation: "I made a Research & Report board for you.",
         })),
         insertBoard,
         insertConversation,
         insertColumns: vi.fn(async () => []),
         publishEvent: vi.fn(),
       });
       const result = await service.createBoard({ workspaceId: 1, userId: 1, intent: "riset kompetitor fintech" });
       expect(result).toMatchObject({ boardId: 42, explanation: expect.any(String) });
       expect(insertBoard).toHaveBeenCalledWith(expect.objectContaining({
         workspaceId: 1, userId: 1, status: "pending",
       }));
     });
   });

   describe("approval", () => {
     it("sets status=approved and execution_status=running on approve", async () => {
       const updateBoard = vi.fn(async () => {});
       const publishEvent = vi.fn(async () => {});
       const service = createAgentBoardService({
         getBoard: vi.fn(async () => ({ id: 1, status: "pending", workspaceId: 1, userId: 1, originalIntent: "riset" })),
         updateBoard,
         triggerExecution: vi.fn(async () => {}),
         publishEvent,
       });
       await service.approveBoard({ boardId: 1, userId: 1, workspaceId: 1 });
       expect(updateBoard).toHaveBeenCalledWith(1, { status: "approved", execution_status: "running" });
     });

     it("returns 403 when user tries to approve board they do not own", async () => {
       const service = createAgentBoardService({
         getBoard: vi.fn(async () => ({ id: 1, status: "pending", workspaceId: 1, userId: 99, originalIntent: "riset" })),
       });
       const result = await service.approveBoard({ boardId: 1, userId: 1, workspaceId: 1 });
       expect(result).toMatchObject({ status: 403 });
     });

     it("returns 409 when board is already approved", async () => {
       const service = createAgentBoardService({
         getBoard: vi.fn(async () => ({ id: 1, status: "approved", workspaceId: 1, userId: 1, originalIntent: "riset" })),
       });
       const result = await service.approveBoard({ boardId: 1, userId: 1, workspaceId: 1 });
       expect(result).toMatchObject({ status: 409 });
     });
   });

   describe("triggerExecution", () => {
     it("calls executeCard, persists output, publishes done event", async () => {
       const insertOutput = vi.fn(async () => {});
       const updateBoard = vi.fn(async () => {});
       const publishEvent = vi.fn(async () => {});
       const executeCard = vi.fn(async (_sys, _intent, _prev, _reasoning, onToken) => {
         onToken("hello");
         return { output: "Research output here", thinking: undefined };
       });
       const service = createAgentBoardService({
         executeCard,
         insertOutput,
         updateBoard,
         publishEvent,
         getBoard: vi.fn(async () => ({
           id: 1, status: "approved", workspaceId: 1, userId: 1,
           originalIntent: "riset kompetitor fintech lokal",
         })),
         getFirstCard: vi.fn(async () => ({
           columnSlug: "research-specialist",
           systemPrompt: "You are a Research Specialist...",
           reasoning: false,
         })),
       });
       await service.triggerExecution({ boardId: 1, workspaceId: 1 });

       expect(publishEvent).toHaveBeenCalledWith(1, expect.objectContaining({ type: "agent.card.started" }));
       // Execution must run on the board's REAL intent, not an empty/caller-supplied string.
       expect(executeCard).toHaveBeenCalledWith(
         expect.any(String), "riset kompetitor fintech lokal", [], false, expect.any(Function),
       );
       expect(insertOutput).toHaveBeenCalledWith(expect.objectContaining({
         boardId: 1,
         columnSlug: "research-specialist",
         cardIndex: 0,
         output: "Research output here",
       }));
       expect(updateBoard).toHaveBeenCalledWith(1, { execution_status: "done" });
       expect(publishEvent).toHaveBeenCalledWith(1, expect.objectContaining({ type: "agent.card.done" }));
     });

     it("sets execution_status=failed and publishes failed event on LLM error", async () => {
       const updateBoard = vi.fn(async () => {});
       const publishEvent = vi.fn(async () => {});
       const service = createAgentBoardService({
         executeCard: vi.fn(async () => { throw new Error("LLM timeout"); }),
         updateBoard,
         publishEvent,
         getBoard: vi.fn(async () => ({
           id: 1, status: "approved", workspaceId: 1, userId: 1, originalIntent: "riset",
         })),
         getFirstCard: vi.fn(async () => ({
           columnSlug: "research-specialist",
           systemPrompt: "You are...",
           reasoning: false,
         })),
         insertOutput: vi.fn(),
       });
       await service.triggerExecution({ boardId: 1, workspaceId: 1 });

       expect(updateBoard).toHaveBeenCalledWith(1, { execution_status: "failed" });
       expect(publishEvent).toHaveBeenCalledWith(1, expect.objectContaining({ type: "agent.card.failed" }));
     });
   });

   describe("card output retrieval", () => {
     it("getCardOutput returns stored output for columnSlug", async () => {
       const getOutput = vi.fn(async () => ({ output: "Research output", thinking: null }));
       const service = createAgentBoardService({ getOutput });
       const result = await service.getCardOutput({ boardId: 1, columnSlug: "research-specialist", workspaceId: 1 });
       expect(result).toMatchObject({ output: "Research output" });
     });

     it("getCardOutput returns 404 when no output exists", async () => {
       const getOutput = vi.fn(async () => null);
       const service = createAgentBoardService({ getOutput });
       const result = await service.getCardOutput({ boardId: 1, columnSlug: "research-specialist", workspaceId: 1 });
       expect(result).toMatchObject({ status: 404 });
     });
   });
   ```

2. Run tests — verify FAIL:
   `cd server && npx vitest run src/agent/service.test.ts`
   Expected: module not found (service.ts doesn't exist yet)

3. Create `server/src/agent/service.ts` — pure functions following the createXxxService dependency injection pattern:
   ```ts
   export interface AgentBoardServiceDeps {
     classifyIntent?: (intent: string) => Promise<{ templateId: string | null; explanation: string }>;
     insertBoard?: (data: { workspaceId: number; userId: number; templateId: string; originalIntent: string; status: string }) => Promise<{ id: number }>;
     insertConversation?: (data: { boardId: number; role: string; content: string }) => Promise<void>;
     insertColumns?: (boardId: number, columns: Array<{ slug: string; name: string; position: number; reasoning: boolean; systemPrompt: string }>) => Promise<void>;
     getBoard?: (boardId: number) => Promise<{ id: number; status: string; workspaceId: number; userId: number; originalIntent: string } | null>;
     updateBoard?: (boardId: number, data: Record<string, unknown>) => Promise<void>;
     getOutput?: (params: { boardId: number; columnSlug: string }) => Promise<{ output: string; thinking: string | null } | null>;
     getFirstCard?: (boardId: number) => Promise<{ columnSlug: string; systemPrompt: string; reasoning: boolean }>;
     insertOutput?: (data: { boardId: number; columnSlug: string; cardIndex: number; output: string; thinking?: string }) => Promise<void>;
     executeCard?: (systemPrompt: string, intent: string, previousOutputs: string[], reasoning: boolean, onToken: (t: string) => void) => Promise<{ output: string; thinking?: string }>;
     publishEvent?: (workspaceId: number, event: Record<string, unknown>) => Promise<void>;
   }

   export function createAgentBoardService(deps: AgentBoardServiceDeps) {
     return {
       async createBoard({ workspaceId, userId, intent }: { workspaceId: number; userId: number; intent: string }) {
         const result = await deps.classifyIntent!(intent);
         if (!result.templateId) {
           return { status: 422, message: result.explanation };
         }
         const board = await deps.insertBoard!({ workspaceId, userId, templateId: result.templateId, originalIntent: intent, status: "pending" });
         await deps.insertConversation!({ boardId: board.id, role: "assistant", content: result.explanation });
         // Insert columns from template...
         return { boardId: board.id, explanation: result.explanation };
       },
       async approveBoard({ boardId, userId, workspaceId }: { boardId: number; userId: number; workspaceId: number }) {
         const board = await deps.getBoard!(boardId);
         if (!board) return { status: 404 };
         if (board.userId !== userId) return { status: 403 };
         if (board.status !== "pending") return { status: 409 };
         await deps.updateBoard!(boardId, { status: "approved", execution_status: "running" });
         return { ok: true };
       },
       async triggerExecution({ boardId, workspaceId }: { boardId: number; workspaceId: number }) {
         // Load the board's real intent — do NOT accept it from the caller.
         // The approve route has no intent in scope; the agent must run on the
         // user's actual original_intent, not "".
         const board = await deps.getBoard!(boardId);
         if (!board) return;
         const intent = board.originalIntent;
         const card = await deps.getFirstCard!(boardId);
         await deps.publishEvent!(workspaceId, { type: "agent.card.started", columnSlug: card.columnSlug });
         try {
           const { output, thinking } = await deps.executeCard!(card.systemPrompt, intent, [], card.reasoning, (token) => {
             deps.publishEvent!(workspaceId, { type: "agent.card.token", token });
           });
           await deps.insertOutput!({ boardId, columnSlug: card.columnSlug, cardIndex: 0, output, thinking });
           await deps.updateBoard!(boardId, { execution_status: "done" });
           await deps.publishEvent!(workspaceId, { type: "agent.card.done", columnSlug: card.columnSlug });
         } catch (err) {
           await deps.updateBoard!(boardId, { execution_status: "failed" });
           await deps.publishEvent!(workspaceId, { type: "agent.card.failed", error: String(err) });
         }
       },
       async getCardOutput({ boardId, columnSlug, workspaceId }: { boardId: number; columnSlug: string; workspaceId: number }) {
         const output = await deps.getOutput!({ boardId, columnSlug });
         if (!output) return { status: 404 };
         return { output: output.output, thinking: output.thinking };
       },
       // sendMessage, getBoards, getBoard...
     };
   }
   ```

4. Create `server/src/agent/routes.ts` — Express Router wrapping service with all 6 endpoints:
   ```ts
   import { Router } from "express";
   import { requireAuth } from "../auth.js";
   import { createAgentBoardService } from "./service.js";

   export function createAgentRouter(deps: any) {
     const router = Router();
     const service = createAgentBoardService(deps);

     router.post("/workspaces/:workspaceId/agent/boards", requireAuth, async (req, res) => {
       // ... createBoard
     });
     router.post("/workspaces/:workspaceId/agent/boards/:boardId/message", requireAuth, async (req, res) => {
       // ... sendMessage
     });
     router.post("/workspaces/:workspaceId/agent/boards/:boardId/approve", requireAuth, async (req, res) => {
       // approve + fire-and-forget triggerExecution
       const result = await service.approveBoard({ boardId: Number(req.params.boardId), userId: req.user!.id, workspaceId: Number(req.params.workspaceId) });
       if (result.status) return res.status(result.status).json(result);
       // Fire-and-forget execution. triggerExecution loads original_intent from
       // the board itself — the route deliberately passes NO intent.
       service.triggerExecution({ boardId: Number(req.params.boardId), workspaceId: Number(req.params.workspaceId) }).catch(console.error);
       res.status(204).end();
     });
     router.get("/workspaces/:workspaceId/agent/boards", requireAuth, async (req, res) => {
       // ... list boards
     });
     router.get("/workspaces/:workspaceId/agent/boards/:id", requireAuth, async (req, res) => {
       // ... get board
     });
     router.get("/workspaces/:workspaceId/agent/boards/:boardId/outputs/:columnSlug", requireAuth, async (req, res) => {
       // ... getCardOutput
     });
     return router;
   }
   ```

5. Modify `server/src/index.ts` — mount agent router alongside the existing `api`
   router. The existing pattern is `app.use("/api", api)` and agent routes already
   apply `requireAuth` per-route — so do NOT add a second top-level `requireAuth`
   (that would double-run it):
   ```ts
   import { createAgentRouter } from "./agent/routes.js";
   // ...
   app.use("/api", api);                       // existing
   app.use("/api", createAgentRouter(realDeps)); // new — requireAuth is per-route inside
   ```

6. Run all service tests — verify PASS:
   `cd server && npx vitest run src/agent/service.test.ts`

7. Commit:
   `git add server/src/agent/service.ts server/src/agent/routes.ts server/src/index.ts server/src/agent/service.test.ts`
   `git commit -m "feat(agent): add agent API routes — create, message, approve, execute, list, load, output"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-14-agentic-kanban-phase1/agent-board-phase1.md — Story 1, 2, 3, 6 GWT scenarios
server/src/routes/workspaceAccess.test.ts — createXxxService dependency injection pattern (DI mocks)
server/src/realtime.ts — publishEvent signature and workspaceEventChannel
server/src/routes.ts — existing route structure and requireAuth usage

## WHY THIS APPROACH
Complexity: standard
Justification: 4 files, cross-file coordination between DB/LLM/realtime. Service extraction pattern from existing codebase. Complex approval flow (status + execution trigger + SSE publish).

## SANDWICH CONTEXT
[CRITICAL: agent execution output must go to agent_card_outputs — NEVER to card_events]
You are implementing Agent API Routes for Agentic Kanban Phase 1.
Spec: docs/pocket/spec/2026-06-14-agentic-kanban-phase1/agent-board-phase1.md
Design decision: Option C — server stores full conversation thread; client sends only new message
Files in scope: server/src/agent/service.ts, server/src/agent/routes.ts, server/src/index.ts, server/src/agent/service.test.ts
Available after: T1 (agent_boards table), T2 (llm.ts functions, agent events in realtime.ts)
Architecture rule: requireAuth on all endpoints; workspace-scope all DB queries; publishEvent via realtime.ts only
[RESTATE: agent card execution output writes to agent_card_outputs, not card_events — human Activity Feed must stay clean]

## DELIVERABLE
Given user submits intent "riset kompetitor fintech", When POST /agent/boards, Then board created (status=pending), explanation returned, conversation stored
Given LLM returns templateId=null, When POST /agent/boards, Then 422 with user-facing message from LLM
Given board in pending status, When POST /agent/boards/:id/approve, Then status=approved, execution_status=running, first card execution triggered
Given user is not board owner, When POST /approve, Then 403 returned
Given board already approved, When POST /approve again, Then 409 returned
Given board approved, When GET /agent/boards, Then list includes board with intent, template, created_at, execution_status
Given history board clicked, When GET /agent/boards/:id, Then full board data returned without re-triggering execution
Given board execution done, When GET /agent/boards/:boardId/outputs/research-specialist, Then output text returned
Given board approved, When triggerExecution runs and LLM succeeds, Then agent.card.done published + execution_status=done in DB
Given board approved, When triggerExecution runs and LLM fails, Then agent.card.failed published + execution_status=failed in DB
[must-not] Given agent card executes, When output stored, Then card_events table must NOT receive a new row

All tests PASS. Commit exists.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - All 5 endpoints implemented with requireAuth
  - conversation thread stored per board in agent_conversations
  - execution_status field updated on approve
  - SSE event published on board state changes
  - real getBoard dep SELECTs original_intent; triggerExecution runs on it
  - real getFirstCard dep reads slug/reasoning/system_prompt from the columns row (T1 metadata)
  - insertColumns persists slug/name/position/reasoning/system_prompt + board_id per agent column
  - Tests written BEFORE implementation (TDD)

Must-not-have:
  - Writing to card_events from agent code
  - Exposing ANTHROPIC_API_KEY in any response
  - Cross-workspace data leakage (always filter by workspace_id)
  - Passing a hardcoded/empty intent into execution (must come from the board)

Open question risks:
  - executeCard async completion — approve endpoint returns 200 immediately; execution runs in background (fire-and-forget + SSE). If fire-and-forget fails silently → report NEEDS_CONTEXT

## STOP CONDITIONS
Done when: all service tests pass, endpoints accessible, commit created
Uncertain when: background execution pattern unclear (async fire-and-forget vs job queue)
Escalate when: adding /api/agent route conflicts with existing /api route mounting

---

### Task 4: Client Types + API + Routing [depends: T3]

## OBJECTIVE
Add TypeScript interfaces for agent entities, implement all agent API functions, add /agent and /history routes to the React router, add navigation links to Sidebar, and wire agent.* SSE events into the existing BoardContext stream so AgentPage (T5) can consume them.

Files:
- Modify: `client/src/types.ts`
- Modify: `client/src/api.ts`
- Modify: `client/src/App.tsx`
- Modify: `client/src/layout/Sidebar.tsx`
- Modify: `client/src/context/BoardContext.tsx` (consume agent.* SSE events)
- Modify: `client/src/api.test.ts`

> SSE NOTE (critical — there is NO `SSEContext`/`useSSE` in this codebase): SSE is
> already handled privately inside `BoardContext.tsx`. Its `EventSource` is on the
> same `/workspaces/:id/events/stream` channel that T3 publishes agent.* events to,
> but the current `onmessage` handler (a) ignores unknown event types and (b) calls
> `void refresh()` on EVERY message — which would refetch the human board on every
> streamed `agent.card.token`. T4 must extend this handler to surface agent events
> to pages AND skip `refresh()` for them. T5 consumes `useBoard().agentEvents`, NOT
> a fictional `useSSE`.

Steps:
1. Write failing API tests:
   File: `client/src/api.test.ts` (extend existing)
   ```ts
   describe("Agent API methods", () => {
     it("createAgentBoard sends POST with intent in body", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () => Promise.resolve({ boardId: 1, explanation: "I made a Research & Report board." }),
       });
       const { api } = await import("./api");
       const result = await api.createAgentBoard(5, "riset kompetitor fintech lokal");
       expect(mockFetch).toHaveBeenCalledWith(
         "/api/workspaces/5/agent/boards",
         expect.objectContaining({
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ intent: "riset kompetitor fintech lokal" }),
         })
       );
       expect(result).toMatchObject({ boardId: 1, explanation: expect.any(String) });
     });

     it("sendAgentBoardMessage sends POST with message", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () => Promise.resolve({ explanation: "Clarification question", boardUpdated: false }),
       });
       const { api } = await import("./api");
       await api.sendAgentBoardMessage(5, 42, "tidak, ini untuk product launch");
       expect(mockFetch).toHaveBeenCalledWith(
         "/api/workspaces/5/agent/boards/42/message",
         expect.objectContaining({
           method: "POST",
           body: JSON.stringify({ message: "tidak, ini untuk product launch" }),
         })
       );
     });

     it("approveAgentBoard sends POST to approve endpoint", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 204,
         json: () => Promise.resolve(undefined),
       });
       const { api } = await import("./api");
       await api.approveAgentBoard(5, 42);
       expect(mockFetch).toHaveBeenCalledWith(
         "/api/workspaces/5/agent/boards/42/approve",
         expect.objectContaining({ method: "POST" })
       );
     });

     it("getAgentBoards sends GET to list endpoint", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () => Promise.resolve([
           { id: 2, originalIntent: "analisis pasar", createdAt: "2026-06-14T11:00:00Z" },
           { id: 1, originalIntent: "riset fintech", createdAt: "2026-06-14T10:00:00Z" },
         ]),
       });
       const { api } = await import("./api");
       const result = await api.getAgentBoards(5);
       expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/5/agent/boards", expect.any(Object));
       expect(result).toHaveLength(2);
       expect(result[0].id).toBe(2); // sorted newest first
     });

     it("getAgentBoard sends GET to single board endpoint", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () => Promise.resolve({ id: 42, originalIntent: "riset fintech", status: "approved", executionStatus: "done" }),
       });
       const { api } = await import("./api");
       const result = await api.getAgentBoard(5, 42);
       expect(mockFetch).toHaveBeenCalledWith("/api/workspaces/5/agent/boards/42", expect.any(Object));
       expect(result).toMatchObject({ id: 42, executionStatus: "done" });
     });

     it("getAgentCardOutput sends GET to output endpoint", async () => {
       mockFetch.mockResolvedValueOnce({
         ok: true,
         status: 200,
         json: () => Promise.resolve({ output: "Research output here", thinking: null }),
       });
       const { api } = await import("./api");
       const result = await api.getAgentCardOutput(5, 42, "research-specialist");
       expect(mockFetch).toHaveBeenCalledWith(
         "/api/workspaces/5/agent/boards/42/outputs/research-specialist",
         expect.any(Object)
       );
       expect(result).toMatchObject({ output: "Research output here" });
     });
   });
   ```

2. Run tests — verify FAIL:
   `cd client && npx vitest run src/api.test.ts`
   Expected: type errors / missing API functions

3. Add to `client/src/types.ts`:
   ```ts
   export interface AgentColumn {
     id: number;
     slug: string;
     name: string;
     position: number;
     reasoning: boolean;
     systemPrompt: string;
     cards: AgentCard[];
   }

   export interface AgentCard {
     id: number;
     columnId: number;
     title: string;
     position: number;
   }

   export interface AgentBoard {
     id: number;
     workspaceId: number;
     templateId: string;
     originalIntent: string;
     status: "pending" | "approved";
     executionStatus: "idle" | "running" | "done" | "failed";
     createdAt: string;
     columns: AgentColumn[];
   }

   export interface AgentCardOutput {
     columnSlug: string;
     output: string;
     thinking?: string;
   }

   // Mirrors the agent.* BoardEvent union published by realtime.ts (T2).
   export interface AgentEvent {
     type:
       | "agent.board.generating" | "agent.board.ready" | "agent.board.failed"
       | "agent.card.started" | "agent.card.token" | "agent.card.done" | "agent.card.failed";
     columnSlug?: string;
     token?: string;
     error?: string;
   }
   ```

4. Add to `client/src/api.ts` (follow existing `request<T>` pattern):
   ```ts
   createAgentBoard: (workspaceId: number, intent: string) =>
     request<{ boardId: number; explanation: string }>(`/workspaces/${workspaceId}/agent/boards`, { method: "POST", body: JSON.stringify({ intent }) }),

   sendAgentBoardMessage: (workspaceId: number, boardId: number, message: string) =>
     request<{ explanation: string; boardUpdated: boolean }>(`/workspaces/${workspaceId}/agent/boards/${boardId}/message`, { method: "POST", body: JSON.stringify({ message }) }),

   approveAgentBoard: (workspaceId: number, boardId: number) =>
     request<void>(`/workspaces/${workspaceId}/agent/boards/${boardId}/approve`, { method: "POST" }),

   getAgentBoards: (workspaceId: number) =>
     request<AgentBoard[]>(`/workspaces/${workspaceId}/agent/boards`),

   getAgentBoard: (workspaceId: number, boardId: number) =>
     request<AgentBoard>(`/workspaces/${workspaceId}/agent/boards/${boardId}`),

   getAgentCardOutput: (workspaceId: number, boardId: number, columnSlug: string) =>
     request<AgentCardOutput>(`/workspaces/${workspaceId}/agent/boards/${boardId}/outputs/${columnSlug}`),
   ```

5. Add routes to `client/src/App.tsx`:
   - `/agent` → `<AgentPage />`
   - `/history` → `<HistoryPage />`
   (lazy import both pages)

6. Add nav links to `client/src/layout/Sidebar.tsx`:
   - "Agent" → `/agent`
   - "History" → `/history`
   (follow existing nav link pattern)

7. Extend `client/src/context/BoardContext.tsx` to surface agent.* SSE events:
   - Add state: `const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);`
   - In the `stream.onmessage` handler (currently ~line 350), BEFORE the trailing
     `void refresh()`, branch on agent events and return early so the human board is
     NOT refetched per token:
     ```ts
     if (typeof data.type === "string" && data.type.startsWith("agent.")) {
       setAgentEvents((prev) => [...prev, data as AgentEvent]);
       return; // do NOT call refresh() for agent events
     }
     ```
   - Add `agentEvents` and `clearAgentEvents: () => setAgentEvents([])` to
     `BoardContextValue` and the provider's returned value. (AgentPage clears on a
     new generation/approval so logs don't bleed across sessions.)
   - Note: the real field consumed by pages is `activeWorkspaceId` (number | null)
     and `showToast` — there is no `workspaceId`/`addToast` on this context.

8. Run API tests — verify PASS:
   `cd client && npx vitest run src/api.test.ts`

9. Commit:
   `git add client/src/types.ts client/src/api.ts client/src/App.tsx client/src/layout/Sidebar.tsx client/src/context/BoardContext.tsx client/src/api.test.ts`
   `git commit -m "feat(agent): add client types, API functions, /agent /history routes, agent SSE wiring"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-14-agentic-kanban-phase1/agent-board-phase1.md — AgentBoard, AgentColumn, AgentCard schema; all 6 API endpoint contracts
client/src/api.test.ts — vi.stubGlobal fetch mock pattern (exact structure used in Step 1)
client/src/types.ts — existing interface conventions (camelCase, optional fields with ?)
client/src/App.tsx — existing router + lazy import pattern
client/src/api.ts — existing `request<T>` helper and API method pattern

## WHY THIS APPROACH
Complexity: lightweight
Justification: Pure TypeScript additions following established patterns. No new architectural decisions. 5 files, clear spec.

## SANDWICH CONTEXT
[CRITICAL: AgentBoard, AgentColumn types must not be imported server-side — client types only]
You are implementing Client Types + API + Routing for Agentic Kanban Phase 1.
Spec: docs/pocket/spec/2026-06-14-agentic-kanban-phase1/agent-board-phase1.md
Design decision: Option C — client sends only new message; server manages conversation state
Files in scope: client/src/types.ts, client/src/api.ts, client/src/App.tsx, client/src/layout/Sidebar.tsx, client/src/api.test.ts
Available after: T3 (server endpoints exist and respond)
Architecture rule: no @anthropic-ai/sdk import in any client file
[RESTATE: @anthropic-ai/sdk must never appear in client/src/ — all LLM calls are server-side only]

## DELIVERABLE
Given workspaceId and intent, When api.createAgentBoard called, Then POST sent to /api/workspaces/:id/agent/boards with intent in body
Given workspaceId and boardId, When api.approveAgentBoard called, Then POST sent to approve endpoint
Given workspaceId, When api.getAgentBoards called, Then GET sent to agent boards list endpoint
Given /agent navigated to, Then AgentPage renders (no 404)
Given /history navigated to, Then HistoryPage renders (no 404)

All tests PASS. Commit exists.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - All API functions return typed responses matching AgentBoard interfaces
  - Both routes registered and lazy-loaded (data-router `lazy:` convention, not React.lazy)
  - Sidebar shows Agent + History nav links
  - BoardContext exposes agentEvents + clearAgentEvents; agent.* events do NOT trigger refresh()
  - Tests written BEFORE implementation (TDD)

Must-not-have:
  - Any import from @anthropic-ai/sdk
  - Hardcoded workspace IDs in API functions
  - A second/duplicate EventSource for agent events (reuse BoardContext's stream)
  - Reference to a non-existent SSEContext/useSSE

## STOP CONDITIONS
Done when: API tests pass, routes render, sidebar links visible, agentEvents wired, commit created
Escalate when: existing App.tsx routing pattern conflicts with new routes

---

### Task 5: AgentPage + AgentCardDetail [depends: T4]

## OBJECTIVE
Build the /agent split-view page: left panel (board visual or empty CTA), right panel (chat input + agent explanations + approve button + live execution log), and the read-only AgentCardDetail panel.

Files:
- Create: `client/src/lib/agentQueue.ts` (pure queue state machine)
- Create: `client/src/lib/agentQueue.test.ts` (unit tests — no testing-library needed)
- Create: `client/src/pages/AgentPage.tsx`
- Create: `client/src/components/AgentCardDetail.tsx`

Steps:
0. Extract the generate/refine queue into a PURE reducer first (TDD, and this is the
   highest-risk logic in the task). `@testing-library/react` is NOT installed in this
   repo, so the render tests below get skipped — but the queue logic (Story 1 Rule 2:
   "input queued while generating; auto-fires after done/fail; queue survives failure")
   can and must be unit-tested. This mirrors the repo's tested-pure-function pattern
   (`client/src/lib/workspaceSelection.ts`, `cardPanel.ts`, `title.ts`).

   File: `client/src/lib/agentQueue.ts`
   ```ts
   export interface QueueState { isGenerating: boolean; queue: string[]; }
   export const initialQueue: QueueState = { isGenerating: false, queue: [] };

   // Returns next state + the message to send NOW (or null if nothing should fire).
   export function submit(state: QueueState, message: string): { state: QueueState; fire: string | null } {
     if (state.isGenerating) return { state: { ...state, queue: [...state.queue, message] }, fire: null };
     return { state: { ...state, isGenerating: true }, fire: message };
   }
   // On done OR fail: drop the in-flight job; if queued items remain, fire the next.
   // Queue is NOT reset on failure.
   export function settle(state: QueueState): { state: QueueState; fire: string | null } {
     if (state.queue.length === 0) return { state: { ...state, isGenerating: false }, fire: null };
     const [next, ...rest] = state.queue;
     return { state: { isGenerating: true, queue: rest }, fire: next };
   }
   ```

   File: `client/src/lib/agentQueue.test.ts`
   ```ts
   import { describe, it, expect } from "vitest";
   import { initialQueue, submit, settle } from "./agentQueue.js";

   describe("agentQueue", () => {
     it("fires immediately when idle", () => {
       const r = submit(initialQueue, "a");
       expect(r.fire).toBe("a");
       expect(r.state.isGenerating).toBe(true);
     });
     it("queues a second submit while generating", () => {
       const r1 = submit(initialQueue, "a");
       const r2 = submit(r1.state, "b");
       expect(r2.fire).toBeNull();
       expect(r2.state.queue).toEqual(["b"]);
     });
     it("auto-fires the queued message on settle", () => {
       const r1 = submit(initialQueue, "a");
       const r2 = submit(r1.state, "b");
       const s = settle(r2.state);
       expect(s.fire).toBe("b");
       expect(s.state.queue).toEqual([]);
     });
     it("queue survives failure (settle is used for both done and fail)", () => {
       const r1 = submit(initialQueue, "a");
       const r2 = submit(r1.state, "b");
       const s = settle(r2.state); // failure path still drains the queue
       expect(s.fire).toBe("b");
     });
     it("goes idle when queue is empty on settle", () => {
       const r1 = submit(initialQueue, "a");
       const s = settle(r1.state);
       expect(s.fire).toBeNull();
       expect(s.state.isGenerating).toBe(false);
     });
   });
   ```
   Run: `cd client && npx vitest run src/lib/agentQueue.test.ts` (RED → GREEN). AgentPage
   consumes `submit`/`settle` instead of hand-rolling queue logic inline.

1. Write failing render tests:
   File: `client/src/pages/AgentPage.test.tsx` (or skip if `@testing-library/react` not installed)
   Check: `npm ls @testing-library/react --workspace=client 2>/dev/null`
   
   If testing-library is available:
   ```tsx
   import { describe, it, expect, vi } from "vitest";
   import { render, screen, fireEvent, waitFor } from "@testing-library/react";
   import { MemoryRouter } from "react-router-dom";
   import AgentPage from "./AgentPage.js";

   // Mock the API module
   const mockCreateBoard = vi.fn(async () => ({ boardId: 1, explanation: "I made a Research & Report board." }));
   const mockApproveBoard = vi.fn(async () => {});
   const mockGetAgentBoard = vi.fn(async () => ({
     id: 1, status: "approved", executionStatus: "done", originalIntent: "riset fintech",
     columns: [{ id: 1, slug: "research-specialist", name: "Research Specialist", position: 1, reasoning: false, systemPrompt: "You are...", cards: [] }],
   }));
   vi.mock("../api.js", () => ({
     api: {
       createAgentBoard: (...args: any[]) => mockCreateBoard(...args),
       approveAgentBoard: (...args: any[]) => mockApproveBoard(...args),
       getAgentBoard: (...args: any[]) => mockGetAgentBoard(...args),
       sendAgentBoardMessage: vi.fn(async () => ({ explanation: "Can you clarify?", boardUpdated: false })),
       getAgentCardOutput: vi.fn(async () => ({ output: "Research result", thinking: null })),
     },
   }));

   // Mock workspace context. NOTE: the REAL BoardContext exposes
   // `activeWorkspaceId` (number | null) and `showToast` — there is no
   // `workspaceId`/`addToast`. Agent SSE events arrive via `agentEvents`
   // on this same context (there is NO separate SSEContext/useSSE).
   vi.mock("../context/BoardContext.js", () => ({
     useBoard: () => ({
       activeWorkspaceId: 1,
       showToast: vi.fn(),
       agentEvents: [],
       clearAgentEvents: vi.fn(),
     }),
   }));

   describe("AgentPage", () => {
     it("shows empty state CTA when no board exists", () => {
       render(<MemoryRouter><AgentPage /></MemoryRouter>);
       // Verify empty state text visible
       expect(screen.getByText(/agent/i)).toBeInTheDocument();
     });

     it("renders chat input in empty state", () => {
       render(<MemoryRouter><AgentPage /></MemoryRouter>);
       const input = screen.getByRole("textbox") || screen.getByPlaceholderText(/intent|message/i);
       expect(input).toBeInTheDocument();
     });

     it("calls createAgentBoard on intent submit", async () => {
       render(<MemoryRouter><AgentPage /></MemoryRouter>);
       const input = screen.getByRole("textbox");
       const submitBtn = screen.getByRole("button", { name: /submit|send|start/i });
       
       fireEvent.change(input, { target: { value: "riset kompetitor fintech lokal" } });
       fireEvent.click(submitBtn);
       
       await waitFor(() => {
         expect(mockCreateBoard).toHaveBeenCalledWith(1, "riset kompetitor fintech lokal");
       });
     });
   });

   describe("AgentCardDetail", () => {
     // Component-level tests if testing-library available
     it("shows extended thinking ON badge when reasoning=true", async () => {
       const { default: AgentCardDetail } = await import("../components/AgentCardDetail.js");
       render(
         <AgentCardDetail
           column={{ id: 2, slug: "analysis-specialist", name: "Analysis Specialist", position: 2, reasoning: true, systemPrompt: "You are...", cards: [] }}
           onClose={() => {}}
         />
       );
       expect(screen.getByText(/extended thinking.*on/i)).toBeInTheDocument();
     });

     it("shows extended thinking OFF badge when reasoning=false", async () => {
       const { default: AgentCardDetail } = await import("../components/AgentCardDetail.js");
       render(
         <AgentCardDetail
           column={{ id: 1, slug: "research-specialist", name: "Research Specialist", position: 1, reasoning: false, systemPrompt: "You are...", cards: [] }}
           onClose={() => {}}
         />
       );
       expect(screen.getByText(/extended thinking.*off/i)).toBeInTheDocument();
     });

     it("has no edit controls — no textarea, no editable inputs", async () => {
       const { default: AgentCardDetail } = await import("../components/AgentCardDetail.js");
       render(
         <AgentCardDetail
           column={{ id: 1, slug: "research-specialist", name: "Research Specialist", position: 1, reasoning: false, systemPrompt: "You are...", cards: [] }}
           onClose={() => {}}
         />
       );
       expect(screen.queryByRole("textbox")).toBeNull();
     });
   });
   ```
   
   If testing-library is NOT available:
   - Skip render tests, note in `DONE_WITH_CONCERNS`
   - Proceed with implementation only

2. Run tests — verify FAIL (or note if testing-library unavailable)

3. Create `client/src/components/AgentCardDetail.tsx`:
   ```tsx
   interface AgentCardDetailProps {
     column: { slug: string; name: string; position: number; reasoning: boolean; systemPrompt: string };
     output?: { output: string; thinking?: string };
     onClose: () => void;
   }
   // Read-only panel: column.name, system_prompt (formatted), reasoning badge, output (if exists)
   // No edit controls — no textarea, no contentEditable, no input fields
   ```

4. Create `client/src/pages/AgentPage.tsx`:
   Left panel states:
   - No board: empty state + CTA
   - Board pending: read-only board visual; approve button active
   - Board approved + running: read-only board; right panel shows SSE log
   - Board approved + done/failed: read-only board; right panel shows final state

   Right panel states:
   - No board: chat input (enabled) + submit
   - Board pending: chat shows explanation + approve/refine; input enabled
   - Board approved: input disabled; live execution log (SSE agent.* events)

   Queue behavior (use the pure reducer from Step 0 — do NOT re-implement inline):
   - Hold `QueueState` from `agentQueue.ts`
   - Submit → `submit(state, msg)`; if `fire` non-null, send it; else it's queued
   - On generation complete OR fail → `settle(state)`; if `fire` non-null, auto-send next
   - Queue survives failure (settle drains on both paths)

   Live execution log (right panel): read `agentEvents` from `useBoard()` (wired in T4).
   On entering execution, call `clearAgentEvents()`, then render the accumulating
   `agent.card.started` → `agent.card.token` → `agent.card.done`/`agent.card.failed`
   stream. There is NO `useSSE` — events come through BoardContext.

   Error handling:
   - LLM fail → `errorMessage` + "Retry" button
   - DB fail on approve → error + "Retry Approve"; board stays pending
   - Execution fail (SSE `agent.card.failed`) → error + "Retry Execution" → POST /approve again

5. Load `docs/pocket/rule/creative-brief.md` and apply design tokens for all UI.

6. Run tests (if applicable) — verify PASS.

7. Commit:
   `git add client/src/lib/agentQueue.ts client/src/lib/agentQueue.test.ts client/src/pages/AgentPage.tsx client/src/components/AgentCardDetail.tsx`
   `git commit -m "feat(agent): add AgentPage split view, AgentCardDetail panel, queue reducer"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-14-agentic-kanban-phase1/agent-board-phase1.md — Stories 1-5 GWT scenarios, board states, queue behavior, error states
docs/pocket/rule/creative-brief.md — MUST load before any UI decisions
client/src/pages/BoardPage.tsx — existing board visual patterns
client/src/context/BoardContext.tsx — SSE connection pattern for workspace events

## WHY THIS APPROACH
Complexity: deep
Justification: 2 new files but high UI complexity — multiple panel states, SSE integration, state machine logic. Requires judgment on React state shape and SSE event handling.

## SANDWICH CONTEXT
[CRITICAL: Load docs/pocket/rule/creative-brief.md before writing any CSS, colors, or component styles]
You are implementing AgentPage + AgentCardDetail for Agentic Kanban Phase 1.
Spec: docs/pocket/spec/2026-06-14-agentic-kanban-phase1/agent-board-phase1.md
Design decision: Option C — chat sends messages, server responds with updated state
Files in scope: client/src/pages/AgentPage.tsx, client/src/components/AgentCardDetail.tsx
Available after: T4 (api.ts functions, AgentBoard types, routes registered)
Architecture rule: board visual is read-only — no drag-and-drop; no edit controls in AgentCardDetail; chat input disabled after approval
[RESTATE: creative-brief.md is mandatory — no color/spacing/typography decisions without it]

## DELIVERABLE
Given user opens /agent with no prior board, Then left panel shows empty state CTA, right panel shows enabled chat input
Given user submits intent, When board generated, Then left panel shows board visual (read-only), right panel shows explanation
Given user submits second intent while first generation in-progress, Then second intent queued; auto-fires after first completes or fails
Given LLM fails on generate, Then right panel shows error message + "Retry" button; queue not reset
Given board in pending state, When user clicks "Approve", Then chat input becomes disabled, right panel shows live progress log
Given DB write fails on approve, Then right panel shows error + "Retry Approve" button; board stays pending, approve button re-enabled
Given board in left panel, When execution fails (agent.card.failed SSE), Then right panel shows error + "Retry Execution" button
Given user clicks card on read-only board, Then AgentCardDetail panel opens with system_prompt and reasoning mode
Given column has reasoning=true, When card detail opened, Then "Extended Thinking: ON" badge shown
Given execution done, When user clicks executed card, Then output shown in detail panel (fetched via getAgentCardOutput)
[must-not] Given board is read-only, Then drag-and-drop must NOT be available on board visual
[must-not] Given panel is open, Then there must NOT be any input or edit control in AgentCardDetail

All tests PASS (or testing-library unavailable noted). Commit exists.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - creative-brief.md loaded before any styling
  - Board visual read-only (no @dnd-kit drag handlers)
  - Chat input disabled after approval
  - Queue logic lives in tested `lib/agentQueue.ts` (not hand-rolled inline)
  - Right panel log driven by `agentEvents` from BoardContext (no useSSE)
  - Reads `activeWorkspaceId`/`showToast` from useBoard (guard `activeWorkspaceId === null`)
  - AgentCardDetail shows system_prompt + reasoning badge
  - Tests written BEFORE implementation (TDD)

Must-not-have:
  - Edit controls in AgentCardDetail
  - Drag-and-drop on agent board
  - Import of @anthropic-ai/sdk
  - Reference to a fictional SSEContext/useSSE, or `workspaceId`/`addToast` on useBoard

Open question risks:
  - testing-library not installed → render tests skipped, but agentQueue.test.ts MUST
    pass (it needs no testing-library); note skipped render tests in DONE_WITH_CONCERNS

## STOP CONDITIONS
Done when: /agent page renders with all states, detail panel works, creative-brief applied, commit created
Uncertain when: SSE agent.* events don't arrive (check T2/T3 event publishing)
Escalate when: creative-brief.md missing or unreadable

---

### Task 6: HistoryPage [depends: T4] [parallel: T5]

## OBJECTIVE
Build the /history page — a simple list of approved agent boards, workspace-scoped, sorted newest first, with click-to-load navigation to /agent.

Files:
- Create: `client/src/pages/HistoryPage.tsx`
- Test: `client/src/pages/HistoryPage.test.tsx` (or in existing api.test.ts)

Steps:
1. Write failing render test:
   File: `client/src/pages/HistoryPage.test.tsx` (create if testing-library available, else skip)
   ```tsx
   import { describe, it, expect, vi } from "vitest";
   import { render, screen, waitFor, fireEvent } from "@testing-library/react";
   import { MemoryRouter } from "react-router-dom";
   import HistoryPage from "./HistoryPage.js";

   // Mock the API module
   const mockGetAgentBoards = vi.fn(async () => [
     { id: 2, originalIntent: "analisis pasar Indonesia", templateId: "research-report", createdAt: "2026-06-14T11:00:00Z", executionStatus: "done" },
     { id: 1, originalIntent: "riset kompetitor fintech lokal", templateId: "research-report", createdAt: "2026-06-14T10:00:00Z", executionStatus: "done" },
   ]);
   vi.mock("../api.js", () => ({
     api: { getAgentBoards: (...args: any[]) => mockGetAgentBoards(...args) },
   }));

   // Mock workspace context. Real field is `activeWorkspaceId` (not `workspaceId`).
   vi.mock("../context/BoardContext.js", () => ({
     useBoard: () => ({ activeWorkspaceId: 1 }),
   }));

   describe("HistoryPage", () => {
     it("calls getAgentBoards with current workspaceId on mount", async () => {
       render(<MemoryRouter><HistoryPage /></MemoryRouter>);
       await waitFor(() => {
         expect(mockGetAgentBoards).toHaveBeenCalledWith(1);
       });
     });

     it("renders list items with intent text", async () => {
       render(<MemoryRouter><HistoryPage /></MemoryRouter>);
       await waitFor(() => {
         expect(screen.getByText("riset kompetitor fintech lokal")).toBeInTheDocument();
         expect(screen.getByText("analisis pasar Indonesia")).toBeInTheDocument();
       });
     });

     it("boards are sorted newest first", async () => {
       render(<MemoryRouter><HistoryPage /></MemoryRouter>);
       await waitFor(() => {
         const items = screen.getAllByRole("listitem");
         expect(items[0]).toHaveTextContent("analisis pasar Indonesia"); // id 2, newest
         expect(items[1]).toHaveTextContent("riset kompetitor fintech lokal"); // id 1, oldest
       });
     });

     it("shows execution status badge", async () => {
       render(<MemoryRouter><HistoryPage /></MemoryRouter>);
       await waitFor(() => {
         const doneBadges = screen.getAllByText(/done/i);
         expect(doneBadges.length).toBeGreaterThan(0);
       });
     });

     it("shows empty state when no boards", async () => {
       mockGetAgentBoards.mockResolvedValueOnce([]);
       render(<MemoryRouter><HistoryPage /></MemoryRouter>);
       await waitFor(() => {
         expect(screen.getByText(/no agent boards/i)).toBeInTheDocument();
       });
     });

     it("navigates to /agent with boardId on item click", async () => {
       const mockNavigate = vi.fn();
       vi.mock("react-router-dom", async () => {
         const actual = await vi.importActual("react-router-dom");
         return { ...actual, useNavigate: () => mockNavigate };
       });
       render(<MemoryRouter><HistoryPage /></MemoryRouter>);
       await waitFor(() => {
         fireEvent.click(screen.getByText("riset kompetitor fintech lokal"));
       });
       expect(mockNavigate).toHaveBeenCalledWith("/agent?boardId=1");
     });
   });
   ```

2. Run test — verify FAIL:
   `cd client && npx vitest run src/pages/HistoryPage.test.tsx`

3. Create `client/src/pages/HistoryPage.tsx`:
   - Read `activeWorkspaceId` from `useBoard()` (NOT `workspaceId`); guard the `null` case
   - On mount: call `api.getAgentBoards(activeWorkspaceId)` → render list sorted by created_at DESC
   - Each item: `originalIntent` (truncated to ~80 chars), template display name ("Research & Report"), formatted date (reuse `formatRelativeTime` from types.ts if available), `executionStatus` badge
   - Click item → `navigate('/agent?boardId=' + board.id)`
   - Empty state: "No agent boards yet." + link to `/agent`
   - Load `docs/pocket/rule/creative-brief.md` for styling

4. Run test — verify PASS:
   `cd client && npx vitest run src/pages/HistoryPage.test.tsx`

5. Commit:
   `git add client/src/pages/HistoryPage.tsx`
   `git commit -m "feat(agent): add /history page with approved boards list"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-14-agentic-kanban-phase1/agent-board-phase1.md — Story 6 GWT scenarios
docs/pocket/rule/creative-brief.md — MUST load before styling
client/src/types.ts — formatRelativeTime (reuse), AgentBoard interface
client/src/pages/ActivityPage.tsx — list page pattern to follow

## WHY THIS APPROACH
Complexity: lightweight
Justification: 1 file, clear spec, 20-30 LOC as user estimated, follows existing list page patterns.

## SANDWICH CONTEXT
[CRITICAL: Load docs/pocket/rule/creative-brief.md before writing any styles]
You are implementing HistoryPage for Agentic Kanban Phase 1.
Spec: docs/pocket/spec/2026-06-14-agentic-kanban-phase1/agent-board-phase1.md
Design decision: list only — no pagination, no filter, no re-triggering of execution on load
Files in scope: client/src/pages/HistoryPage.tsx only
Available after: T4 (api.getAgentBoards, AgentBoard type, /history route registered)
Architecture rule: clicking a board navigates to /agent — it does NOT re-trigger any execution
[RESTATE: loading a board from history must NEVER trigger execution — read-only replay only]

## DELIVERABLE
Given user has 3 approved boards in workspace, When /history opened, Then list shows 3 items sorted newest first
Given list item clicked, When navigation occurs, Then user goes to /agent with that board's id in query params
Given user has no approved boards, When /history opened, Then empty state with CTA link to /agent shown
Given user is in workspace A, When /history shown, Then only workspace A boards visible
[must-not] Given board loaded from history, Then execution must NOT be re-triggered

All tests PASS. Commit exists.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - creative-brief.md loaded before styling
  - Boards sorted created_at DESC
  - Each item shows intent, template name, date, executionStatus
  - Click navigates to /agent (no re-execution)
  - Tests written BEFORE implementation (TDD)

Must-not-have:
  - Any execution trigger on board load
  - Cross-workspace data (always workspace-scoped)

## STOP CONDITIONS
Done when: /history page renders list, click navigates to /agent, empty state works, commit created
Escalate when: AgentBoard type missing from T4 (dependency not yet complete)

---

## Plan Summary

| Task | Name | Depends | Complexity | Key Verification |
|------|------|---------|------------|-----------------|
| T1 | DB Schema + GET /board Fix | prereq | standard | GET /board excludes agent columns |
| T2 | Server LLM Layer + realtime events | prereq | standard | template has 5 cols, QA last; agent.* in BoardEvent |
| T3 | Agent API Routes | T1, T2 | standard | POST /boards creates, POST /approve sets approved+running |
| T4 | Client Types + API + Routing | T3 | lightweight | api functions send correct requests; /agent /history render |
| T5 | AgentPage + AgentCardDetail | T4 | deep | split view states; detail panel read-only |
| T6 | HistoryPage | T4 | lightweight | list view, click navigates, empty state |
