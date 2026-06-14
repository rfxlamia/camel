# Agentic Kanban Phase 2 — Full Pipeline (Named-Output Resolution + Autonomous Loop)

**Date:** 2026-06-14
**Status:** draft
**Author:** pocket-grinding session
**Spec path:** docs/pocket/spec/2026-06-14-agentic-kanban-phase2-pipeline/full-pipeline.md

---

## Summary

The 5-card research-report pipeline (Research → Analysis → Writer → Editor → QA) currently executes only the **first** card. Two root causes: (1) `triggerExecution` runs a single card instead of looping, and (2) `executeCard` receives a generic `previousOutputs: string[]` and only resolves `{original_intent}`, so the template's **named** placeholders (`{research_output}`, `{analysis_output}`, etc.) are never filled. This work adds a server-side autonomous loop that runs all cards sequentially and resolves every named placeholder from a per-card accumulator, in a **template-agnostic** way (templates are slated to become user-authored plugins, so core must not hardcode any template's structure).

---

## Context

### Current State
- `service.triggerExecution` (server/src/agent/service.ts) is fire-and-forget (routes.ts:339) but runs **only the first card** via `getFirstCard`, then sets `execution_status='done'`.
- `executeCard` (llm.ts) renders only `{original_intent}` and appends `previousOutputs` as a `<previous_outputs>` blob in the user message; named system-prompt placeholders are left untouched.
- `renderSystemPrompt` (templates.ts) substitutes `{key}` from a `Record<string,string>` and **leaves unknown placeholders intact** (low-level behavior to preserve).
- `agent_card_outputs` (agent-schema.sql) is keyed by `board_id, column_slug, card_index` — the cross-card accumulator already exists in the DB.
- SSE convention in code is `agent.card.started/token/done/failed` and `agent.board.ready/generating` (NOT the `card:start` naming in the pitch).
- `reasoning:true` cards (analysis-specialist, qa-guardian) are already a no-op: `executeCard` never sets a `thinking` param, so MiMo "skip gracefully" already holds.

### Problem / Motivation
- **Placeholder names do not match producer slugs.** Slug `research-specialist` produces placeholder `research_output`; slug `analysis-specialist` produces `analysis_output`. A slug-keyed map fails. Naming conventions differ across the template: `{previous_output}` (generic, analysis), `{research_output}`/`{analysis_output}` (renamed, writer), `{writer_output}`/`{editor_output}` (slug-derived, editor/qa).
- **`{topic}` leaks as literal text** in Research/Analysis output formats — never resolved today (pre-existing bug, now in scope).
- Writer needs **two** predecessors (research AND analysis), not just the immediate one — confirming the chain must be a full accumulator, not a single previous output.

### Related Areas
- `server/src/agent/service.ts` — `triggerExecution` → becomes `runPipeline` loop.
- `server/src/agent/templates.ts` — `TemplateColumn`, `renderSystemPrompt`; add pure resolver + validator + `output_key`.
- `server/src/agent/routes.ts` — `realDeps.getFirstCard` → needs an ordered `getColumns(boardId)`; approve wiring stays fire-and-forget.
- `server/src/agent/llm.ts` — `executeCard` signature **unchanged**.
- `server/src/db/agent-schema.sql` — no shape change (output_key lives in template code).

---

## Scope

### In-Scope
- Server-side autonomous loop: `runPipeline` executes all template cards in `position` order, sequentially (async/await, fire-and-forget; no spawn, no blocking the event loop).
- Template-agnostic named-output resolution: each `TemplateColumn` declares an `output_key`; the service accumulates `{output_key: output}` as cards complete and resolves each card's prompt against it.
- Built-in placeholders resolved generically by core: `{original_intent}` = board intent, `{previous_output}` = immediately-preceding card's output, `{topic}` = board intent.
- Per-card persistence to `agent_card_outputs` (`column_slug`, `card_index` 0..N) **before** the next card runs; one visual card handle created per column (preview title), as Phase 1 did for the single card.
- SSE per card transition: `agent.card.started` / `agent.card.token` / `agent.card.done` / `agent.card.failed`, each carrying `columnSlug`; token stream live (~200 ms batches) for **all** cards.
- Client fetches final per-card output via the existing `GET .../outputs/:slug` on `done` (DB is source of truth; token stream is display-only, reconnect-safe).
- Fail-closed semantics (3 triggers): (a) LLM call throws, (b) any placeholder unresolved after render, (c) empty output (`output.trim().length === 0`) → halt pipeline, set board `execution_status='failed'`, emit `agent.card.failed` (with `columnSlug` + reason), log the error; remaining cards do NOT run.
- On failure, persist a **partial row** for the failing card (output as-is, possibly empty) for auditability; successful prior cards remain persisted.
- An **opt-in headless integration test** that runs `runPipeline` against the **live LLM** (`server/.env` via dotenv) with in-memory DI doubles for DB/SSE, asserting structural invariants — chiefly that no placeholder leaks into any rendered prompt or output. Gated by a flag/script so default `vitest run` stays mocked and deterministic.

### Out-of-Scope
- Retry UI and resume-on-restart — leave the DB seam (persisted rows + `failed` status) only; do not build resume logic.
- Parallel card execution / DAG scheduler — pipeline is inherently sequential; no `depends_on` metadata.
- Job queue / BullMQ — fire-and-forget is sufficient for a single-server 5–15 min run.
- `{topic}` from dedicated board metadata — resolved to `original_intent` instead.
- Extended thinking / `cache_control` wiring — deferred; `reasoning` stays a no-op.
- Cancellation/abort of a running pipeline.

---

## Architecture Constraints

- Layers this work may touch: `service.ts` (orchestration loop), `templates.ts` (pure resolver + validator + `output_key`), `routes.ts` (ordered column fetch + wiring).
- Layers this work must NOT touch: `executeCard` signature in `llm.ts`; `renderSystemPrompt`'s leave-unknown-intact low-level behavior; `agent_card_outputs` table shape.
- Patterns that must be followed: dependency-injection service; pure-core functions (the new resolver/validator are pure); SSE via `publishEvent`; agent output writes to `agent_card_outputs`, **never** `card_events`; core stays template-agnostic (no hardcoded knowledge of any template).
- Architecture validation result: **PASS** (Phase 6 — all 7 checks green; additive-only, no destructive migration).

---

## Stories + Scenarios

### Story 1: Autonomous pipeline loop
> As the system, after approval I want to run all template cards in order, so the user gets a complete multi-stage result without manual triggering.

**Rule 1.1: Cards run sequentially in `position` order, fire-and-forget.**
- Example A: approved research-report board → research → analysis → writer → editor → qa, one at a time.
- Example B: each card's output persists before the next starts.

```gherkin
Scenario: Happy-path 5-card pipeline
  Given an approved research-report board with intent "Analyze the EV battery market"
  When triggerExecution (runPipeline) runs
  Then cards execute in position order: research-specialist, analysis-specialist, writer, editor, qa-guardian
  And each output persists to agent_card_outputs with card_index 0..4 before the next card runs
  And one visual card (preview title) is created in each column
  And board execution_status becomes 'done' after qa-guardian completes
```

### Story 2: Template-agnostic named-output resolution
> As a (future) plugin author, I want my card to reference predecessor outputs by name so prompts resolve without editing core service code.

**Rule 2.1: Named placeholders resolve from the accumulated `{output_key: output}` map.**
- Example A: writer's `{research_output}` ← research-specialist output; `{analysis_output}` ← analysis-specialist output.
- Example B: a card may reference multiple, non-immediate predecessors (writer needs both research + analysis).

**Rule 2.2: Built-in placeholders are resolved by core for every template.**
- Example C: `{original_intent}` and `{topic}` ← board intent; `{previous_output}` ← immediate predecessor output.

```gherkin
Scenario: Named placeholders resolved from accumulator
  Given research-specialist produced "BRIEF…" (output_key research_output)
  And analysis-specialist produced "ANALYSIS…" (output_key analysis_output)
  When writer renders its prompt
  Then {research_output} = "BRIEF…", {analysis_output} = "ANALYSIS…", {original_intent} = board intent
  And no literal "{research_output}" or "{analysis_output}" remains in the prompt

Scenario: Built-in placeholders
  Given research-specialist (position 1) produced "BRIEF…" and board intent is "Analyze the EV battery market"
  When analysis-specialist (position 2) renders {previous_output} and research-specialist renders {topic}
  Then {previous_output} = "BRIEF…" and {topic} = "Analyze the EV battery market"
```

### Story 3: Fail-closed semantics
> As an operator, I want the pipeline to stop loudly on any bad state so corrupt or empty inputs never silently cascade.

**Rule 3.1: Unresolved placeholder after render → halt before the LLM call.**
**Rule 3.2: Empty output (`trim().length === 0`) → treated as failure.**
**Rule 3.3: LLM call throws → halt; earlier outputs stay persisted.**

```gherkin
Scenario: Unresolved placeholder fails closed
  Given a card prompt references {reserch_output} (typo; no such output_key and not a built-in)
  When the card is about to execute
  Then the pipeline halts BEFORE the LLM call
  And board execution_status = 'failed'
  And agent.card.failed is emitted with columnSlug and a reason naming the unresolved placeholder
  And a partial audit row is persisted for the failing card

Scenario: Empty output halts
  Given writer's LLM call returns "" (or whitespace-only)
  When the card completes and output.trim().length === 0
  Then it is treated as failure: pipeline halts, board 'failed', error logged
  And a partial row is persisted for writer; editor and qa-guardian do NOT run

Scenario: LLM error halts mid-pipeline
  Given analysis-specialist's LLM call throws
  When executeCard rejects
  Then research-specialist output (card_index 0) remains persisted
  And board execution_status = 'failed' and agent.card.failed{columnSlug: analysis-specialist} is emitted
  And writer, editor, qa-guardian do NOT run
```

### Story 4: Real-time visibility
> As a user watching a 5–15 min run, I want per-card progress and live tokens so I can see the pipeline working.

**Rule 4.1: Per card — `started` before, `token` (batched ~200 ms, with columnSlug) during, `done` after persist.**
**Rule 4.2: Client fetches full output via `GET outputs/:slug` on `done`; token stream is display-only.**

```gherkin
Scenario: Per-card SSE + token stream
  Given the pipeline is running the writer card
  Then agent.card.started{columnSlug: writer} is emitted before execution
  And agent.card.token{columnSlug: writer, token} is streamed in ~200 ms batches during execution
  And agent.card.done{columnSlug: writer} is emitted after the output is persisted
  And a client calling GET .../outputs/writer receives the full output
```

### Story 5: Headless live-LLM integration verification
> As a developer worried about undetected bugs, I want an opt-in integration test that runs the real pipeline against the live LLM so placeholder-resolution and chaining bugs surface against actual model output, not just mocks.

**Rule 5.1: Opt-in only — default test run stays mocked and deterministic.**
- Example A: `npm test` / `vitest run` runs unit tests with mocked Anthropic client; the live-LLM test is SKIPPED unless explicitly enabled.
- Example B: enabling is via an env flag (e.g. `RUN_LLM_IT=1`) and/or a dedicated script (e.g. `test:integration`); without it the suite must not call the real API (no key required, no cost, no flake in CI).

**Rule 5.2: Real `executeCard` (live LLM) + in-memory DI doubles for DB/SSE.**
- Example C: the test loads `server/.env` via `import "dotenv/config"` so `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` / `ANTHROPIC_API_KEY` are available; it injects in-memory `insertOutput`/`getColumns`/`getBoard`/`publishEvent` (no Postgres/Redis), and a thin spy that records each `systemPrompt` then delegates to the real `executeCard`.

**Rule 5.3: Assertions are structural invariants, not exact text (LLM output is non-deterministic).**
- Example D: after a full run, the in-memory accumulator has one output per column (`card_index` 0..N-1) and the board ends `execution_status='done'`.
- Example E: **no-leak assertion (the crown jewel)** — no recorded rendered prompt and no persisted output contains a leftover placeholder matching `/\{[a-z][a-z0-9_]*\}/`; specifically the writer prompt contains neither literal `{research_output}` nor `{analysis_output}` nor `{topic}`.
- Example F: every persisted output is non-empty (`output.trim().length > 0`).

**Rule 5.4: Long-running — raise the per-test timeout (~15 min) since 5 live LLM calls run sequentially.**

```gherkin
Scenario: Live-LLM pipeline runs end-to-end with no placeholder leak
  Given RUN_LLM_IT=1 and server/.env provides a working ANTHROPIC_API_KEY
  And in-memory DI doubles stand in for DB and SSE, wrapping the real executeCard with a prompt-recording spy
  When runPipeline executes the research-report board for a fixed intent
  Then all 5 columns produce a non-empty output in the in-memory store (card_index 0..4)
  And no recorded systemPrompt and no output contains a substring matching /\{[a-z][a-z0-9_]*\}/
  And the writer prompt contains the actual research and analysis text (not literal {research_output}/{analysis_output})
  And board execution_status = 'done'

Scenario: Live-LLM test is skipped by default
  Given RUN_LLM_IT is unset
  When the test suite runs
  Then the live-LLM test is skipped and no real Anthropic API call is made
```

---

## Acceptance Criteria

```
Rule: Sequential autonomous loop
  ✓ Given an approved board, When runPipeline runs, Then all cards execute in position order, one at a time
  ✓ Given a running pipeline, When card N completes, Then its output is persisted before card N+1 starts
  ✓ Given all cards succeed, When the last card completes, Then board execution_status = 'done'

Rule: Template-agnostic named-output resolution
  ✓ Given prior outputs in the accumulator, When a card renders, Then {output_key} placeholders are filled from {output_key: output}
  ✓ Given board intent, When any card renders, Then {original_intent} and {topic} = intent, and {previous_output} = immediate predecessor output
  ✓ Given a multi-predecessor card (writer), When it renders, Then both {research_output} and {analysis_output} resolve from the accumulator
  ✗ Given core service code, When resolving placeholders, Then it MUST NOT hardcode any specific template's slugs/keys

Rule: Fail-closed semantics
  ✗ Given a prompt with an unresolved placeholder after render, When about to execute, Then halt before LLM call, board 'failed', agent.card.failed names the placeholder
  ✗ Given a card output with trim().length === 0, When it completes, Then halt, board 'failed', error logged, remaining cards skipped
  ✗ Given executeCard throws, When it rejects, Then halt, board 'failed', earlier outputs remain persisted, remaining cards skipped
  ✓ Given any failure, When the pipeline halts, Then a partial audit row is persisted for the failing card

Rule: Real-time visibility
  ✓ Given a card executes, When it starts/streams/finishes, Then agent.card.started/token/done are emitted with columnSlug
  ✓ Given a card is done, When the client receives done, Then GET outputs/:slug returns the full output

Rule: Headless live-LLM integration verification (opt-in)
  ✓ Given RUN_LLM_IT=1 + server/.env, When runPipeline runs the real LLM, Then all 5 columns produce non-empty outputs (card_index 0..4) and board = 'done'
  ✗ Given the live run, When prompts/outputs are inspected, Then NONE match /\{[a-z][a-z0-9_]*\}/ (no placeholder leak; writer prompt has real research+analysis text)
  ✓ Given RUN_LLM_IT unset, When the suite runs, Then the live-LLM test is skipped and no real API call is made
  ✓ Real executeCard is used (wrapped by a prompt-recording spy); DB/SSE are in-memory DI doubles (no Postgres/Redis)
```

---

## Design Decision

**Chosen option:** Option C — Pure resolver + validator in `templates.ts`.

**Summary:** Add small pure functions to `templates.ts` (build the vars map from the accumulator + built-ins, and detect unresolved placeholders), reusing the existing `renderSystemPrompt`. `service.runPipeline` orchestrates the loop, persistence, and SSE; `executeCard` is unchanged and receives the fully-rendered prompt (`previousOutputs` passed as `[]`). `TemplateColumn` gains an optional `output_key`.

**Rejected options:**
- Option B (executeCard receives a named map): rejected — breaking change to every caller and makes the LLM layer template-aware, violating the template-agnostic constraint at the wrong layer.
- Option A (resolution inline in service): viable and satisfies all scenarios, but resolution/validation logic — the exact contract future plugins depend on — would live inside DI service internals, harder to unit-test and prone to accretion. Kept as fallback if the team prefers minimal surface area.

**Key tradeoffs accepted:**
- One extra (small) abstraction in `templates.ts` vs. inline — justified by the templates-become-plugins vision: the fail-closed validator IS the plugin contract and should be a pure, testable seam.
- `{topic}` mapped to intent (not a separate topic field) — accepted minor imprecision to kill the leak now.

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Where does unresolved-placeholder validation live? | Assumed: pure `findUnresolvedPlaceholders(rendered)` in templates.ts, called by runPipeline before executeCard | Low — internal; movable to service inline (Option A) without behavior change |
| Does `{previous_output}` apply to multi-predecessor cards? | Assumed: no — multi-predecessor cards use named keys; `{previous_output}` is only the single immediate predecessor | Low — matches current template usage |
| Pipeline-complete signal | Assumed: reuse board `execution_status='done'` (+ existing event); no new `agent.pipeline.done` event required | Low — client already reads board status |
| DB write failure mid-loop (insertOutput throws) | Assumed: same fail-closed path — halt + board 'failed' (no retry; retry is out-of-scope) | Medium — a transient DB blip fails the whole run; acceptable for this phase |
| `output_key` field placement | Assumed: optional field on `TemplateColumn` in template code; NOT a DB column | Low — additive, no migration |

---

## Implementation Notes

- `realDeps.getFirstCard` (routes.ts) must be generalized to an ordered `getColumns(boardId)` returning all columns (id, slug, system_prompt, reasoning, output_key, position) sorted by `position`; keep `getFirstCard` or replace at call site.
- `card_index` increments per card (0..N) so the accumulator and persisted rows align with `position`.
- Token batching (`setInterval(200ms)`) from the current single-card path is reused per card; ensure the interval is cleared on both success and failure of each card.
- Built-in placeholder set is the ONLY template knowledge core may hold: `{original_intent}`, `{previous_output}`, `{topic}`. Everything else comes from declared `output_key`s.
- Preserve the "agent output → agent_card_outputs, never card_events" invariant in the loop.

### Integration test (Story 5)
- Runner: vitest (`server/package.json` → `vitest run`). dotenv `^17.4.2` is present and loaded elsewhere via `import "dotenv/config"`; the test file must do the same to read `server/.env` (which already provides `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`, `ANTHROPIC_API_KEY`).
- Gate: read an env flag (suggest `RUN_LLM_IT`) and use `describe.skipIf(!process.env.RUN_LLM_IT)` (or `it.skipIf`) so the live test no-ops by default. Add a `test:integration` script (e.g. `RUN_LLM_IT=1 vitest run <pattern>`) for convenience. Default `npm test` must not hit the network.
- Real LLM, fake infra: build the service via `createAgentBoardService` with in-memory doubles for `getBoard`/`getColumns`/`insertOutput`/`insertCard`/`updateBoard`/`publishEvent`, and inject `executeCard` as a spy wrapping the **real** `executeCard` from `llm.ts` — the spy pushes each `systemPrompt` it receives into a captured array, then delegates. This lets the test assert on the actually-rendered prompts.
- Assertions (non-deterministic-safe): (1) 5 outputs accumulated with `card_index` 0..4 and board `done`; (2) no captured prompt and no stored output matches `/\{[a-z][a-z0-9_]*\}/`; (3) every output `trim().length > 0`. Do NOT assert exact text.
- Timeout: set `testTimeout` to ~900_000 ms for this test (5 sequential live calls). Since `ANTHROPIC_BASE_URL` is set, `NATIVE=false` (MiMo) → `reasoning` cards stay a no-op, consistent with unit behavior.

---

## Rollback Plan

- Additive and non-destructive: no schema migration required (output_key is code-only). To revert, restore the single-card `triggerExecution` and drop the loop/resolver — old boards remain readable.
- No feature flag required, but the loop can be gated behind one if a staged rollout is desired (flag off → run first card only, current behavior).
- Failed runs leave board `execution_status='failed'` + partial rows; safe to re-create a new board rather than resume (resume is out-of-scope).
