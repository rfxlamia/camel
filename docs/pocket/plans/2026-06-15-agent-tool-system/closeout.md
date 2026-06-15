# Closeout — 2026-06-15-agent-tool-system

- **Plan:** docs/pocket/plans/2026-06-15-agent-tool-system
- **Type:** phased
- **Started:** 2026-06-15  ·  **Closed:** 2026-06-15
- **Baseline SHA:** e76a5ff9f425028d7f622b6928575a1e397b4e64  ·  **Final SHA:** 4e2e7d61978fd02278155503abbbbe1a56371cf6
- **Result:** CLOSED — all phases DONE, all reviewable tasks REVIEW_PASS

## Phases

### Phase 1 — execution-plan-phase-1.md  (DONE)

| Task | Name | done_sha | Verdict |
|------|------|----------|---------|
| T1 | Tool interface + registry foundation | caa8312 | REVIEW_PASS |
| T2 | DB schema + template tool assignment | 5fbf9b5 | REVIEW_PASS |
| T3 | web_search tool (Tavily) | 735136b | REVIEW_PASS |
| T4 | Tool execution loop in executeCard | 725cc67 | REVIEW_PASS |

_SHA range: e76a5ff..725cc67_

### Phase 2 — execution-plan-phase-2.md  (DONE)

| Task | Name | done_sha | Verdict |
|------|------|----------|---------|
| T5 | Wire service.ts — resolve tools, emit SSE, persist trace | d77a426 | REVIEW_PASS |
| T6 | Routes — read tools/budget, persist + replay trace | 58c961b | REVIEW_PASS |
| T7 | Client — tool event types, collection, collapsible trace UI | 4e2e7d6 | REVIEW_PASS |

_SHA range: 725cc67..4e2e7d6_

_Corrections applied (append-only; done_sha unchanged): T5 → e317f14; T6 → 61476152; T7 → 982fc7a, 23ab8f5. Final review verdicts cover the latest owned SHA per task._

## Carried Forward

Non-blocking observations from review — accepted at close, recorded for follow-up.

- **T1** (Minor): `ToolEvent` modeled as a discriminated union (reasoning variant = `{phase, text}`) rather than the flat spec shape with optional `toolName`; better-typed, no consumer breaks — literal spec deviation. — server/src/agent/tools/types.ts:38-41
- **T1** (Minor): TDD test-before-code ordering unverifiable from the squashed SHA range (tests exist and pass). — server/src/agent/tools/registry.test.ts
- **T3** (Minor): Tavily client reconstructed inside the retry loop on each attempt rather than once before it; trivial, no correctness/perf impact. — server/src/agent/tools/webSearch.ts:66
- **T4** (Minor): defensive `UNKNOWN_TOOL` resolution path slightly exceeds the minimal DELIVERABLE; harmless. — server/src/agent/llm.ts:408-423
- **T4** (Minor): iteration-cap comment under-describes the actual `2*toolBudget+1` bound (cosmetic). — server/src/agent/llm.ts:346
- **T5** (Minor): out-of-scope server typecheck error at llm.ts:354 (`AnthropicToolDef.input_schema` missing `type`); a T4 file, the three in-scope files typecheck clean. — server/src/agent/llm.ts:354
- **T5** (Minor): `onToolEvent` persists one `agent_tool_calls` row per phase event (started + result), so one logical search yields 2 rows — the behavior the embedded test specifies. — server/src/agent/service.ts:342-353
- **T6** (Minor): `realDeps.insertColumns` delegates via a benign type cast; a direct typed adapter would avoid it. — server/src/agent/routes.ts:180
- **T7** (Minor): two uncoordinated writers to `toolTrace` (live derivation vs stored-trace sync); verified harmless for replay/live paths but relies on effect ordering — candidate for consolidation. — client/src/context/BoardContext.tsx:182, client/src/pages/AgentPage.tsx:235
- **T7** (Minor): `ContextPanel` renders the single global `toolTrace` on any opened card rather than scoping to the selected card/column. — client/src/components/ContextPanel.tsx:322-334

## Skipped Tasks

_None_ — every task was reviewable (DONE with a non-empty SHA range).
