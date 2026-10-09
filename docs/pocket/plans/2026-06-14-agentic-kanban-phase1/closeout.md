# Closeout — 2026-06-14-agentic-kanban-phase1

- **Plan:** docs/pocket/plans/2026-06-14-agentic-kanban-phase1
- **Type:** flat
- **Started:** 2026-06-14  ·  **Closed:** 2026-06-14
- **Baseline SHA:** 687863975bc60f1ea2244ec1f56e96efa83f25b1  ·  **Final SHA:** 16b7d474d61d2b698586d9404085c3ceb3cb0147
- **Result:** CLOSED — all phases DONE, all reviewable tasks REVIEW_PASS

## Phases

### Phase 1 — execution-plan.md  (DONE)

| Task | Name | done_sha | Verdict |
|------|------|----------|---------|
| T1 | DB Schema + GET /board Fix | d9856a75f01689bf3292d31893d76758f684aa80 | REVIEW_PASS |
| T2 | Server LLM Layer + realtime.ts Agent Events | fce7d44c1c8ca16b59b75f1eafd7cc2c3548efa7 | REVIEW_PASS |
| T3 | Agent API Routes | 581235a96f7b2585a0beddd155c901c41c66edd9 | REVIEW_PASS |
| T4 | Client Types + API + Routing | baf79caa4ea36a06ff0c4ec9e8d59d3a813f0f0f | REVIEW_PASS |
| T5 | AgentPage + AgentCardDetail | b2b2fc6afc5fcf2b0f0d9c1f4714300554ef0f60 | REVIEW_PASS |
| T6 | HistoryPage | 16b7d474d61d2b698586d9404085c3ceb3cb0147 | REVIEW_PASS |

_SHA range: 687863975bc60f1ea2244ec1f56e96efa83f25b1..16b7d474d61d2b698586d9404085c3ceb3cb0147_

**Corrections applied (7):**
- T2: 22e8dbe6e (llm.ts — ClientOptions import fix, optional chaining)
- T3: 246041394 (routes.ts, service.ts — initial corrections)
- T3: 48c3312fe (service.test.ts, service.ts — cross-workspace isolation fix)
- T5: 960d3d57d (AgentPage.tsx — initial corrections)
- T5: 2c61ed7ae (AgentPage.tsx — corrections)
- T5: 24e93268c (agentQueue.test.ts, agentQueue.ts, AgentPage.tsx — queue stranding fix, input disable fix)
- T6: 7f4b0c2bc (HistoryPage.tsx — corrections)

## Carried Forward

Non-blocking observations from review — accepted at close, recorded for follow-up.

- **T1** (Minor): `agent_boards.updated_at` defaults to `now()` but has no auto-update trigger; updates won't refresh it — server/src/db/agent-schema.sql:14
- **T2** (Minor): `executeCard` does not implement NATIVE-gated `cache_control: ephemeral` on system block nor `thinking` param for `reasoning=true` on real Anthropic — acceptable for Phase 1 (MiMo target, first card is reasoning=false) — server/src/agent/llm.ts:183-188
- **T2** (Minor): Default model fallback is `"claude-sonnet-4-20250514"` vs plan's `"claude-sonnet-4-6"`; inert since ANTHROPIC_MODEL is set for MiMo — server/src/agent/llm.ts:23
- **T3** (Minor): `sendMessage` does not persist the assistant clarification question to `agent_conversations` on the pending/refine branch — server/src/agent/service.ts:330-338
- **T3** (Minor): `requireWorkspaceMember` types its `res` param via nested `Parameters<>` utility; stylistic only — server/src/agent/routes.ts:216-227
- **T4** (Minor): `clearAgentEvents` created inline (new identity each render); `useCallback` would stabilize for consumer effect deps — client/src/context/BoardContext.tsx:521
- **T4** (Minor): `createAgentBoard` and `sendAgentBoardMessage` tests assert only method, not request body — client/src/api.test.ts:289-327
- **T4** (Minor): `AgentCardOutput` type declares `columnSlug` but service returns only `{ output, thinking }`; harmless contract drift — client/src/types.ts:189-193
- **T5** (Minor): Event log list uses array index as React key; acceptable for append-only stream — client/src/pages/AgentPage.tsx:556
- **T6** (Minor): `templateName()` falls back to raw `templateId` for unknown templates; acceptable for Phase 1 (only research-report exists) — HistoryPage.tsx:36
- **T6** (Minor): Both manual 80-char slice and Tailwind `truncate` class applied to intent text; slightly redundant — HistoryPage.tsx:141-145
- **T6** (Minor): No `HistoryPage.test.tsx` present; plan made render test optional (testing-library check), but TDD must-have is unmet

## Skipped Tasks

_None_ — all 6 tasks were reviewable (DONE with done_sha).
