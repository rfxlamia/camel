# Pitch Exploration: workspace-template
Date: 2026-06-29 | Project: camel-kanban | Status: pitch-only

---

## Problem Statement
New workspace always lands on an empty board — users must build their column structure from scratch every time. A workspace template feature lets users pick a pre-made kanban layout (column names, colors, wip limits, policy, done-flag) and start working within seconds of creating a workspace.

## Root Tension
Templates that are opinionated enough to be useful risk alienating workflows that don't match the preset — too rigid and users edit everything anyway making the template pointless; too generic and it provides no value over "Add column."

## Key Constraints
- Column color palette is fixed to 5 names: `powder-blue`, `pale-sky`, `light-cyan`, `frozen-water`, `turquoise` — templates can only draw from these
- Templates cannot set `is_signable` / `signable_assignee_id` — those require a workspace member reference which a system template doesn't know at apply-time
- No batch column endpoint exists — current API is `POST /columns` (single column); batch requires a new server endpoint or client-side sequential calls
- `recordActivity()` must be called on every mutation — any batch endpoint must include this
- Empty-state trigger is the only safe apply surface for MVP — applying to a non-empty workspace risks data overwrite and is out of scope

---

## Brainstorming Methods Used

### Question Storming — deep
Key insights:
- Template storage location (client hardcode vs DB) is the primary architectural fork
- "Apply to existing workspace" opens data-loss risk that the empty-state trigger sidesteps entirely
- Column "type" in this codebase means: `is_done`, `wip_limit`, `policy` — NOT a separate type field
- Template must be skippable (not a gate) and discoverable from inside an empty workspace
- 3–5 max templates to avoid paradox of choice

### First Principles Thinking — creative
Key insights:
- A template is nothing more than an ordered list of `{title, color, wip_limit, policy, is_done}` objects
- Column model already has all required fields — zero schema migration needed for MVP
- Simplest valid form: array of column configs POSTed to the existing columns route
- "Template" does not require a DB table unless user-created templates are in scope (they aren't for MVP)

### Six Thinking Hats — structured
Key insights:
- White: existing `POST /columns` API is the only mutation needed; batch vs sequential is the key technical decision
- Yellow: time-to-value drops dramatically; templates act as social proof for "correct" usage patterns
- Black: sequential calls risk partial apply (3/5 columns created, network error, board half-built); opinionated templates may alienate edge workflows
- Green: template picker as onboarding moment — brief description per column explaining its purpose
- Red: picker must feel light and fun, not form-like; "skip, start blank" always visible
- Blue: Phase 1 = system-only curated presets; Phase 2 = user-created / save-as-template

### Reverse Brainstorming — creative
Key insights (inverted from failure modes):
- Template must be **optional**, never a gate before accessing the board
- Names must be **use-case driven** ("Software Dev", "Marketing Campaign", "Bug Tracker") not generic ("Template 1")
- **Visual preview required** before commit — user must see column layout before applying
- **3–5 templates max** — more causes decision paralysis and exit without choice
- Template picker should be accessible from **inside an empty workspace**, not only at create-time

---

## Advisor Synthesis
First Principles confirmed the scope ceiling: template = ordered column configs, no new schema. Empty-state as the apply trigger simultaneously solves the UX discovery problem and the data-loss risk — both questions have the same answer. The batch vs. sequential decision is the only real technical fork; sequential has a genuine correctness problem (partial-apply on failure), so a small batch endpoint is worth the added scope. Save-as-template and user-created templates were cleanly discarded as Phase 2 scope — they need a DB table and CRUD layer that has no business being in MVP.

---

## Approach Directions

### Direction A: Client-side presets, sequential POST
Templates hardcoded in client as JSON arrays. Apply = N sequential `POST /columns` calls from client.
+ Zero backend changes — fastest possible MVP
− Partial failure risk: network error mid-apply leaves board half-built with no rollback; N realtime events and N activity records instead of one atomic operation

### Direction B: Client-side presets, batch endpoint (recommended)
Templates hardcoded in client. Add `POST /columns/batch` on server — single DB transaction, single activity record, single realtime event.
+ Atomic apply, clean failure handling, one event on the wire
− Requires one new server endpoint (small scope, but non-zero)

### Direction C: Server-stored templates (DB table)
Templates stored in a `workspace_templates` DB table. CRUD routes for create/list/apply. Enables user-created templates in future.
+ Extensible — "save as template" becomes Phase 2 with no schema change
− New migration, new table, CRUD routes — overbuilt for MVP; premature generalization

---

## Open Questions for pocket-grinding
- [ ] Should the template picker replace or augment the existing `EmptyState.tsx` component, or is it a modal/sheet overlay?
- [ ] What are the 3–5 template names and their exact column configs (names, colors, wip_limits, policies)?
- [ ] Does `POST /columns/batch` need to emit a single `column.created` event per column or one `board.template_applied` event? What does the realtime consumer expect?
- [ ] Is "skip, start blank" the right label, or should it be "Start from scratch" / "Build manually"?
- [ ] Should template apply be undoable (bulk delete columns) or is it one-way?

---

## Recommended Direction
Direction B — batch endpoint adds minimal server scope but eliminates the partial-apply correctness problem that Direction A carries; Direction C is overbuilt for what is effectively a column-seeding feature.

---

## Handoff Context (for pocket-grinding)
When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use Direction B (client presets + `POST /columns/batch`) as the working hypothesis for Phase 5 Design Proposals
- Treat Open Questions above as Phase 3 Discovery targets
- Do NOT treat Approach Directions as final architecture — validate through GWT first
- Color palette is locked to 5 names; do not design templates that require custom colors
- `is_signable` is out of scope for templates
