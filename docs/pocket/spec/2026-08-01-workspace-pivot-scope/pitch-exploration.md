# Pitch Exploration: workspace-pivot-scope
Date: 2026-08-01 | Project: Camel | Status: pitch-only

---

## Problem Statement
Camel's kanban-only shape doesn't match how the first 1000 beta users actually organize and view work. Two concrete, high-volume signals (10+ requests each): (1) sub-project hierarchy — Project A containing subprojects A1, A2 — and (2) List and Calendar views of the same task data, not just Kanban. A third, softer signal (general Notion-style workspace breadth, incl. docs/pages) has no independent user evidence — it traces back to an option constructed during this session's brand-design interview and picked, not an unprompted request.

## Root Tension
The three sub-asks arrive bundled as one "workspace pivot," but their real cost differs sharply. Calendar view and read-only List view are near-free (spike-confirmed — reuse existing `due_date`/`position`/`PATCH /cards` plumbing). Reorderable List view is not free — no cross-column write path exists today. Sub-project hierarchy is the one genuinely load-bearing architectural change, and even its shape is unresolved: nested workspace (`parent_workspace_id`, a path explicitly rejected once already) vs. a new pure "project" container above workspace (Notion/Asana pattern).

## Key Constraints
- `workspace_id` is the sole scoping key across schema, Redis realtime channels, activity log, and flow-metrics queries — any hierarchy change touches all of these, not just the schema.
- `recordActivity()` is mandatory on every mutation (project convention) — new view/reorder/hierarchy operations must not skip it.
- The 10-workspace/user cap (`server/src/routes/helpers.ts:8`, `client/src/lib/workspaceSwitcher.ts:5`) is a soft, redefinable count guard, not architecturally load-bearing — but whether nested sub-projects count against it is a real product decision.
- `position` (`server/src/core/position.ts`) is column-scoped by application convention only — no DB constraint enforces it (`server/src/db/schema.sql:17`, index is `(workspace_id, position)`, not `(column_id, position)`). Values aren't comparable across columns.
- The only card-reorder write path is `POST /cards/:id/move` (`server/src/routes/cards.ts:668-830`), which requires `toColumnId` + `index` — every reorder is implicitly a column assignment. No column-independent reorder operation exists.
- `PATCH /cards/:id` already handles `dueDate` updates as part of the general field-update path (`cards.ts:376,394-403`), independent of `position`/`column_id`.

---

## Brainstorming Methods Used

### Question Storming — deep
Key insights:
- Unclear whether "sub-project" means nested workspaces or a folder-grouping of boards, or a page-tree that happens to hold tasks
- Unclear whether list/calendar requests want a re-render of the same cards, or imply per-user default-view preference (possible persona split: PM/non-dev vs. dev)
- If sub-projects exist, WIP limits and flow metrics semantics break unless explicitly defined at parent vs. child level
- Unclear whether a sub-project counts against the 10-workspace/user cap

### First Principles Thinking — creative
Key insights:
- "Workspace must equal one board" is incidental MVP shape, not fundamental — schema ties columns/cards directly to `workspace_id` because that was the initial shape
- "Sub-project needs a new table" is not necessarily true — recursive workspace nesting could reuse most existing membership/permission/realtime plumbing
- "List/Calendar need new data" is false — cards already have `position` and `due_date`; the gap is a view layer, not storage
- Root need across all three requests: "let me organize and see my work in the shape I actually think in," not literally "give me Notion"

### Six Thinking Hats — structured
Key insights:
- White: workspace:board is 1:1 flat; no `boards` table; no doc/page entity; realtime is `workspace_id`-keyed
- Black: hierarchy touches WIP-limit/flow-metrics/permission semantics for real; pushing all fronts (views + hierarchy + docs) in one plan risks over-committing
- Green: "view" as one saved-query lens over the same card set, not 3 separate features; sub-project as "workspace can contain workspaces" or a pure container
- Blue: sequence by cost — cheapest first — but the cost gradient needed spike verification (see below)

### Analogical Thinking — creative
Key insights:
- Linear caps project nesting at one level — no infinite tree
- Notion's table/board/calendar/list are saved filters over one underlying data source — confirms "view is a lens"
- Trello's Calendar Power-Up plots existing cards by due date with zero new data model — confirms calendar view is the cheapest win
- No analog (Linear, Notion, Asana/ClickUp, Trello) shipped hierarchy + views + docs simultaneously — all layered, cheapest/highest-leverage first

### Constraint Mapping — deep
Key insights:
- Real constraint: `workspace_id` scoping touches routes, realtime, and metrics — not just schema
- Imagined constraint: "must build full Notion blocks" — not supported by evidence; sub-project + views got 10+ requests each, docs got none independently
- Workaround: List/Calendar view can ship with zero schema change; sub-project hierarchy is the one change that's genuinely load-bearing

---

## Advisor Synthesis
The advisor confirmed the cross-method convergence on "view is a lens, not a new entity" but flagged that this only holds read-only — reorderable List view was being waved through by an unverified assumption, which the spike then confirmed as false (no cross-column write path exists). It also flagged that docs/pages was being carried as a co-equal 3rd signal despite having no independent user evidence (it came from a brand-design interview choice, not a feature request), and that "sub-project" collapses two genuinely different architectures (nested workspace vs. new container entity) that should surface as a fork for a future cycle, not get resolved here.

---

## Spike Results

**Unknown resolved:** What does `position` mean for a card outside its single `column_id` scope, and what would List view (reorderable) and Calendar view (drag-reschedule) each require?

**Finding:**
- `position` is column-scoped by application convention only, not by DB constraint (index is `(workspace_id, position)`, not column-scoped)
- Read-only List view: no blocker — plain `ORDER BY position` works
- Reorderable List view: **not free** — the only write path (`POST /cards/:id/move`) requires `toColumnId` + `index`; every reorder is implicitly a column move. No column-independent reorder operation exists.
- Calendar drag-to-reschedule: **confirmed near-free** — `PATCH /cards/:id` already handles `dueDate` in the general update path, untouched by `position`/`column_id`, no new endpoint needed

**Implication:** The "views are cheap" claim only survives for read-only List and Calendar (read + reschedule). Reorderable List view needs its own design decision (implicit column-move semantics vs. a new ordering scheme) and should not be bundled into the "cheap, ship-now" slice without that being decided first.

---

## Approach Directions

### Direction A: Views-first, hierarchy-deferred (Recommended)
Ship List view (read-only) and Calendar view (drag-to-reschedule) now as a thin view-layer over existing card data — spike-confirmed zero schema risk. Sub-project hierarchy becomes its own dedicated pitch/grinding cycle later, once the container-vs-nesting fork gets deliberate exploration instead of being rushed.
+ Near-immediate user relief on the highest-confidence-cost signal; builds pivot momentum without betting on an unresolved architecture question
− Doesn't touch the sub-project ask this cycle — partial relief only

### Direction B: Unified pivot, container-first
Treat sub-project as a new pure "project" entity above workspace (Notion/Asana pattern — container holds boards, doesn't have its own), with views layered to query across it. Groom hierarchy + views together in one grinding cycle before any implementation.
+ Coherent single narrative for both signals; avoids re-running the nested-workspace path already rejected once; matches proven external pattern
− Bigger new-module surface (new entity + relationships + permission model) = larger unknown surface, slower time-to-value

### Direction C: Extension path — nested workspace + views together
Implement sub-project via `parent_workspace_id` (extend existing workspace model, not a new entity); ship List+Calendar view in the same cycle.
+ Smallest total new surface — reuses membership/realtime/activity plumbing almost as-is
− Directly reruns a path explicitly rejected once already (2026-06-13 multi-workspace pitch: "workspace shouldn't have a project layer inside it"); nesting semantics (WIP/metrics roll-up, cap-counting) still unresolved

---

## Open Questions for pocket-grinding

**For the immediate Views slice (Direction A):**
- [ ] Does List/Calendar view need a new query endpoint, or can it reshape the existing board-fetch response client-side?
- [ ] Is `due_date` indexed for range queries (calendar month view)? Check `schema.sql` — only `(workspace_id, position)` and `(column_id)` indexes were found in this session's scan.
- [ ] Do List/Calendar views need to respect `deleted_at` soft-delete and existing permission scoping identically to board view, or is a new query path required?
- [ ] Is reorderable List view in scope for this cycle at all, or explicitly deferred? If in scope: does reorder imply an always-present (even if unchanged) `column_id`, or does it need a new column-independent ordering field?

**For the deferred hierarchy cycle (future pitch, not this one):**
- [ ] Resolve the Direction B vs. C fork: new "project" container entity vs. nested workspace (`parent_workspace_id`) — needs its own exploration, not answered here
- [ ] Do sub-projects count against the 10-workspace/user cap, or only top-level workspaces?
- [ ] Do WIP limits and flow metrics roll up per sub-project, per parent, independently, or not at all?
- [ ] Does a child project get its own Redis realtime channel, or inherit the parent's?

---

## Recommended Direction
Direction A — the spike already proved views are the one genuinely low-risk win; hierarchy's own fork (B vs. C) is a real product decision that deserves focused exploration rather than being bundled into one high-stakes pivot plan. Ship the cheap, evidenced win first; let the harder call get the attention it needs separately.

---

## Handoff Context (for pocket-grinding)
When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use Direction A as the working hypothesis — scope this grinding cycle to **List (read-only) + Calendar (drag-reschedule) views only**
- Treat the "Immediate Views slice" open questions above as Phase 3 Discovery targets
- Do NOT treat Approach Directions as final architecture — validate through GWT first
- Sub-project hierarchy (Directions B/C and their open questions) is explicitly OUT of scope for this grinding cycle — it needs its own future pitch-exploration cycle to resolve the container-vs-nesting fork before grinding should touch it
- Docs/pages is demoted — do not treat it as in-scope for any near-term cycle without new independent user evidence
- Related pitches for context: `docs/pocket/spec/2026-06-11-evolve-camel-workspace/pitch-exploration.md` (card-as-center-of-gravity direction, predates this beta signal), `docs/pocket/spec/2026-06-13-multi-workspace/pitch-exploration.md` (established current workspace:board 1:1 model, explicitly rejected a project layer)
