# EXECUTION PLAN — Agentic Kanban Phase 2: Full Pipeline (Named-Output Resolution + Autonomous Loop)

**Date:** 2026-06-14
**Spec:** docs/pocket/spec/2026-06-14-agentic-kanban-phase2-pipeline/full-pipeline.md
**Status:** approved
**Total tasks:** 4

---

## Test-Architect Summary

**Pass completed:** 2026-06-14

**What was done:**
- T1 Step 1: Replaced placeholder with complete `server/src/agent/templates.test.ts` content — 8 test cases covering `buildVarsMap` (built-ins present, accumulator merge, multi-predecessor merge, built-ins override), `findUnresolvedPlaceholders` (clean string, single typo, multiple patterns), and `RESEARCH_REPORT_COLUMNS` output_key completeness.
- T2 Step 1: Replaced placeholder with complete `server/src/agent/service.test.ts` content — 6 test cases via a `buildService(overrides?)` factory using real `research-specialist` and `analysis-specialist` slugs. Covers: happy-path loop order, named resolution (no literal `{previous_output}` in resolved prompt), SSE events (started/done sequence), fail-closed on unresolved placeholder, fail-closed on empty output, fail-closed on executeCard throw.
- T4 Step 1: Clarified that the skeleton is in Step 3a (full test implementation already written). Step 1 describes the failing condition for TDD framing.
- T3: Unchanged — `[no-tdd — structural task]` confirmed correct.
- TDD order validated: T1 ✅, T2 ✅, T3 ✅ (structural, tsc verification), T4 ✅ (dry-run-skip-first discipline).

**Key decisions:**
- T2 tests use real template slugs (`research-specialist`, `analysis-specialist`) so `getTemplate('research-report')` in the service correctly resolves `output_key` values from the real template definition — no need to mock `getTemplate`.
- `vi.useFakeTimers()` / `vi.useRealTimers()` bracketing is applied in T2 to prevent `setInterval` from leaking across tests.
- The second column's `systemPrompt` in the T2 factory uses `{previous_output}` deliberately to test named resolution (the service replaces it with the first card's mock output).
- T4's "failing first" is the dry-run-skip discipline: running against an empty file fails immediately; the SKIP condition is the first green state before full implementation.

---

## Execution Overview

### Recommended Order
```
T1 → T2 → T3, T4 (parallel)
```

> Dependency order above is **recommended** — pocket skill enforces actual parallelism and sequencing based on its routing logic.

### Parallelizable Groups
| Group | Tasks | Unblocked After |
|-------|-------|-----------------|
| Group A | T3, T4 | T2 completes |

### Constraints Reminder
**Architecture:** `executeCard` signature in `llm.ts` must not change; `renderSystemPrompt` leave-unknown-intact behavior must not change; `agent_card_outputs` table shape must not change; core service must not hardcode any template's slugs/keys.
**Out-of-scope:** Retry UI / resume-on-restart; parallel card execution / DAG; BullMQ / job queue; `{topic}` from separate board metadata (map to `original_intent`); extended thinking / `cache_control`; cancellation/abort.
**Assumptions at risk:** DB write failure mid-loop (insertOutput throws) → treated as fail-closed (same path); accepted risk.
**Sequencing:** Dependency order shown is recommended only — pocket enforces actual blocking rules.

### File Structure Map

```
Rule: Sequential autonomous loop (1.1)
  Modify: server/src/agent/service.ts       (modified by: T2)
  Modify: server/src/agent/routes.ts        (modified by: T3)
  Test:   server/src/agent/service.test.ts  (created by: T2)

Rule: Template-agnostic named-output resolution (2.1, 2.2)
  Modify: server/src/agent/templates.ts         (modified by: T1)
  Test:   server/src/agent/templates.test.ts    (created by: T1)

Rule: Fail-closed semantics (3.1, 3.2, 3.3)
  Modify: server/src/agent/service.ts           (modified by: T2 — same file as loop)
  Test:   server/src/agent/service.test.ts      (created by: T2 — same file as loop tests)

Rule: Real-time visibility (4.1, 4.2)
  Modify: server/src/agent/service.ts           (modified by: T2 — same file)
  Test:   server/src/agent/service.test.ts      (created by: T2 — same file)

Rule: Headless live-LLM integration verification (5.1–5.4)
  Create: server/src/agent/pipeline.integration.test.ts  (created by: T4)
  Modify: server/package.json                            (modified by: T4)
```

Note: `(created by: T<N>)` annotations help test-architect avoid importing from files that don't exist yet at test-write time.

---

## Pocket Packets

---

### Task 1: Pure resolver layer in templates.ts [prereq]

## OBJECTIVE
Add `output_key` declaration and two pure functions to `server/src/agent/templates.ts`:
1. `output_key?: string` field on `TemplateColumn` interface, populated for every column in `RESEARCH_REPORT_COLUMNS`: research-specialist → `'research_output'`, analysis-specialist → `'analysis_output'`, writer → `'writer_output'`, editor → `'editor_output'`, qa-guardian → `'qa_output'`.
2. `buildVarsMap(intent, previousOutput, accumulator)` — merges named accumulator outputs with built-in placeholders (`original_intent`, `topic`, `previous_output`), with built-ins always winning over accumulator.
3. `findUnresolvedPlaceholders(rendered)` — returns all `{key}` substrings matching `/\{[a-z][a-z0-9_]*\}/g` remaining in a rendered string.

Both functions are pure (no IO, no imports beyond types). Both must be exported.

Files:
- Modify: `server/src/agent/templates.ts`
- Test: `server/src/agent/templates.test.ts` (new file)

Steps:
1. Write failing test for: Rule 2.1 (named resolution), Rule 2.2 (built-ins), Rule 3.1 (unresolved detection)
   File: `server/src/agent/templates.test.ts`

   **Full file content to write:**
   ```typescript
   import { describe, expect, it } from "vitest";
   import {
     buildVarsMap,
     findUnresolvedPlaceholders,
     RESEARCH_REPORT_COLUMNS,
   } from "./templates.js";

   describe("buildVarsMap", () => {
     it("includes all three built-in keys when accumulator is empty", () => {
       const result = buildVarsMap("my intent", "prev output", {});
       expect(result).toEqual({
         original_intent: "my intent",
         topic: "my intent",
         previous_output: "prev output",
       });
     });

     it("merges a named accumulator key alongside the built-ins", () => {
       const result = buildVarsMap("intent", "prev", {
         research_output: "BRIEF",
       });
       expect(result.research_output).toBe("BRIEF");
       expect(result.original_intent).toBe("intent");
       expect(result.topic).toBe("intent");
       expect(result.previous_output).toBe("prev");
     });

     it("merges multiple named accumulator keys (multi-predecessor support)", () => {
       const result = buildVarsMap("intent", "prev", {
         research_output: "A",
         analysis_output: "B",
       });
       expect(result.research_output).toBe("A");
       expect(result.analysis_output).toBe("B");
       expect(result.original_intent).toBe("intent");
     });

     it("built-ins always override accumulator keys with the same name", () => {
       const result = buildVarsMap("real intent", "real prev", {
         original_intent: "hijack",
         previous_output: "also hijack",
         topic: "also hijack",
       });
       expect(result.original_intent).toBe("real intent");
       expect(result.previous_output).toBe("real prev");
       expect(result.topic).toBe("real intent");
     });
   });

   describe("findUnresolvedPlaceholders", () => {
     it("returns an empty array for a fully-resolved string", () => {
       expect(findUnresolvedPlaceholders("hello world, no placeholders here")).toEqual([]);
     });

     it("returns the unresolved placeholder when a typo key remains", () => {
       expect(findUnresolvedPlaceholders("prompt {reserch_output} done")).toEqual([
         "{reserch_output}",
       ]);
     });

     it("returns all unresolved placeholders when multiple remain", () => {
       expect(findUnresolvedPlaceholders("{a} text {b_c}")).toEqual(["{a}", "{b_c}"]);
     });
   });

   describe("RESEARCH_REPORT_COLUMNS", () => {
     it("every column has a non-empty output_key", () => {
       for (const column of RESEARCH_REPORT_COLUMNS) {
         expect(
           column.output_key,
           `column '${column.slug}' is missing output_key`,
         ).toBeTruthy();
         expect(typeof column.output_key).toBe("string");
         expect((column.output_key as string).length).toBeGreaterThan(0);
       }
     });
   });
   ```

2. Run test — verify FAIL:
   `cd server && npx vitest run src/agent/templates.test.ts`
   Expected failure: `buildVarsMap is not a function` / `findUnresolvedPlaceholders is not a function` / `output_key` assertions fail

3. Implement changes to `server/src/agent/templates.ts`:

   **3a — Add `output_key` to `TemplateColumn` interface:**
   ```typescript
   export interface TemplateColumn {
     slug: string;
     name: string;
     position: number;
     reasoning: boolean;
     system_prompt: string;
     output_key?: string;
   }
   ```

   **3b — Add `output_key` to each column in `RESEARCH_REPORT_COLUMNS`:**
   - `{ slug: 'research-specialist', ..., output_key: 'research_output' }`
   - `{ slug: 'analysis-specialist', ..., output_key: 'analysis_output' }`
   - `{ slug: 'writer', ..., output_key: 'writer_output' }`
   - `{ slug: 'editor', ..., output_key: 'editor_output' }`
   - `{ slug: 'qa-guardian', ..., output_key: 'qa_output' }`

   **3c — Export `buildVarsMap`:**
   ```typescript
   export function buildVarsMap(
     intent: string,
     previousOutput: string,
     accumulator: Record<string, string>,
   ): Record<string, string> {
     return {
       ...accumulator,
       original_intent: intent,
       topic: intent,
       previous_output: previousOutput,
     };
   }
   ```
   (Built-ins spread last so they override any accumulator key with the same name.)

   **3d — Export `findUnresolvedPlaceholders`:**
   ```typescript
   export function findUnresolvedPlaceholders(rendered: string): string[] {
     return [...rendered.matchAll(/\{[a-z][a-z0-9_]*\}/g)].map((m) => m[0]);
   }
   ```

4. Run test — verify PASS:
   `cd server && npx vitest run src/agent/templates.test.ts`
   Expected: all assertions green, 0 failures

5. Commit:
   `git add server/src/agent/templates.ts server/src/agent/templates.test.ts`
   `git commit -m "feat(agent): add output_key, buildVarsMap, findUnresolvedPlaceholders to templates"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-14-agentic-kanban-phase2-pipeline/full-pipeline.md — rule: Template-agnostic named-output resolution (2.1, 2.2), GWT: "Named placeholders resolved from accumulator" + "Built-in placeholders"
docs/pocket/spec/2026-06-14-agentic-kanban-phase2-pipeline/full-pipeline.md — rule: Fail-closed semantics (3.1), GWT: "Unresolved placeholder fails closed"
server/src/agent/templates.ts — existing `renderSystemPrompt` leaves unknown placeholders intact; `TemplateColumn` interface; `RESEARCH_REPORT_COLUMNS` slug names
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Justification: Single file with three small, pure, independently-testable additions. No IO dependencies means tests are zero-setup. Keeping resolver/validator in `templates.ts` (Option C) makes the plugin contract a pure, auditable seam — consistent with templates-becoming-plugins vision.
Complexity: lightweight

## SANDWICH CONTEXT
[CRITICAL: `renderSystemPrompt` must NOT be modified — its leave-unknown-intact behavior is preserved as a low-level contract.]
You are implementing the pure resolver layer for Agentic Kanban Phase 2.
Spec: docs/pocket/spec/2026-06-14-agentic-kanban-phase2-pipeline/full-pipeline.md
Design decision: Option C — pure functions in templates.ts; service loop calls them; executeCard unchanged.
Files in scope: `server/src/agent/templates.ts`, `server/src/agent/templates.test.ts` — no other files.
Test framework: Vitest — `import { describe, expect, it } from "vitest"` following `server/src/core/position.test.ts` pattern.
Available after: nothing (prereq)
Architecture rule: Functions must be pure (no DB, no HTTP, no env access). Core must not hardcode template slugs/keys — `output_key` values live in the template definition array, not in service logic.
[RESTATE: `renderSystemPrompt` must NOT be modified — its leave-unknown-intact behavior is a preserved contract.]

## DELIVERABLE
Given research-specialist output in accumulator as `research_output`, When buildVarsMap is called, Then `{research_output}` key is present in the returned map.
Given board intent "X" and previous output "Y", When buildVarsMap is called, Then `original_intent='X'`, `topic='X'`, `previous_output='Y'` are in the map.
Given accumulator with `{ original_intent: 'hijack' }`, When buildVarsMap is called, Then `original_intent` equals the intent argument, not 'hijack' (built-ins win).
Given a fully-resolved prompt string, When findUnresolvedPlaceholders is called, Then it returns `[]`.
[must-not] Given a prompt with typo `{reserch_output}`, When findUnresolvedPlaceholders is called, Then it returns `['{reserch_output}']`.
Given `RESEARCH_REPORT_COLUMNS`, When each column is inspected, Then `output_key` is a non-empty string on every column.

All tests PASS. Commit exists with message `feat(agent): add output_key, buildVarsMap, findUnresolvedPlaceholders to templates`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `buildVarsMap` and `findUnresolvedPlaceholders` are exported named functions
  - Built-ins (`original_intent`, `topic`, `previous_output`) always win over accumulator keys
  - `output_key` set on all 5 columns in RESEARCH_REPORT_COLUMNS
  - Tests written BEFORE implementation (TDD — not after)
  - Commit message follows conventional commits format

Must-not-have:
  - Any change to `renderSystemPrompt` signature or body
  - Any change to `Template`, `getTemplate`, or `TEMPLATES` registry
  - Hardcoded slug names (`'research-specialist'`, etc.) in the new functions — functions are template-agnostic
  - IO of any kind in the new pure functions

Open question risks:
  - What if output_key conflicts with a built-in? → `buildVarsMap` spreads accumulator first, built-ins last, so built-ins always win. If this assumption is wrong: report NEEDS_CONTEXT.

Rollback note:
  - Additive only — removing these exports reverts to Phase 1 behavior.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: built-in override behavior questioned by reviewer
Escalate when: any change to `renderSystemPrompt` is proposed (out of scope)

---

### Task 2: runPipeline loop in service.ts [depends: T1]

## OBJECTIVE
Extend `server/src/agent/service.ts` with:
1. `ColumnInfo` interface: `{ columnId: number, columnSlug: string, systemPrompt: string, reasoning: boolean }`
2. `getColumns?: (boardId: number) => Promise<ColumnInfo[]>` dep on `AgentBoardServiceDeps`
3. `runPipeline` method on the returned service object (alongside the existing `triggerExecution` — do NOT remove `triggerExecution` yet, T3 will update the call site)

`runPipeline` behavior:
- Load board; load all columns ordered by position via `deps.getColumns`
- Look up template via `getTemplate(board.templateId ?? '')` to build `Map<slug, output_key>`
- Loop over columns 0..N-1 sequentially, maintaining `accumulator: Record<string,string>` and `previousOutput: string`
- Per card: emit `agent.card.started{columnSlug}` → `buildVarsMap` → `renderSystemPrompt` → `findUnresolvedPlaceholders` (halt if any) → token-batched `executeCard` → check empty output (halt if `trim().length===0`) → `insertOutput(cardIndex=i)` → `insertCard` → emit `agent.card.done{columnSlug}` → update accumulator and previousOutput
- After loop: `updateBoard({execution_status:'done'})` (no new board-level event required)
- Fail-closed on ANY halt: persist partial row for failing card → `updateBoard({execution_status:'failed'})` → emit `agent.card.failed{columnSlug, reason}` → log error → return (remaining cards skip)
- Token batching: `setInterval(200ms)` created per card, cleared on both success and failure of each card

Files:
- Modify: `server/src/agent/service.ts`
- Test: `server/src/agent/service.test.ts` (new file)

Steps:
1. Write failing tests for: Rule 1.1 (loop order + persistence), Rule 2.1/2.2 (named resolution), Rule 3.1 (unresolved placeholder halt), Rule 3.2 (empty output halt), Rule 3.3 (executeCard throw halt), Rule 4.1/4.2 (per-card SSE)
   File: `server/src/agent/service.test.ts`

   **Full file content to write:**
   ```typescript
   import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
   import { createAgentBoardService } from "./service.js";
   import type { AgentBoardServiceDeps, ColumnInfo } from "./service.js";

   // ---------------------------------------------------------------------------
   // Default test columns — use real research-report slugs so getTemplate()
   // inside the service correctly resolves output_key values.
   // ---------------------------------------------------------------------------
   const DEFAULT_COLUMNS: ColumnInfo[] = [
     {
       columnId: 10,
       columnSlug: "research-specialist",
       systemPrompt: "You are a researcher. Topic: {original_intent}",
       reasoning: false,
     },
     {
       columnId: 20,
       columnSlug: "analysis-specialist",
       systemPrompt: "Analyze this. Previous: {previous_output}",
       reasoning: false,
     },
   ];

   const DEFAULT_BOARD = {
     id: 1,
     workspaceId: 1,
     userId: 1,
     templateId: "research-report",
     originalIntent: "Test intent",
     status: "approved",
     executionStatus: "running",
   };

   // ---------------------------------------------------------------------------
   // DI factory — overrides let individual tests swap out any single dep.
   // ---------------------------------------------------------------------------
   function buildService(overrides: Partial<AgentBoardServiceDeps> = {}) {
     const deps: AgentBoardServiceDeps = {
       getBoard: vi.fn().mockResolvedValue(DEFAULT_BOARD),
       getColumns: vi.fn().mockResolvedValue(DEFAULT_COLUMNS),
       executeCard: vi.fn().mockResolvedValue({ output: "mock output text" }),
       insertOutput: vi.fn().mockResolvedValue(undefined),
       insertCard: vi.fn().mockResolvedValue(undefined),
       updateBoard: vi.fn().mockResolvedValue(undefined),
       publishEvent: vi.fn().mockResolvedValue(undefined),
       ...overrides,
     };
     return { service: createAgentBoardService(deps), deps };
   }

   // ---------------------------------------------------------------------------
   // Tests
   // ---------------------------------------------------------------------------

   describe("runPipeline", () => {
     beforeEach(() => {
       vi.useFakeTimers();
     });

     afterEach(() => {
       vi.useRealTimers();
     });

     it("happy path: executeCard called once per column in order, insertOutput called with correct cardIndex, updateBoard called with done", async () => {
       const { service, deps } = buildService();

       const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
       await vi.runAllTimersAsync();
       await promise;

       expect(deps.executeCard).toHaveBeenCalledTimes(2);

       // Verify call order matches column order by checking system prompt content
       const firstCall = (deps.executeCard as ReturnType<typeof vi.fn>).mock.calls[0];
       const secondCall = (deps.executeCard as ReturnType<typeof vi.fn>).mock.calls[1];
       expect(firstCall[0]).toContain("researcher");
       expect(secondCall[0]).toContain("Analyze");

       expect(deps.insertOutput).toHaveBeenCalledTimes(2);
       const insertCalls = (deps.insertOutput as ReturnType<typeof vi.fn>).mock.calls;
       expect(insertCalls[0][0]).toMatchObject({ cardIndex: 0, columnSlug: "research-specialist" });
       expect(insertCalls[1][0]).toMatchObject({ cardIndex: 1, columnSlug: "analysis-specialist" });

       expect(deps.updateBoard).toHaveBeenCalledWith(1, { execution_status: "done" });
     });

     it("named resolution: second card systemPrompt has {previous_output} replaced with first card output", async () => {
       const { service, deps } = buildService({
         executeCard: vi.fn().mockResolvedValue({ output: "first card result" }),
       });

       const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
       await vi.runAllTimersAsync();
       await promise;

       const secondCallSystemPrompt = (deps.executeCard as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
       // {previous_output} must have been resolved — it should not appear as a literal
       expect(secondCallSystemPrompt).not.toMatch(/\{previous_output\}/);
       // The resolved value (first card's output) should appear in its place
       expect(secondCallSystemPrompt).toContain("first card result");
     });

     it("SSE: agent.card.started emitted before executeCard, agent.card.done emitted after insertOutput for each card", async () => {
       const events: Array<Record<string, unknown>> = [];
       const executeOrder: string[] = [];
       const insertOrder: string[] = [];

       const { service } = buildService({
         publishEvent: vi.fn().mockImplementation(async (_wid, event) => {
           events.push(event);
         }),
         executeCard: vi.fn().mockImplementation(async () => {
           executeOrder.push("execute");
           return { output: "mock output" };
         }),
         insertOutput: vi.fn().mockImplementation(async () => {
           insertOrder.push("insert");
         }),
       });

       const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
       await vi.runAllTimersAsync();
       await promise;

       // First card started event
       expect(events[0]).toMatchObject({
         type: "agent.card.started",
         columnSlug: "research-specialist",
       });

       // First card done event must come after insert (not before)
       const firstDoneIdx = events.findIndex(
         (e) => e.type === "agent.card.done" && e.columnSlug === "research-specialist",
       );
       expect(firstDoneIdx).toBeGreaterThan(0);

       // Second card started event comes after first done
       const secondStartIdx = events.findIndex(
         (e) => e.type === "agent.card.started" && e.columnSlug === "analysis-specialist",
       );
       expect(secondStartIdx).toBeGreaterThan(firstDoneIdx);

       // Second card done event exists
       const secondDoneIdx = events.findIndex(
         (e) => e.type === "agent.card.done" && e.columnSlug === "analysis-specialist",
       );
       expect(secondDoneIdx).toBeGreaterThan(secondStartIdx);
     });

     it("fail-closed — unresolved placeholder: executeCard NOT called, updateBoard called with failed, agent.card.failed emitted, insertOutput called with empty output", async () => {
       const { service, deps } = buildService({
         getColumns: vi.fn().mockResolvedValue([
           {
             columnId: 10,
             columnSlug: "research-specialist",
             systemPrompt: "Hello {unknown_key_xyz}",
             reasoning: false,
           },
         ] as ColumnInfo[]),
       });

       const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
       await vi.runAllTimersAsync();
       await promise;

       expect(deps.executeCard).not.toHaveBeenCalled();
       expect(deps.updateBoard).toHaveBeenCalledWith(1, { execution_status: "failed" });

       const publishCalls = (deps.publishEvent as ReturnType<typeof vi.fn>).mock.calls;
       const failedEvent = publishCalls
         .map((c: unknown[]) => c[1] as Record<string, unknown>)
         .find((e) => e.type === "agent.card.failed");
       expect(failedEvent).toBeDefined();
       expect(failedEvent!.columnSlug).toBe("research-specialist");
       expect(String(failedEvent!.reason)).toContain("{unknown_key_xyz}");

       // Partial audit row must be persisted for the failing card
       expect(deps.insertOutput).toHaveBeenCalledWith(
         expect.objectContaining({ columnSlug: "research-specialist", output: "" }),
       );
     });

     it("fail-closed — empty output: pipeline halts after first card, second executeCard NOT called, updateBoard called with failed", async () => {
       const executeCardMock = vi.fn()
         .mockResolvedValueOnce({ output: "   " }) // first card returns whitespace-only
         .mockResolvedValueOnce({ output: "should not be called" });

       const { service, deps } = buildService({ executeCard: executeCardMock });

       const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
       await vi.runAllTimersAsync();
       await promise;

       expect(executeCardMock).toHaveBeenCalledTimes(1);
       expect(deps.updateBoard).toHaveBeenCalledWith(1, { execution_status: "failed" });

       // Partial row persisted for the failing card
       const insertCalls = (deps.insertOutput as ReturnType<typeof vi.fn>).mock.calls;
       expect(insertCalls).toHaveLength(1);
       expect(insertCalls[0][0]).toMatchObject({ columnSlug: "research-specialist" });

       // agent.card.failed emitted
       const publishCalls = (deps.publishEvent as ReturnType<typeof vi.fn>).mock.calls;
       const failedEvent = publishCalls
         .map((c: unknown[]) => c[1] as Record<string, unknown>)
         .find((e) => e.type === "agent.card.failed");
       expect(failedEvent).toBeDefined();
       expect(failedEvent!.columnSlug).toBe("research-specialist");
     });

     it("fail-closed — executeCard throws on second card: first insertOutput remains (cardIndex 0), updateBoard called with failed, agent.card.failed emitted, second insertOutput called with empty output", async () => {
       const executeCardMock = vi.fn()
         .mockResolvedValueOnce({ output: "first card result" }) // card 0 succeeds
         .mockRejectedValueOnce(new Error("LLM timeout")); // card 1 throws

       const { service, deps } = buildService({ executeCard: executeCardMock });

       const promise = service.runPipeline({ boardId: 1, workspaceId: 1 });
       await vi.runAllTimersAsync();
       await promise;

       // First card's insertOutput must have been called
       const insertCalls = (deps.insertOutput as ReturnType<typeof vi.fn>).mock.calls;
       expect(insertCalls[0][0]).toMatchObject({
         cardIndex: 0,
         columnSlug: "research-specialist",
         output: "first card result",
       });

       // Second card's partial row must also be persisted (audit trail)
       expect(insertCalls[1][0]).toMatchObject({
         cardIndex: 1,
         columnSlug: "analysis-specialist",
         output: "",
       });

       expect(deps.updateBoard).toHaveBeenCalledWith(1, { execution_status: "failed" });

       const publishCalls = (deps.publishEvent as ReturnType<typeof vi.fn>).mock.calls;
       const failedEvent = publishCalls
         .map((c: unknown[]) => c[1] as Record<string, unknown>)
         .find((e) => e.type === "agent.card.failed");
       expect(failedEvent).toBeDefined();
       expect(failedEvent!.columnSlug).toBe("analysis-specialist");
     });
   });
   ```

2. Run test — verify FAIL:
   `cd server && npx vitest run src/agent/service.test.ts`
   Expected failure: `service.runPipeline is not a function`

3. Implement changes to `server/src/agent/service.ts`:

   **Step 3a — Add `ColumnInfo` interface and `getColumns` to deps:**
   After `FirstCardInfo` definition, add:
   ```typescript
   export interface ColumnInfo {
     columnId: number;
     columnSlug: string;
     systemPrompt: string;
     reasoning: boolean;
   }
   ```
   Add to `AgentBoardServiceDeps`:
   ```typescript
   getColumns?: (boardId: number) => Promise<ColumnInfo[]>;
   ```

   **Step 3b — Update import from templates.ts:**
   ```typescript
   import { getTemplate, buildVarsMap, findUnresolvedPlaceholders, renderSystemPrompt } from "./templates.js";
   ```

   **Step 3c — Add `runPipeline` method to the service object returned by `createAgentBoardService`:**
   ```typescript
   async runPipeline({ boardId, workspaceId }: { boardId: number; workspaceId: number }) {
     const board = await deps.getBoard!(boardId);
     if (!board) return;

     const columns = await deps.getColumns!(boardId);
     if (!columns || columns.length === 0) return;

     // Build slug → output_key map from template (template-agnostic lookup)
     const template = getTemplate(board.templateId ?? '');
     const slugToOutputKey = new Map<string, string>(
       (template?.columns ?? [])
         .filter((c) => c.output_key)
         .map((c) => [c.slug, c.output_key!]),
     );

     const accumulator: Record<string, string> = {};
     let previousOutput = '';

     for (let i = 0; i < columns.length; i++) {
       const column = columns[i];

       await deps.publishEvent?.(workspaceId, {
         type: 'agent.card.started',
         columnSlug: column.columnSlug,
       });

       // Build vars and render prompt
       const vars = buildVarsMap(board.originalIntent, previousOutput, accumulator);
       const rendered = renderSystemPrompt(column.systemPrompt, vars);

       // Fail-closed: halt before LLM call if any placeholder unresolved
       const unresolved = findUnresolvedPlaceholders(rendered);
       if (unresolved.length > 0) {
         const reason = `Unresolved placeholders: ${unresolved.join(', ')}`;
         console.error(`[runPipeline] card ${column.columnSlug} halted — ${reason}`);
         await deps.insertOutput!({
           boardId,
           columnSlug: column.columnSlug,
           cardIndex: i,
           output: '',
         });
         await deps.updateBoard!(boardId, { execution_status: 'failed' });
         await deps.publishEvent?.(workspaceId, {
           type: 'agent.card.failed',
           columnSlug: column.columnSlug,
           reason,
         });
         return;
       }

       // Token batching via setInterval(200ms)
       let tokenBuffer = '';
       const batchInterval = setInterval(() => {
         if (tokenBuffer) {
           deps.publishEvent?.(workspaceId, {
             type: 'agent.card.token',
             columnSlug: column.columnSlug,
             token: tokenBuffer,
           });
           tokenBuffer = '';
         }
       }, 200);

       try {
         const result = await deps.executeCard!(
           rendered,
           board.originalIntent,
           [],
           column.reasoning,
           (token: string) => { tokenBuffer += token; },
         );

         clearInterval(batchInterval);

         // Flush remaining tokens
         if (tokenBuffer) {
           await deps.publishEvent?.(workspaceId, {
             type: 'agent.card.token',
             columnSlug: column.columnSlug,
             token: tokenBuffer,
           });
         }

         // Fail-closed: empty output
         if (result.output.trim().length === 0) {
           const reason = 'Empty output';
           console.error(`[runPipeline] card ${column.columnSlug} halted — ${reason}`);
           await deps.insertOutput!({
             boardId,
             columnSlug: column.columnSlug,
             cardIndex: i,
             output: result.output,
             thinking: result.thinking,
           });
           await deps.updateBoard!(boardId, { execution_status: 'failed' });
           await deps.publishEvent?.(workspaceId, {
             type: 'agent.card.failed',
             columnSlug: column.columnSlug,
             reason,
           });
           return;
         }

         // Persist output to agent_card_outputs (NOT card_events)
         await deps.insertOutput!({
           boardId,
           columnSlug: column.columnSlug,
           cardIndex: i,
           output: result.output,
           thinking: result.thinking,
         });

         // Create visual card handle (preview title)
         const preview = result.output.length > 120
           ? result.output.slice(0, 120) + '…'
           : result.output;
         await deps.insertCard!({
           columnId: column.columnId,
           title: preview,
           position: 1.0,
           workspaceId,
         });

         await deps.publishEvent?.(workspaceId, {
           type: 'agent.card.done',
           columnSlug: column.columnSlug,
         });

         // Update accumulator and advance previous output
         const outputKey = slugToOutputKey.get(column.columnSlug);
         if (outputKey) {
           accumulator[outputKey] = result.output;
         }
         previousOutput = result.output;

       } catch (err) {
         clearInterval(batchInterval);
         const reason = String(err);
         console.error(`[runPipeline] card ${column.columnSlug} threw — ${reason}`);
         await deps.insertOutput!({
           boardId,
           columnSlug: column.columnSlug,
           cardIndex: i,
           output: '',
         });
         await deps.updateBoard!(boardId, { execution_status: 'failed' });
         await deps.publishEvent?.(workspaceId, {
           type: 'agent.card.failed',
           columnSlug: column.columnSlug,
           reason,
         });
         return;
       }
     }

     // All cards succeeded
     await deps.updateBoard!(boardId, { execution_status: 'done' });
   },
   ```

4. Run test — verify PASS:
   `cd server && npx vitest run src/agent/service.test.ts`
   Expected: all assertions green, 0 failures

5. Commit:
   `git add server/src/agent/service.ts server/src/agent/service.test.ts`
   `git commit -m "feat(agent): implement runPipeline — sequential loop, named resolution, fail-closed, per-card SSE"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-14-agentic-kanban-phase2-pipeline/full-pipeline.md — rules: 1.1 (loop), 2.1/2.2 (resolution), 3.1/3.2/3.3 (fail-closed), 4.1/4.2 (SSE); all GWT scenarios used as verification
server/src/agent/service.ts — existing DI pattern; `triggerExecution` body (token batching, insertOutput, insertCard, updateBoard patterns); `AgentBoardServiceDeps` interface structure; `getTemplate` already imported
server/src/agent/templates.ts — `renderSystemPrompt`, `buildVarsMap`, `findUnresolvedPlaceholders` (from T1); `getTemplate`
server/src/core/position.test.ts — Vitest describe/it/expect test pattern for reference
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Justification: 2 files modified (service.ts + new test), 200–250 lines of implementation. Multi-concern (loop + resolution + fail-closed + SSE) but all within one method in one file — splitting would require artificial shared state. Template lookup via `getTemplate` (already imported) keeps core template-agnostic.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: `executeCard` signature in llm.ts must NOT change — call it with `(rendered, intent, [], reasoning, onToken)` exactly as today.]
You are implementing the `runPipeline` service method for Agentic Kanban Phase 2.
Spec: docs/pocket/spec/2026-06-14-agentic-kanban-phase2-pipeline/full-pipeline.md
Design decision: Option C — pure functions from T1's templates.ts; loop in service.ts; executeCard gets the fully-rendered prompt and `previousOutputs=[]`.
Files in scope: `server/src/agent/service.ts`, `server/src/agent/service.test.ts` — no other files.
Test framework: Vitest — DI doubles for all deps; no real DB, no real API key in unit tests.
Available after: T1 (`buildVarsMap`, `findUnresolvedPlaceholders`, `output_key` on TemplateColumn)
Architecture rule: All agent card outputs → `agent_card_outputs` (via `insertOutput`), NEVER `card_events`. Core stays template-agnostic — use `getTemplate(board.templateId)` to resolve `output_key`; no slug names hardcoded in the loop. Do NOT remove `triggerExecution` — T3 will update the call site in routes.ts.
[RESTATE: `executeCard` signature in llm.ts must NOT change — call with `(rendered, intent, [], reasoning, onToken)` exactly.]

## DELIVERABLE
Given an approved research-report board with intent "Analyze the EV battery market", When runPipeline runs, Then cards execute in position order (research-specialist, analysis-specialist, writer, editor, qa-guardian), each output persists to `agent_card_outputs` with `card_index` 0..4 before the next card runs, and `updateBoard({execution_status:'done'})` is called after qa-guardian completes.
Given research-specialist produced "BRIEF…" (output_key research_output) and analysis-specialist produced "ANALYSIS…" (output_key analysis_output), When writer renders its prompt, Then the `systemPrompt` arg passed to `executeCard` contains neither literal `{research_output}` nor `{analysis_output}` nor `{topic}`.
Given a running pipeline, When each card starts, Then `agent.card.started{columnSlug}` is emitted before `executeCard`; `agent.card.token{columnSlug,token}` is emitted during; `agent.card.done{columnSlug}` is emitted after `insertOutput`.
[must-not] Given resolving placeholders, When core runs, Then it must NOT reference slug strings like 'research-specialist' or key strings like 'research_output' hardcoded in service logic.
Given a card prompt references `{reserch_output}` (typo; not in accumulator, not a built-in), When the card is about to execute, Then pipeline halts BEFORE executeCard; `updateBoard({execution_status:'failed'})`; `agent.card.failed{columnSlug, reason}` emitted naming the unresolved placeholder; `insertOutput` called with empty output for that card; subsequent cards do NOT run.
Given writer's LLM call returns "" (whitespace-only), When card completes and `output.trim().length===0`, Then pipeline halts; board 'failed'; partial row persisted; editor and qa-guardian do NOT run.
Given analysis-specialist's `executeCard` call throws, When it rejects, Then research-specialist's `insertOutput` (card_index 0) was already called and remains; board 'failed'; `agent.card.failed{columnSlug:'analysis-specialist'}` emitted; writer, editor, qa-guardian do NOT run.

All tests PASS. Commit exists with message `feat(agent): implement runPipeline — sequential loop, named resolution, fail-closed, per-card SSE`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `runPipeline` is a method on the service object returned by `createAgentBoardService`
  - `ColumnInfo` interface and `getColumns` dep exported from service.ts
  - Token batching interval cleared on BOTH success and failure of each card
  - `insertOutput` always called for the failing card (partial row audit) on all three halt triggers
  - `executeCard` receives `previousOutputs: []` (not the old blob approach)
  - Tests written BEFORE implementation (TDD — not after)
  - Commit message follows conventional commits format

Must-not-have:
  - Any change to `executeCard` in llm.ts
  - Any hardcoded slug or output_key string in the loop logic
  - Writing output to `card_events` (must go to `agent_card_outputs` only)
  - Removing `triggerExecution` from the service (T3 handles the call-site update)
  - Parallel card execution (loop is strictly sequential: `await` each card before advancing)

Open question risks:
  - `insertOutput` throws mid-loop → treated as LLM error path (same fail-closed catch block). If this causes unexpected behavior: report NEEDS_CONTEXT.
  - `{previous_output}` on multi-predecessor cards (writer) — assumed: not relied on, writer uses named keys. If wrong: report NEEDS_CONTEXT.

Rollback note:
  - Additive (`runPipeline` is a new method). To revert: remove `runPipeline` and restore routes.ts to call `triggerExecution` (T3 reversal). No DB migration needed.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: `{previous_output}` multi-predecessor assumption is challenged
Escalate when: any file outside service.ts / service.test.ts needs changing; any change to executeCard signature proposed

---

### Task 3: routes.ts wiring — getColumns dep + call-site update [depends: T2]

## OBJECTIVE
Update `server/src/agent/routes.ts`:
1. Add `getColumns` implementation to `realDeps` — SQL query returning all columns for a board ordered by position, mapped to `ColumnInfo`.
2. Update the approve route's fire-and-forget call from `service.triggerExecution` to `service.runPipeline`.

No new behavioral logic — this is plumbing that connects the real PostgreSQL data to the service interface defined in T2.

Files:
- Modify: `server/src/agent/routes.ts`

Steps:
1. Verify type correctness — this is a structural wiring task with no new behavioral GWT.
   [no-tdd — structural task]
   Verification command: `cd server && npx tsc --noEmit`
   The `getColumns` implementation in `realDeps` must satisfy the `ColumnInfo[]` return type from T2.

2. Implement changes to `server/src/agent/routes.ts`:

   **Step 2a — Add `getColumns` to `realDeps`** (after the existing `getFirstCard` implementation):
   ```typescript
   getColumns: async (boardId) => {
     const { rows } = await pool.query(
       `SELECT id, slug, system_prompt, reasoning
        FROM columns
        WHERE board_id = $1
        ORDER BY position`,
       [boardId],
     );
     return rows.map((r: Record<string, unknown>) => ({
       columnId: r.id as number,
       columnSlug: r.slug as string,
       systemPrompt: r.system_prompt as string,
       reasoning: r.reasoning as boolean,
     }));
   },
   ```

   **Step 2b — Update approve route call site** (line ~339, inside the fire-and-forget block):
   Change:
   ```typescript
   service.triggerExecution({ boardId, workspaceId }).catch((err) => {
     console.error("agent triggerExecution error:", err);
   });
   ```
   To:
   ```typescript
   service.runPipeline({ boardId, workspaceId }).catch((err) => {
     console.error("agent runPipeline error:", err);
   });
   ```

3. Verify — TypeScript compilation clean:
   `cd server && npx tsc --noEmit`
   Expected: 0 errors

4. Commit:
   `git add server/src/agent/routes.ts`
   `git commit -m "feat(agent): wire getColumns realDep and update approve route to call runPipeline"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-14-agentic-kanban-phase2-pipeline/full-pipeline.md — rule: 1.1 (loop), implementation notes: "realDeps.getFirstCard → needs an ordered getColumns(boardId)"
server/src/agent/routes.ts — existing `getFirstCard` realDep (lines 160–176) as pattern for `getColumns`; approve route call site (line ~339)
server/src/agent/service.ts — `ColumnInfo` interface and `AgentBoardServiceDeps.getColumns` type (from T2)
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Justification: 1 file, ~20 lines of SQL plumbing + 2-line call-site update. No logic — follows established `getFirstCard` SQL query pattern exactly.
Complexity: lightweight

## SANDWICH CONTEXT
[CRITICAL: Do NOT modify `getFirstCard` realDep — only ADD `getColumns`. Removing getFirstCard could break anything still referencing it.]
You are wiring the routes.ts real dependencies for Agentic Kanban Phase 2.
Spec: docs/pocket/spec/2026-06-14-agentic-kanban-phase2-pipeline/full-pipeline.md
Design decision: Option C — getColumns returns all columns ordered by position; service handles template lookup for output_key.
Files in scope: `server/src/agent/routes.ts` only — no other files.
Available after: T2 (`ColumnInfo`, `getColumns` dep type, `runPipeline` method on service)
Architecture rule: SQL query must ORDER BY position (same as existing getFirstCard does with LIMIT 1). No business logic in realDeps — pure DB access only.
[RESTATE: Do NOT modify `getFirstCard` realDep — only ADD `getColumns`. Keep both.]

## DELIVERABLE
[derived] Given a board with 5 columns at positions 1–5, When `getColumns(boardId)` is called, Then it returns all 5 columns in ascending position order as `ColumnInfo[]` with correct `columnId`, `columnSlug`, `systemPrompt`, `reasoning` fields.
[derived] Given the approve route fires, When `service.runPipeline({ boardId, workspaceId })` is called fire-and-forget, Then the app server starts and TypeScript compilation reports 0 errors.
`cd server && npx tsc --noEmit` exits with code 0.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `getColumns` added to `realDeps` and returns `ColumnInfo[]` matching T2's type
  - SQL uses `ORDER BY position` (no LIMIT)
  - Call site in approve route updated to `service.runPipeline`
  - `npx tsc --noEmit` exits 0

Must-not-have:
  - Any removal of `getFirstCard` from realDeps
  - Any business logic in the `getColumns` realDep implementation
  - Any other file modified

Open question risks:
  - None — pure plumbing with established patterns

Rollback note:
  - Revert routes.ts changes to restore `triggerExecution` call and remove `getColumns`.

## STOP CONDITIONS
Done when: DELIVERABLE verifications pass, tsc clean, commit created
Uncertain when: `ColumnInfo` type from T2 is not yet available (T3 depends on T2)
Escalate when: any file outside routes.ts needs changing; tsc reports errors not fixable by adjusting the getColumns mapping

---

### Task 4: Headless live-LLM integration test [depends: T2] [parallel: T3]

## OBJECTIVE
Create `server/src/agent/pipeline.integration.test.ts` — an opt-in integration test that runs `runPipeline` against the live Anthropic LLM (real `executeCard`) with in-memory DI doubles for DB/SSE. Gated by env flag `RUN_LLM_IT=1`; default `vitest run` skips it entirely (no network call, no API key required).

The test asserts structural invariants (non-deterministic-safe):
- 5 outputs accumulated in memory with card_index 0..4, board ends 'done'
- No captured `systemPrompt` and no stored output matches `/\{[a-z][a-z0-9_]*\}/` (the "no-leak" crown jewel assertion)
- Every output `trim().length > 0`
- Test is SKIPPED when `RUN_LLM_IT` is unset

Also add `test:integration` script to `server/package.json`.

Files:
- Create: `server/src/agent/pipeline.integration.test.ts`
- Modify: `server/package.json`

Steps:
1. TDD framing for the integration test:

   **The failing condition:** Running `cd server && npx vitest run src/agent/pipeline.integration.test.ts` against an empty or non-existent file fails immediately with a module-not-found error or 0 test files found error.

   **The first green state (skeleton gate):** Once the file exists with `describe.skipIf(!process.env.RUN_LLM_IT)(...)`, running without the flag shows the describe block as SKIPPED, exits 0, and makes zero real API calls. This is the dry-run skip gate — the TDD "passing skeleton" before the full implementation is verified live.

   **The full implementation** is in Step 3a below. It IS the complete test file. The failing-first aspect is:
   - No file → `vitest run` fails (file not found) = RED
   - File exists with skipIf gate, no flag → exits 0, SKIPPED = first GREEN (dry run)
   - File exists with flag set + working API key → executes 5 live LLM calls, all assertions pass = DONE

   **The test-as-skeleton:** The test structure is the complete file in Step 3a. Write it in full at Step 1 (the dry-run skip verifies the gate before any live execution is possible).

2. Run dry (verify skip when RUN_LLM_IT unset):
   `cd server && npx vitest run src/agent/pipeline.integration.test.ts`
   Expected: test suite exits 0, live-LLM describe block is skipped (0 tests run or 1 skipped), no network call made

3. Implement integration test file and package.json script:

   **Step 3a — Full `pipeline.integration.test.ts` content:**
   ```typescript
   import "dotenv/config";
   import { describe, expect, it, vi } from "vitest";
   import { createAgentBoardService } from "./service.js";
   import type { ColumnInfo } from "./service.js";
   import { executeCard as realExecuteCard } from "./llm.js";
   import { getTemplate } from "./templates.js";

   const INTENT = "Explain quantum computing to a business executive";

   const template = getTemplate("research-report")!;
   const mockColumns: ColumnInfo[] = template.columns.map((c) => ({
     columnId: c.position,
     columnSlug: c.slug,
     systemPrompt: c.system_prompt,
     reasoning: c.reasoning,
   }));

   describe.skipIf(!process.env.RUN_LLM_IT)(
     "Live-LLM pipeline: runPipeline end-to-end",
     { timeout: 900_000 },
     () => {
       it("runs all 5 cards, accumulates outputs, and leaves no placeholder leaks", async () => {
         const captured: {
           outputs: Array<{ columnSlug: string; cardIndex: number; output: string }>;
           prompts: string[];
           boardStatus: string;
           events: Array<Record<string, unknown>>;
         } = { outputs: [], prompts: [], boardStatus: "running", events: [] };

         const executeCardSpy = vi.fn(
           async (
             systemPrompt: string,
             intent: string,
             previousOutputs: string[],
             reasoning: boolean,
             onToken: (token: string) => void,
           ) => {
             captured.prompts.push(systemPrompt);
             return realExecuteCard(systemPrompt, intent, previousOutputs, reasoning, onToken);
           },
         );

         const service = createAgentBoardService({
           getBoard: async () => ({
             id: 1,
             workspaceId: 1,
             userId: 1,
             templateId: "research-report",
             originalIntent: INTENT,
             status: "approved",
             executionStatus: "running",
           }),
           getColumns: async () => mockColumns,
           insertOutput: async (data) => {
             captured.outputs.push({
               columnSlug: data.columnSlug,
               cardIndex: data.cardIndex,
               output: data.output,
             });
           },
           insertCard: async () => {},
           updateBoard: async (_id, data) => {
             if (data.execution_status) {
               captured.boardStatus = data.execution_status as string;
             }
           },
           publishEvent: async (_wid, event) => {
             captured.events.push(event);
           },
           executeCard: executeCardSpy,
         });

         await service.runPipeline({ boardId: 1, workspaceId: 1 });

         // Structural invariants (non-deterministic-safe — no exact text assertions)
         expect(captured.outputs).toHaveLength(5);
         expect(captured.boardStatus).toBe("done");

         const PLACEHOLDER_RE = /\{[a-z][a-z0-9_]*\}/;

         for (const prompt of captured.prompts) {
           expect(prompt).not.toMatch(PLACEHOLDER_RE);
         }
         for (const { output } of captured.outputs) {
           expect(output.trim().length).toBeGreaterThan(0);
           expect(output).not.toMatch(PLACEHOLDER_RE);
         }

         // card_index sequence
         const indices = captured.outputs.map((o) => o.cardIndex).sort((a, b) => a - b);
         expect(indices).toEqual([0, 1, 2, 3, 4]);
       });
     },
   );
   ```

   **Step 3b — Add `test:integration` script to `server/package.json`:**
   Add to `"scripts"`:
   ```json
   "test:integration": "RUN_LLM_IT=1 vitest run src/agent/pipeline.integration.test.ts"
   ```

4. Run dry again — verify skip:
   `cd server && npx vitest run src/agent/pipeline.integration.test.ts`
   Expected: exits 0, no real API call, live test skipped

5. Commit:
   `git add server/src/agent/pipeline.integration.test.ts server/package.json`
   `git commit -m "test(agent): add opt-in headless live-LLM integration test for runPipeline"`

## REFERENCES LOADED
docs/pocket/spec/2026-06-14-agentic-kanban-phase2-pipeline/full-pipeline.md — rule: 5.1 (opt-in skip), 5.2 (real executeCard + in-memory DI), 5.3 (structural assertions), 5.4 (timeout); "Crown jewel" no-leak assertion; implementation notes for integration test
server/src/agent/service.ts — `createAgentBoardService`, `ColumnInfo`, `runPipeline` signature (from T2)
server/src/agent/llm.ts — `executeCard` function signature (real, to be wrapped by spy)
server/src/agent/templates.ts — `getTemplate` for building `mockColumns` from the live template definition (from T1)
server/package.json — existing scripts section; `dotenv` ^17.4.2 is present
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Justification: 1 new file + 1-line package.json change. The test IS the deliverable for Story 5. In-memory DI doubles follow the service's own design intent. `describe.skipIf` is the idiomatic Vitest gate — zero network calls without the flag. The spy wraps the real `executeCard` so the no-leak assertion is against actual rendered prompts.
Complexity: standard

## SANDWICH CONTEXT
[CRITICAL: Default `vitest run` (npm test) must make zero real API calls. The live test must ONLY run when `RUN_LLM_IT=1` is explicitly set.]
You are implementing the opt-in integration test for Agentic Kanban Phase 2.
Spec: docs/pocket/spec/2026-06-14-agentic-kanban-phase2-pipeline/full-pipeline.md
Design decision: Option C — real `executeCard` from llm.ts; in-memory doubles for DB/SSE. `describe.skipIf(!process.env.RUN_LLM_IT)` gate.
Files in scope: `server/src/agent/pipeline.integration.test.ts` (new), `server/package.json` — no other files.
Test framework: Vitest with `vi.fn()` for the spy. `import "dotenv/config"` at the top so `ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` from `server/.env` are available.
Available after: T2 (`createAgentBoardService`, `runPipeline`, `ColumnInfo`)
Architecture rule: No Postgres, no Redis in this test — all external deps are in-memory doubles. `executeCard` spy MUST delegate to the real `executeCard` (not mock the response). Assertions must be structural invariants only — no exact LLM output text.
[RESTATE: Default `vitest run` must make zero real API calls. The live test must ONLY run when `RUN_LLM_IT=1`.]

## DELIVERABLE
Given `RUN_LLM_IT` is unset, When `vitest run src/agent/pipeline.integration.test.ts` runs, Then the test suite exits 0 and no real Anthropic API call is made (Rule 5.1).
Given `RUN_LLM_IT=1` and `server/.env` provides a working `ANTHROPIC_API_KEY`, When `runPipeline` executes the research-report board for the fixed intent, Then `captured.outputs.length === 5` and `captured.boardStatus === 'done'` (Rule 5.3-D).
Given the same run, When `captured.prompts` and `captured.outputs` are inspected, Then NONE match `/\{[a-z][a-z0-9_]*\}/` — writer prompt contains real research and analysis text, not literal `{research_output}` or `{analysis_output}` (Rule 5.3-E — crown jewel).
Given the same run, When each output is checked, Then `output.trim().length > 0` for all 5 cards (Rule 5.3-F).

All tests PASS (or SKIPPED when flag absent). Commit exists with message `test(agent): add opt-in headless live-LLM integration test for runPipeline`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `describe.skipIf(!process.env.RUN_LLM_IT)` gate — not `it.skip`, not a manual `if` statement
  - `{ timeout: 900_000 }` on the describe or the it
  - `import "dotenv/config"` at the top of the test file
  - `executeCard` spy delegates to the REAL `executeCard` from llm.ts (not a mock return)
  - No-leak assertion uses `/\{[a-z][a-z0-9_]*\}/` regex — matches the spec
  - `test:integration` script added to server/package.json
  - Commit message follows conventional commits format

Must-not-have:
  - Any use of `vi.fn().mockResolvedValue(...)` for `executeCard` — it must delegate to the real function
  - Any assertion on exact LLM output text (LLM is non-deterministic)
  - Any Postgres or Redis connection in this test
  - Modifying any file other than the two listed

Open question risks:
  - `ANTHROPIC_BASE_URL` set in server/.env → `NATIVE=false` (MiMo) → `reasoning` is a no-op. This is expected and consistent with unit test behavior.
  - If `server/.env` is missing or API key invalid when `RUN_LLM_IT=1`, the test will fail. This is correct — the test requires a working API key when opted in.

Rollback note:
  - Remove the integration test file and revert the package.json script addition.

## STOP CONDITIONS
Done when: dry run (no flag) exits 0 with test SKIPPED; commit created; no network calls observed in dry run
Uncertain when: `getTemplate('research-report')` returns null (would break mockColumns — check T1 completed)
Escalate when: `describe.skipIf` is not available in the installed Vitest version; any file outside scope needs changing

---

## Plan Summary

| Task | Name | Depends | Complexity | TDD Order | Key Verification |
|------|------|---------|------------|-----------|-----------------|
| T1 | Pure resolver layer in templates.ts | prereq | lightweight | test → fail → implement → pass → commit ✅ | buildVarsMap + findUnresolvedPlaceholders unit tests pass |
| T2 | runPipeline loop in service.ts | T1 | standard | test → fail → implement → pass → commit ✅ | 6-case service tests: loop, resolution, SSE, 3x fail-closed |
| T3 | routes.ts wiring | T2 | lightweight | [no-tdd] → implement → tsc verify → commit ✅ | `npx tsc --noEmit` exits 0 |
| T4 | Headless live-LLM integration test | T2 | standard | write file → dry-run skip → (opt-in run passes) → commit ✅ | dry run skips cleanly; `RUN_LLM_IT=1` run passes no-leak assertion |
