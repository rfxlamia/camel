# Agent File Artifact — `create_file` Tool & Deliverable Card

**Date:** 2026-06-16
**Status:** draft
**Author:** pocket-grinding session
**Spec path:** docs/pocket/spec/2026-06-16-agent-file-artifact/create-file-tool.md

---

## Summary

Camel's agent board can run a full research pipeline (Research → Analysis → Writer → Editor → QA Guardian) but has no way to hand the finished document back to the user as a file. This adds a `create_file` tool (LLM-driven, sejajar dengan `web_search`) that the QA Guardian column calls on a PASS verdict, persisting the clean document to a new `agent_artifacts` table and surfacing it as a downloadable `.md` artifact card in the agent panel — clickable into a full-screen reader. The result completes the agent's "deliver something readable" loop.

---

## Context

### Current State
- Pipeline is a **single linear pass** (`server/src/agent/service.ts` `runPipeline` for-loop). No revision loop — QA verdict (`PASS`/`NEEDS REVISION`) is free-text output only; pipeline ends `execution_status="done"` after QA regardless.
- Tool registry holds a single tool: `defaultToolRegistry = createToolRegistry([webSearch])` (`server/src/agent/routes.ts:37`). Columns pick tools via `columns.tools TEXT[]`. Tools run through `executeCardWithTools` (`server/src/agent/llm.ts:368`), a proper Anthropic `tool_use` loop that captures free-form `turnText` **separately** from tool-call blocks.
- Per-column output persists to `agent_card_outputs` (NOT `card_events` — Activity Feed must stay clean). Editor output = `## Editorial Notes` + `---` + `## Revised Document` (the clean document lives in the last section). QA output = verdict + summary only.
- `classifyIntent` (`llm.ts:78`) is a **separate** JSON-only router that picks the template at board creation. Unrelated to column execution.
- No download/export/artifact mechanism exists in server or client. Right panel of `AgentPage` (`client/src/pages/AgentPage.tsx`, `w-96`) is the conversation surface: user bubble → "Agent: Created N columns…" → Execution Log → "Refine the board…" input.

### Problem / Motivation
Output only readable inline per-column. User cannot obtain the final deliverable as a file. Two structural facts shape the design: (1) the clean document is the Editor's `## Revised Document` section, not QA's verdict; (2) `tool.execute(input)` has no board context, so a persisting tool needs `boardId`/`workspaceId` injected.

### Related Areas
- `server/src/agent/tools/` (registry.ts, types.ts, webSearch.ts — tool pattern)
- `server/src/agent/service.ts` (runPipeline, insertOutput, empty-output guard ~line 670)
- `server/src/agent/llm.ts` (executeCardWithTools tool loop; do NOT touch classifyIntent)
- `server/src/agent/templates.ts` (QA Guardian column — add tool + prompt update)
- `server/src/agent/routes.ts` (registry wiring, outputs endpoint auth pattern)
- `server/src/db/agent-schema.sql` (new agent_artifacts table)
- `client/src/pages/AgentPage.tsx` (right panel artifact card), `client/src/components/AgentCardDetail.tsx` (markdown renderer to reuse for modal)
- `docs/pocket/rule/creative-brief.md` (UI tokens)

---

## Scope

### In-Scope
- New `Tool` `create_file` registered in the registry; `format` = `"md"` only; `riskTier: "write"`.
- QA Guardian column gets `tools: ["create_file"]`; system_prompt updated: on **PASS** it calls `create_file` with the clean document body (= Editor's `## Revised Document`); on **NEEDS REVISION** it does NOT call it.
- **Per-execution tool binding** via closure in `service.ts` so `create_file` knows `boardId`/`workspaceId` (no change to `Tool.execute` signature, no change to `webSearch`, no change to `llm.ts`).
- New table `agent_artifacts (id, board_id, workspace_id, filename, format, content, created_at)`; one artifact per board (replace on re-create).
- **A-hardened PASS gating:** primary signal = QA called `create_file` (no text parsing). If not called, parse the `Status:` line of `qa_output`: `PASS` → deterministic fallback extracts `## Revised Document` from `editor_output` and creates the `.md`; `NEEDS REVISION`/ambiguous → no file.
- Filename derived by **backend** from the document H1 (first H1, lowercase, non-alphanumeric→hyphen, collapse, trim, ~80 char cap); no H1 → slug of `original_intent`; empty → `deliverable.md`. LLM-supplied `filename` is ignored for consistency.
- SSE `agent.artifact.ready { boardId }` after insert.
- New endpoints: `GET .../boards/:bid/artifact` (metadata + content) and `GET .../boards/:bid/artifact/download` (octet-stream `.md`), both under existing outputs auth (`requireAuth` + workspace member, 404 cross-workspace).
- Client: on terminal `done` event, fetch artifact; if present render **ArtifactCard** in the right panel below the "Agent" message (doc icon · filename · "Document · MD" · Download). Click card → full-screen modal reusing `AgentCardDetail` markdown renderer. NEEDS REVISION/failed → no card.

### Out-of-Scope
- PDF / DOCX / HTML rendering — deferred (`format` reserved for future; MD only now).
- Google Drive integration — the Drive icon in reference screenshots is visual reference only.
- Artifact edit / versioning — deferred.
- Rerun support — deferred (pipeline is single-pass; no QA re-run after NEEDS REVISION). **Future note:** when rerun lands (user's 2nd+ request), artifact becomes idempotent and the agent gains an `edit_tool` to amend the same file when the follow-up intent relates to the existing answer.
- Retry mechanism for a NEEDS REVISION verdict — deferred.
- `create_file` as a trigger in any column other than QA Guardian.
- Any change to `classifyIntent` (JSON router).

---

## Architecture Constraints

- **May touch:** `agent/tools/` (new tool), `service.ts` (closure binding + fallback + SSE), `templates.ts` (QA tools + prompt), `routes.ts` (endpoints + registry), `agent-schema.sql` (new table), `AgentPage.tsx` + new ArtifactCard/modal, `api.ts`, `types.ts`.
- **Must NOT touch:** `classifyIntent` (JSON router); `card_events`/`agent_card_outputs` schema for artifact storage; `Tool.execute` signature; `webSearch` behavior; `llm.ts` tool-loop.
- **Patterns to follow:** tool shape from `webSearch`; endpoint auth from outputs endpoint (`routes.ts:548`); additive migration (`CREATE TABLE IF NOT EXISTS`); ESM `.js` import extensions; tabs + double quotes (Biome); UI tokens from creative-brief (Work Sans, OKLCH primary/neutral, radius 6px, Button Secondary for Download, "Document · MD" meta in `sm neutral-500`).
- **Architecture validation result:** PASS (Phase 6 checklist all green).

---

## Stories + Scenarios

### Story: Deliver the final document as a file
> As an agent-board user, I want the finished document as a downloadable `.md` I can open in the panel, so that I can read and keep the research output.

**Rule 1: `create_file` fires only from QA Guardian on PASS (primary signal = the tool call)**
- Example A: QA verdict PASS, QA calls `create_file(content=revised doc)` → artifact row created, card shown.
- Example B: QA verdict NEEDS REVISION, QA does not call the tool → no artifact, no card.

```gherkin
Scenario: QA PASS creates artifact
  Given the pipeline reaches QA Guardian and the verdict is PASS
  When  QA calls create_file with content = the Editor's Revised Document body
  Then  one agent_artifacts row is persisted (board_id, workspace_id, filename, "md", content)
  And   SSE agent.artifact.ready { boardId } is published
  And   the QA verdict is still saved to agent_card_outputs as before

Scenario: QA NEEDS REVISION creates no artifact
  Given the QA verdict is NEEDS REVISION
  When  the pipeline finishes (execution_status="done")
  Then  no agent_artifacts row exists for the board
  And   no artifact card appears in the right panel
```

**Rule 2: Backend derives filename from the document H1**
- Example C: `# Mengapa Thailand Memiliki Komunitas Transgender…` → `mengapa-thailand-memiliki-komunitas-transgender.md`
- Example D: no H1 → slug of original_intent; empty → `deliverable.md`

```gherkin
Scenario: Filename from H1
  Given content contains a first H1 heading
  When  the artifact is persisted
  Then  filename = slug(H1) + ".md" (lowercase, hyphenated, ~80 char cap)

Scenario: Filename fallback when no H1
  Given content has no H1 heading
  When  the artifact is persisted
  Then  filename = slug(original_intent) + ".md", or "deliverable.md" if empty
```

**Rule 3: Deterministic fallback (A-hardened) only when tool not called AND verdict parses PASS**

```gherkin
Scenario: PASS but tool not called -> fallback extracts
  Given execution_status="done", the QA Status line parses as PASS, and no artifact row exists
  When  the pipeline finalizes
  Then  the backend extracts the text after "## Revised Document" from editor_output
  And   creates a .md artifact from that clean body

Scenario: NEEDS REVISION and tool not called -> no fallback
  Given the QA Status line parses as NEEDS REVISION and no artifact row exists
  When  the pipeline finalizes
  Then  no artifact is created

Scenario: Editor output lacks the Revised Document heading
  Given the fallback runs but "## Revised Document" is absent
  When  extraction runs
  Then  the leading "## Editorial Notes … ---" block is stripped if present, else editor_output is used whole
  And   the artifact is never created empty
```

**Rule 4: Tool receives correct board context (closure binding)**

```gherkin
Scenario: create_file is board-bound
  Given the QA column resolves tools including create_file
  When  the tool executes
  Then  it persists with the correct boardId and workspaceId (closure-bound in service.ts), not a global
```

**Rule 5: Delivery = artifact card in the right panel -> full-screen modal**

```gherkin
Scenario: Card appears on done
  Given board.executionStatus becomes "done" and an artifact exists
  When  the panel re-fetches on the existing terminal-event watcher
  Then  an artifact card renders below the "Agent" message (filename · "Document · MD" · Download)

Scenario: Open the document
  Given the artifact card is shown
  When  the user clicks the card
  Then  a full-screen modal renders the markdown (reusing the AgentCardDetail renderer)

Scenario: Download the document
  Given the artifact card is shown
  When  the user clicks Download
  Then  the .md file downloads via the download endpoint

Scenario: Failed run shows no card
  Given execution_status="failed"
  Then  no artifact card is shown
```

---

## Acceptance Criteria

```
Rule: create_file fires only from QA on PASS
  ✓ Given verdict PASS, When QA calls create_file, Then one agent_artifacts row + SSE agent.artifact.ready
  ✓ Given verdict PASS, When artifact persists, Then QA verdict still saved to agent_card_outputs
  ✗ Given verdict NEEDS REVISION, When pipeline done, Then no artifact row and no card

Rule: Backend-derived filename
  ✓ Given a first H1, When persisting, Then filename = slug(H1)+".md" (~80 char cap)
  ✓ Given no H1, When persisting, Then filename = slug(original_intent)+".md", else "deliverable.md"

Rule: A-hardened fallback
  ✓ Given done + Status parses PASS + no artifact, When finalizing, Then fallback extracts "## Revised Document" and creates .md
  ✓ Given done + Status parses NEEDS REVISION + no artifact, When finalizing, Then no file
  ✓ Given fallback active + heading absent, When extracting, Then strip Editorial Notes block else use editor_output whole; never create empty

Rule: Board-bound tool
  ✓ Given QA resolves create_file, When executed, Then correct boardId/workspaceId via closure (Tool.execute signature unchanged)

Rule: Delivery surface
  ✓ Given done + artifact exists, When panel re-fetches, Then artifact card in right panel
  ✓ Given card shown, When clicked, Then full-screen markdown modal (reuse AgentCardDetail)
  ✓ Given card shown, When Download clicked, Then .md downloads
  ✗ Given execution_status=failed, When done, Then no card

Rule: Storage isolation & auth
  ✓ Artifacts persist in agent_artifacts, never card_events/agent_card_outputs
  ✗ Given cross-workspace board id, When fetching artifact, Then 404 (matches outputs endpoint)
```

---

## Design Decision

**Chosen option:** Closure-based per-execution tool binding + A-hardened PASS gating.

**Summary:** `service.ts` builds a `boardId`/`workspaceId`-bound `create_file` per run and injects it into the resolved tools array already passed to `executeCard` — so the `Tool.execute` signature, `webSearch`, and the `llm.ts` tool loop are all untouched. PASS is signalled primarily by the tool call itself (no parsing); the `Status:` line is parsed only to gate the rare fallback branch when the tool was not called.

**Rejected options:**
- *Extend `Tool.execute(input, ctx?)`*: rejected — touches the `Tool` interface, `webSearch`, and the `llm.ts` call site for a need only `create_file` has.
- *Pure verdict-text parsing as the sole gate (Option A)*: rejected — fragile to multilingual tokens, format drift, and `FAIL` vs `NEEDS REVISION`; false negatives withhold a successful deliverable.
- *Tool-call as sole signal, no fallback (Option B)*: rejected — loses the safety net; a genuine PASS where the LLM forgets to call the tool yields nothing.
- *Structured `finalize(status, content?)` tool (Option C)*: rejected for now — most robust signal but requires QA to ALWAYS call a tool and adds surface; revisit if A-hardened proves flaky.

**Key tradeoffs accepted:**
- Fallback correctness depends on parsing one labelled `Status:` line — contained, and only consulted when the tool was not called.
- One artifact per board (replace); no history until rerun/versioning lands.
- Filename ignores any LLM suggestion in favour of backend H1 derivation (consistency over flexibility).

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Detect PASS without JSON output | assumed: tool-call primary + `Status:` line parse for fallback gate (A-hardened) | False negative on malformed verbatim + un-called tool → no file in a rare double-failure; safe default = no file |
| QA calls create_file >1× in a run | assumed: one artifact per board, last-write-wins (replace) | Extra calls waste budget; content of last call wins |
| Empty QA output | assumed: existing empty-output guard fails the run (status="failed", no artifact) | User sees failed run with no file — consistent with current behavior |
| create_file content empty/whitespace | assumed: tool returns ok:false, no row; fallback may still run if Status=PASS | No artifact unless fallback recovers from editor_output |
| Content size | assumed: cap ~1MB then reject | Practically bounded by max_tokens; cap is defense-in-depth |
| Download endpoint auth | assumed: mirror outputs endpoint (requireAuth + workspace member, 404 cross-workspace) | Cross-workspace leak if not mirrored |

---

## Implementation Notes
- Apply via `make db-migrate` (runs schema.sql + agent-schema.sql). Table is additive — no change to existing tables.
- Reuse the existing terminal-event watcher in `AgentPage` (re-fetch on `done`/`failed`) rather than adding a new SSE subscription path; `agent.artifact.ready` is a convenience signal, not the only trigger.
- QA Guardian system_prompt must instruct: call `create_file` with the **clean** Revised Document body (no Editorial Notes) on PASS; do not call on NEEDS REVISION. The model — not a regex — supplies clean content on the primary path.
- Markdown reader: reuse `AgentCardDetail`'s renderer; do not introduce a new markdown library.

## Rollback Plan
- Feature is additive. To disable: remove `create_file` from QA column `tools` (or unregister from the registry) — no artifacts created; client card simply never appears (guarded on artifact presence).
- `agent_artifacts` table can remain (harmless) or be dropped; no FK from existing tables depends on it.
