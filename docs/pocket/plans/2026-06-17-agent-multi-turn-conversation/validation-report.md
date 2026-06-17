# Plan Validation Report: Agent Multi-Turn Conversation

**Plan:** `docs/pocket/plans/2026-06-17-agent-multi-turn-conversation/execution-plan.md`
**Validated:** 2026-06-17
**Method:** DRY / YAGNI / TDD + codebase-aware gap analysis (verified against actual source, not plan claims)
**Resolution:** ALL findings (CRITICAL #1, WARNINGS #2–6, INFO #1–3) applied to `execution-plan.md` on 2026-06-17. This report is retained as the as-found assessment.

---

## Executive Summary

- **Critical Issues:** 1 — route payload-branching logic has **zero real test coverage** anywhere in the plan, dressed up to look tested.
- **Warnings:** 5 — one security-invariant gap (should-fix), four non-blocking clarifications.
- **Info:** 3
- **Overall Grade:** B

The plan is unusually codebase-aware: signatures, the DI deps contract, the `classifyIntentOnce` parse/retry pattern, `deriveColumnState`, `sendAgentBoardMessage`, `realDeps` wiring, and `runPipeline` reuse all check out against the real files. Architecture is sound (single-instance service so the in-memory `pendingRegenerate` Map survives between requests; no schema changes; reuses existing SSE event shape). DRY and YAGNI are strong.

**What blocks execution:** one structural hole (CRITICAL #1) — fix before starting T3. The ownership-check gap (WARNING #2) is a should-fix. Everything else is clarification that improves quality but does not block.

---

## TDD Analysis

### 🚨 CRITICAL #1 — Route payload logic is untested everywhere (T3 + T7)

T3 is the only task that adds the new `routes.ts` branching (`{action:"confirm_regenerate"}` / `{action:"cancel_regenerate"}` / `{message}` / 400). Its "tests" (plan lines 991–1063) assert nothing about that code:

```typescript
expect(confirmRegenerateBoard).toBeDefined();      // a local vi.fn(), not the route
expect(true).toBe(true);                            // structural placeholder
const expectedSql = /DELETE FROM .../i;
expect(expectedSql).toBeDefined();                  // asserts a regex literal exists
```

These **pass before any implementation exists** — they cannot go RED, so there is no red-green cycle. The plan's own note says "real validation comes from the integration tests (T7)." It does not: **T7 is labeled "T2 + T3" but never invokes the router** — it constructs the *service* with mocked deps and tests `confirmRegenerateBoard`/`cancelRegenerateBoard` directly. The Express handler's payload detection, the 400 path, and the `realDeps` SQL wiring are exercised by nothing.

**Why it matters:** the highest-risk new server logic (request shape → action routing, backward-compat with `{message}`) ships with no executable check.

**Recommended fix (codebase-consistent):** `routes.test.ts` has no precedent for testing a mounted Express route, and supertest is not a dependency — so don't introduce it. The existing convention tests **exported pure helpers** (`getToolTrace`, `runInsertColumns`, `defaultToolRegistry`). Match it: extract the payload→action decision into an exported pure function, e.g.

```typescript
export type MessageAction =
  | { kind: "send"; message: string }
  | { kind: "confirm" }
  | { kind: "cancel" }
  | { kind: "invalid" };

export function resolveMessageAction(body: unknown): MessageAction { … }
```

…and test that directly (real RED on the unimplemented function, real GREEN after). For the `realDeps` SQL, export the new dep functions (or test through a `fakeDb` exactly as `getToolTrace` does) and assert the SQL matches `agent_conversations` / `agent_card_outputs` / the `cards … column_id IN (SELECT … FROM columns WHERE board_id)` shape. **Be honest in the rewritten tests that they cover the branch decision and SQL, not the full request→service wiring** — don't let the replacements overclaim the way the originals do.

### TDD — what's correct

T1, T2, T4, T5 follow proper test-first order (write failing test → run RED → implement → run GREEN → commit) with exact `npx vitest run …` commands and expected outcomes. Mock patterns match the real files (`mockCreate` + `vi.mock("@anthropic-ai/sdk")` for llm; `createAgentBoardService({…vi.fn})` for service; `vi.mock("../api", …)` factory for AgentPage).

---

## Gap Analysis

### ⚡ WARNING #2 — `confirmRegenerateBoard` / `cancelRegenerateBoard` skip the service-layer ownership check (should-fix)

Every other service method validates ownership before mutating: `sendMessage`, `approveBoard`, `getCardOutput`, `getArtifact` all call `getBoard` and check `board.workspaceId === workspaceId` (and `userId` where relevant). The plan's confirm/cancel steps (lines 867–878) read the in-memory Map by `boardId` alone, then call `updateBoard` / `deleteOutputsForBoard` / `deleteCardsForBoard` — **no `getBoard`, no workspace check.** Route-level `requireWorkspaceMember` is only partial mitigation and breaks the service's own invariant (the service is the testable security boundary in this DI design).

**Fix:** in `confirmRegenerateBoard({boardId, workspaceId})`, load the board and verify `board.workspaceId === workspaceId` before any mutation (return 404 on mismatch), mirroring `getCardOutput`. Add a test asserting a cross-workspace `boardId` does not mutate.

### ⚡ WARNING #3 — "Streaming" of ASK/REFINE responses is synthetic, not real token streaming

Spec Rule 5 / Design §3 describe follow-up responses streaming "in real-time" via `agent.card.token`. But `classifyFollowUpIntent` is a single **non-streaming** `messages.create()` returning complete JSON `{intent, response, confidence}` — the response text only exists *after* the call finishes. So T2 can only emit the already-complete `result.response` as one (or chunked) synthetic token event(s); there is no live LLM token stream the way `executeCard` produces. Tests only assert `publishEvent` was called, so they pass — but the implementer should know the intent. State explicitly in T2 that `__notfirst__` tokens are emitted post-hoc.

### ⚡ WARNING #4 — Source of `newIntent` is undefined (T2)

T2 step 3 says `pendingRegenerate.set(boardId, newIntent)`, but `FollowUpResult` carries no extracted topic. The confirm test expects `original_intent: stringContaining("scooter")` from the message "Research scooters instead" → so `newIntent` must be the **raw user `message`**. The plan never says this. Make it explicit: pending value = the user's message.

### ⚡ WARNING #5 — Retry semantics differ from `classifyIntent` (T1)

T1 says retry is the "same pattern as classifyIntent." It is not. `classifyIntent` has a semantic short-circuit (null templateId + non-empty explanation → don't retry). `classifyFollowUpIntent` must retry purely on **parse failure** and fall back to a fixed `OFF_TOPIC` after 3 attempts (per T1 tests, lines 245–287). Reuse the parse *strategies*, not the retry *decision logic*. Reword to avoid a wrong copy of the short-circuit branch.

### ⚡ WARNING #6 — Running-board message must still be stored (T2)

Spec Rule 1 (lines 176–177): for a `running` board the message "is stored in agent_conversations." Current `sendMessage` stores the user message *before* the status branch. The plan's running early-return (T2 step 3) doesn't state whether the message is stored first, and the T2 running test doesn't assert `insertConversation`. Decide explicitly — store before the early-return to honor the scenario, or document the deviation.

---

## Codebase Context (verified)

- `sendMessage({boardId,userId,workspaceId,message})` exists with 404/403 guards; approved boards currently return a static ack (`service.ts:921`). Upgrade target is correct.
- DI deps already present: `getArtifact`, `insertConversation`, `publishEvent`, `updateBoard`, `getColumns`, `executeCard`, `insertOutput`, `insertCard`, `runPipeline`. New deps to add (`classifyFollowUpIntent`, `getConversationHistory`, `deleteOutputsForBoard`, `deleteCardsForBoard`) are genuinely absent. ✓
- `classifyIntentOnce` multi-strategy parse (direct → code-fence → greedy `{[\s\S]*}` → field extraction) + 3-attempt wrapper is real and reusable (`llm.ts:100`). ✓
- `deriveColumnState(events, boardId, slug, executionStatus, hasPersistedOutput=false)` filters on `boardId && columnSlug` at `agentColumnState.ts:14` — the exact line to exclude `__notfirst__`. Plan T5 calls it with 4 args, matching. ✓
- `sendAgentBoardMessage(workspaceId, boardId, message: string)` sends `{message}` (`api.ts:240`). Union-type upgrade is backward compatible. ✓
- `realDeps.getBoard` already maps `execution_status` → `executionStatus` (camelCase in record, snake_case for `updateBoard` writes). Plan's `updateBoard(id,{original_intent})` snake_case usage is consistent. ✓
- **Fire-and-forget convention:** the approve route fires `service.runPipeline(...).catch(...)` and responds immediately (`routes.ts:524`). See INFO #1 — the plan does not say whether `confirmRegenerateBoard` awaits the pipeline or the route fires it; awaiting would block the request for minutes and break this convention.

---

## INFO

1. **Pipeline-trigger ambiguity (confirm flow).** Decide where `runPipeline` is launched: mirror the approve endpoint — `confirmRegenerateBoard` does the synchronous mutations (update intent, delete outputs/cards, store confirmation) and the **route** fires `runPipeline(...).catch(...)`, OR the service fires it internally non-awaited. T7 uses fake timers but never asserts `executeCard`/`getColumns` ran, so "pipeline re-runs" (Rule 4) is verified only via `updateBoard`/delete calls, not actual re-execution — tighten T7 to assert the pipeline was invoked.

2. **T4 api mock will not work as written.** `AgentPage.test.tsx` mocks `../api` with a `vi.mock` factory exposing only `getAgentBoard` + `getAgentArtifact` (lines 29–44). T4's `(apiModule.api as any).sendAgentBoardMessage = fn` mutates a frozen factory object that lacks the method. Add `sendAgentBoardMessage` to the `vi.mock("../api", …)` factory (the file's established pattern) instead of runtime singleton mutation.

3. **T6 substantially duplicates T2.** T6's four "integration" cases (ASK/REFINE/NEW_DIRECTION/OFF_TOPIC through the service) repeat T2's own unit tests in the same file with mocked deps — they are not cross-layer integration. Harmless, but the "integration / T1+T2" framing oversells them; they're additional service unit tests.

---

## DRY Analysis

No violations. Reuses `classifyIntentOnce` parse strategies, `runPipeline`, the existing `agent.card.token` SSE event shape, the DI deps contract, and the `vi.mock`/`mockCreate` test harness. No new npm dependencies; no schema changes. The `__notfirst__` slug convention piggybacks on the existing `columnSlug` filter rather than introducing a new event type.

## YAGNI Analysis

Disciplined. Out-of-scope items (artifact versioning, partial re-run, command syntax, per-type cost optimization, branching, history auto-compact) are explicitly excluded. Option A (single smart handler) chosen over the heavier Option B routing layer. In-memory Map instead of a new table, with the restart trade-off acknowledged. No speculative abstraction.
