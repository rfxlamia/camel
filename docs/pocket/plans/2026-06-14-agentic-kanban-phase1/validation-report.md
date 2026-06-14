# Plan Validation Report: Agentic Kanban Phase 1

**Plan:** `docs/pocket/plans/2026-06-14-agentic-kanban-phase1/execution-plan.md`
**Validated:** 2026-06-14
**Method:** DRY / YAGNI / TDD review + codebase-aware gap analysis (claims verified against real source)
**Resolution:** ✅ All findings (4 CRITICAL + 4 WARNING + 4 INFO) applied to `execution-plan.md` on 2026-06-14. Post-fix grade: **A-** (execute-ready).

---

## Executive Summary

- **Critical Issues:** 4 (blockers — must fix before execution)
- **Warnings:** 4 (should fix)
- **Info:** 4 (nice to have)
- **Overall Grade: D — NOT execute-ready**

The plan is well-structured (good TDD ordering, DI pattern reuse, clear sandwich context). But four defects share one failure mode: **the unit test is green while the real code path is broken.** Each blocker passes its own test yet fails the actual Phase-1 hypothesis ("approve → one agent produces real output"). Fix the four CRITICALs and this becomes a strong plan.

---

## 🚨 CRITICAL (blockers)

### C1 — T1 test is a tautology; the GET /board isolation fix has zero real coverage
T1's stated deliverable is *"GET /board excludes agent columns (board_id IS NOT NULL)."* The test (plan L121-150) does not exercise that change:
- It mocks `getBoardRows` entirely, returning exactly 2 fabricated rows → `toHaveLength(2)` is trivially true.
- Rows use snake_case `board_id`, but the assertion checks `col.boardId` → `undefined` for every row, so `every(... === undefined || === null)` can **never fail**.
- The real GET /board (`server/src/routes.ts:686-688`) is a **raw `pool.query`** that does *not* route through `createScopedBoardService.getBoard`. The test imports a service the endpoint never uses.

Net: the test passes whether or not the `AND board_id IS NULL` filter is ever added. The red-green premise is broken on the plan's single most critical change.
**Fix:** Test the real query. Either (a) an integration-style test that inserts a column with `board_id` set and asserts GET /board omits it, or (b) extract the column query into a testable function and assert the WHERE clause is applied. The mock-only test must be replaced, not just supplemented.

### C2 — Agent column metadata has nowhere to be stored
`agent-schema.sql` (T1) only runs `ALTER TABLE columns ADD COLUMN board_id`. But:
- T3 `insertColumns` writes `{ slug, name, position, reasoning, systemPrompt }`
- T3 `getFirstCard` returns `{ columnSlug, systemPrompt, reasoning }`
- T4 `AgentColumn` expects `slug / reasoning / systemPrompt`
- T5 `AgentCardDetail` (Story 4) renders `system_prompt` + reasoning badge

The `columns` table has no `slug`, `reasoning`, or `system_prompt` fields. There is nowhere to store or read this data — the card-detail panel and execution both depend on it.
**Fix:** Pick one and write it into the plan: (a) add `slug/reasoning/system_prompt` columns to the schema, or (b) **derive at runtime from `template_id` + position via `templates.ts`** (cleaner — single source of truth, no denormalized prompt copies). The plan currently specifies neither.

### C3 — Approval executes the agent with an empty intent
T3's approve route (plan L679) fires `service.triggerExecution({ boardId, workspaceId, intent: "" })`. `triggerExecution` feeds `intent` straight into `executeCard` as the user message. `approveBoard`'s `getBoard` dep never returns `original_intent`, and no step loads it before execution. So the one agent meant to produce real output — the entire Phase-1 validation — runs on `""`.
The unit test masks this: `triggerExecution` is tested with `intent: "riset fintech"`, a value the real route never passes.
**Fix:** Load `original_intent` from the board (in approve, or at the start of `triggerExecution`) and pass it through. Add a test asserting `executeCard` receives the board's actual intent, not a caller-supplied literal.

### C4 — Agent SSE events are published but never consumed by the client
T2 adds `agent.*` to the `BoardEvent` union; T3 publishes them to `/workspaces/:id/events/stream`. But on the client:
- There is **no `SSEContext` / `useSSE`** — T5's test (plan L1052) mocks a module that does not exist. SSE lives privately inside `BoardContext.tsx`.
- `BoardContext`'s `onmessage` (`BoardContext.tsx:350-383`) ignores unknown event types and calls `void refresh()` on **every** message → each `agent.card.token` would trigger a full human-board refetch, per streamed token.
- No task surfaces agent events to `AgentPage`. The "right panel live progress log" (Story 3 Rule 3, Story 5 Rule 4) has no delivery path.

So events *arrive but are unhandled, plus cause spurious refreshes* — the live execution log cannot work as planned.
**Fix:** Add explicit scope (likely a small new task or T5 expansion): extend `BoardContext`'s handler to expose `agent.*` events to subscribers (and skip `refresh()` for them), or have `AgentPage` consume a dedicated stream. Replace the fictional `SSEContext` mock with the real mechanism.

---

## ⚡ WARNINGS

### W1 — Template placeholders are never substituted
System prompts contain `{original_intent}`, `{previous_output}`, `{research_output}`, `{analysis_output}`, `{writer_output}`, `{editor_output}`. `executeCard` passes `systemPrompt` verbatim and `intent` as a separate user turn — nothing replaces the tokens. The LLM literally reads `The user has requested: {original_intent}`.
**Fix:** Specify the substitution step in T2/T3 (replace placeholders before the call), or rewrite the templates for the pass-intent-as-user-message approach. For Phase-1 thin execution only `{original_intent}` matters, but it must actually be injected.

### W2 — `migrate.ts` only reads `schema.sql`; `agent-schema.sql` will not be applied
`server/src/db/migrate.ts:9` reads `schema.sql` only. The new separate `agent-schema.sql` won't be picked up by `npm run db:migrate`. T1 flags this as a decision point but leaves it unresolved, while the DELIVERABLE asserts "schema applied / tables exist."
**Fix:** Decide explicitly — append the agent DDL to `schema.sql`, or extend `migrate.ts` to apply additional files. Don't leave it to in-task improvisation.

### W3 — T5 and T6 ship with zero test coverage, and miss the pure-reducer extraction
`@testing-library/react` is **not installed** (`npm ls` empty) and no jsdom env is configured. The plan's fallback skips all render tests — so the deepest-complexity UI task (T5) and T6 have no automated verification. The codebase's established pattern is pure functions in `client/src/lib/*.ts` (`workspaceSelection.ts`, `cardPanel.ts`, `title.ts`) as the tested layer.
**Fix:** Extract the **queue state machine** (Story 1 Rule 2 — "queue survives failure, auto-fires after done/fail") into a pure `lib/agentQueue.ts` reducer with unit tests, mirroring `workspaceSelection.ts`. Covers the riskiest UI logic without testing-library. (Optionally add testing-library + jsdom if real render tests are wanted.)

### W4 — Client context field names in T5/T6 are wrong (misleads implementation)
Tests mock `useBoard: () => ({ workspaceId: 1, addToast })`. The real `BoardContextValue` exposes `activeWorkspaceId: number | null` and `showToast` — there is no `workspaceId` or `addToast`. Tests pass (mocked), but the real `AgentPage`/`HistoryPage` must read `activeWorkspaceId` (and guard its `null` case) and call `showToast`.
**Fix:** Correct the field names in the plan's guidance and note the `null` guard on `activeWorkspaceId`.

---

## ✨ INFO

- **I1 — Redundant auth/mount:** T3 mounts `app.use("/api", requireAuth, createAgentRouter(...))` while routes already apply `requireAuth` per-route and `api` is already mounted at `/api`. Redundant double-auth + second mount; mount agent routes alongside `api` without the extra middleware.
- **I2 — Route-path doc drift:** spec + File-Structure Map say `/api/agent/*`, but actual endpoints are `/api/workspaces/:workspaceId/agent/*` (client `api.ts` matches the latter). Implementation is internally consistent; only docs drift.
- **I3 — Lazy convention:** `App.tsx` uses the data-router `lazy:` route-object convention (not `React.lazy`). T4 says "lazy import" generically — follow the existing convention.
- **I4 — Mild YAGNI:** `AgentCard` interface + `cards: AgentCard[]` may be partly speculative for thin (first-card-only) execution, but is plausibly needed for the board visual. Keep, but don't expand.

---

## Codebase Context (verified)

| Plan assumption | Reality |
|---|---|
| `createScopedBoardService` DI pattern | ✅ Exists `routes.ts:123`; good pattern to mirror for `createAgentBoardService` |
| GET /board query at `routes.ts:688` | ✅ Raw `pool.query` (not via the service) — fix goes here |
| `vi.stubGlobal("fetch", …)` in `api.test.ts` | ✅ Confirmed; T4 pattern matches |
| `request<T>` helper in `api.ts` | ✅ `api.ts:26`; reuse confirmed |
| `formatRelativeTime` in `types.ts` | ✅ `types.ts:42`; reuse confirmed |
| `SSEContext` / `useSSE` (T5) | ❌ Does not exist — SSE is private to `BoardContext` |
| `@testing-library/react` (T5/T6) | ❌ Not installed |
| `migrate.ts` applies multiple SQL files | ❌ Reads `schema.sql` only |
| `columns` has slug/reasoning/system_prompt | ❌ Only `board_id` added; metadata homeless |

**Good DRY/TDD already present:** DI service pattern reuse, `request<T>`/`formatRelativeTime` reuse, test-first ordering in every task, pure-function `core/*` left untouched.

---

## Grade Rationale

4 CRITICAL blockers, each defeating its own test, in the path that delivers the Phase-1 hypothesis → cannot grade as execute-ready. **D.** Resolving C1–C4 (and ideally W1–W2) would lift this to **A-** — the structure, sequencing, and pattern discipline are otherwise strong.
