# Pitch Exploration: tracker-project-phase-wbs
Date: 2026-08-05 | Project: camel-kanban | Status: pitch-only

---

## Problem Statement

Tracker is a flat, workspace-scoped list grouped by status, so it cannot represent long-horizon plans: there is no container for project stages, no rollup progress, and no `start → end` schedule on items. Members planning multi-month work have no place to put a work breakdown, and the Roadmap feature that is meant to follow has no data to render.

## Root Tension

The already-shipped Tracker entity (`tracker_items`, workspace vocabularies, and `FA-1`-style keys already pasted into chat and DMs) must survive intact while two new parent layers are inserted above it — and status vocabulary currently carries no machine-readable semantics, which both rollup percentage and overdue colouring depend on.

## Key Constraints

- `FA-N` keys are stable citations already circulating in chat/DM — re-keying breaks live references
- `workspaces.tracker_key_counter` scopes key allocation to the workspace, not to any project
- Tracker vocabulary rules v1 forbid rename and delete; Phases require both
- `client/src/components/tracker/TrackerGlyphs.tsx:27` infers semantics from a name regex (`CANCELLED.test(status.name)`) plus `position` ordering — a status named "Selesai" already renders wrong today
- A workspace has exactly one board: there is no `boards` table; `columns`/`cards` reference `workspace_id` directly (`server/src/db/schema.sql:113-114`). `notifications.board_id` is a nullable column with no backing table
- The `tracker-entity` spec (2026-08-03) explicitly forbids touching Board rendering and card/column mutation paths
- Workspace hard cap of 10 is enforced in `server/src/routes/helpers.ts` and `client/src/lib/workspaceSwitcher.ts` — a new container type needs its own cap or becomes a bypass
- `server/src/routes/tracker-items.ts` is already 878 lines
- Reusable as-is: `server/src/core/position.ts` (fractional ordering), `client/src/lib/columnColorUtils.ts` (OKLCH), per-workspace SSE channel, `version` + HTTP 409, `deleted_at`, `recordTrackerActivity()`

---

## Brainstorming Methods Used

### Question Storming — deep
Key insights:
- Deleting a Phase that still holds tasks was the unasked question that silently determines the migration shape
- Whether status vocabulary stays workspace-global or becomes project-scoped decides whether unrelated projects pollute each other's status lists
- Key ownership (`FA-1` vs `PREP-1`) is a data-integrity question, not a naming question
- Manual ordering inside a Phase is not possible today — items sort `created_at ASC` with no `position` column

### First Principles Thinking — creative
Key insights:
- Status grouping is already "group by FK to a vocabulary row"; changing the grouping axis is mechanically a different parent FK, not a new paradigm
- Progress is fully derivable — storing it creates a second source of truth
- Phase dates should be derived from `min(start)` / `max(end)` of children for the same reason
- The one thing missing at the foundation is semantics on status: nothing tells code that `Done` completes and `Canceled` is excluded from the denominator
- A key's only job is stable citation; stability beats aesthetics

### Constraint Mapping — deep
Key insights:
- Hard: key counter lives on `workspaces`; project-scoped keys would require moving it plus re-keying every existing item
- Hard: vocab v1's no-rename/no-delete rule is incompatible with user-named Phases, which pushes Phase out of `tracker_vocabularies`
- Hard: `/tracker/{PREFIX}-{N}` already exists with canonical redirect — a project route must not be ambiguous with the key pattern
- Free: `position.ts`, OKLCH colours, the per-workspace SSE channel, optimistic locking and soft-delete patterns all apply unchanged
- Soft: `tracker-items.ts` should be split before project/phase routes are added

### Solution Matrix — structured
Key insights:
- Variables: Project entity × Phase entity × key scoping × existing-data migration × status semantics
- Status semantics appeared as mandatory in every viable combination — it is a prerequisite, not an option
- Phase-as-free-string collapses immediately: it cannot carry rollup or ordering
- Per-project re-keying was expensive in every row it appeared in

### Reverse Brainstorming — creative
Key insights:
- Computing rollup from the literal name `'Done'` breaks the moment a user creates "Selesai" — and this failure mode already exists in the glyph code
- A non-nullable `phase_id` kills global quick-capture and pushes users back to the Board
- Showing progress without overdue signalling makes the tracker actively lie: 100% green while every date has passed
- Three levels of collapse (project > phase > task) with v1's reset-on-navigation rule makes a long WBS unusable
- Unlimited projects bloat navigation and become an end-run around the 10-workspace cap
- Inline "Add Task" with no date field starves the Roadmap that motivated the feature

---

## Advisor Synthesis

All five methods independently converged on two invariants: status vocabulary needs machine-readable semantics, and `FA-N` must never change. The advisor's framing to lead with: this change is almost entirely **additive** — two parent tables, three date columns, one semantic column, one `position` column, and a swapped grouping selector in `TrackerPage.tsx`; nothing existing is rewritten. Three gaps were surfaced that the methods missed: Phase deletion semantics (blocking — it determines the migration shape), comments/attachments visible in the target screenshot (must be scoped out by name or grinding inherits them), and `completed_at` provenance. Discarded on the advisor's recommendation: per-project re-keying, data reset, literal-name status matching, phase-as-string, and Project-as-Board.

---

## Spike Results

**Unknown 1 resolved:** Can a workspace hold multiple Boards — i.e. would "Project" be a competing third user-facing boundary?
**Finding:** No. There is no `boards` table at all. `columns` and `cards` reference `workspace_id` directly (`schema.sql:113-114`, made `NOT NULL` at lines 186/189). `notifications.board_id` is a nullable orphan column. One workspace = one board.
**Implication:** Project is a clean new axis inside Tracker, not a third boundary demanding a naming story. Combined with the `tracker-entity` spec's "Must NOT touch Board" constraint, Project-as-Board is decided against on documented grounds without a full spike.

**Unknown 2 resolved:** Should `completed_at` be stored or derived from `tracker_events`?
**Finding:** The repo already answers this on the Board side. `server/src/routes/cards.ts:789-790` sets `done_at` on transition:
```sql
done_at = CASE WHEN <target.is_done> THEN COALESCE(done_at, now()) ELSE NULL END
```
Board stores the timestamp at transition rather than deriving it from the event log.
**Implication:** Tracker follows the same pattern — `completed_at` is a column set when an item enters a terminal status. `tracker_events` remains the audit trail, never the render source. Deriving per-row for a dense list would be the wrong cost.

---

## Decisions Locked During Pitching

Confirmed by the user in Phase 2/4 and not open for re-litigation in grinding:

1. **Status vocabulary survives unchanged** as a per-item property with the existing picker (Backlog / Todo / In Progress / Done / Canceled), workspace-scoped. The target screenshot's checkbox is shorthand for the terminal status, not a replacement for the vocabulary.
2. **Hierarchy is Workspace → Project → Phase → Task.**
3. **Deleting a Phase orphans its tasks** into a "No phase" section — therefore `phase_id` is nullable and **existing items need zero backfill**.
4. **Phase gets its own table** (`tracker_phases`), not a `tracker_vocabularies.kind = 'phase'`, because it needs subtitle, rename, delete, and a project FK.
5. **Project and Phase ship in the same cycle** (not phase-first).
6. **Keys stay workspace-scoped.** `FA-1` remains `FA-1`.

---

## Approach Directions

The remaining directional choice is **where Project lives in navigation** — the schema is identical across all three.

### Direction A: Implicit project with an in-header switcher
Auto-create a default project per workspace; `/tracker` stays a single route and the project is chosen from a switcher in the Tracker header. The "project" concept only surfaces once a user creates a second one.
+ Zero new concepts for existing users, existing items land in the default project, and no URL segment can collide with the `FA-1` key pattern
− A project cannot be bookmarked or shared by link

### Direction B: Project as a first-class sidebar entry
Projects appear in the sidebar alongside Board, each with its own route (`/tracker/p/{id}`).
+ Linkable and bookmarkable; multi-project work feels native
− Sidebar bloat; requires a project cap and full create/delete UX on day one; the route needs a disambiguating segment so it never collides with the key pattern

### Direction C: Project index page
`/tracker` becomes a list of projects (name, progress, task count); clicking one opens `/tracker/p/{id}`.
+ Multi-project state is immediately legible, and it is the natural home for a cap and a "New project" action
− Adds a click for users with a single project — a regression against today's behaviour

---

## Open Questions for pocket-grinding

- [ ] What shape should the status semantic column take — a `category` enum (`backlog` / `started` / `completed` / `canceled`) or two booleans mirroring Board's `is_done`? Board has no "canceled" concept, so its precedent is not a direct fit, and the rollup needs a three-way distinction (counted-done / counted-open / excluded).
- [ ] Are `Canceled` items excluded from the rollup denominator entirely, or shown as a separate segment on the progress bar?
- [ ] How is the semantic column backfilled for statuses users have already created beyond the seeded five, and what is the default for statuses created after this ships?
- [ ] Does `TrackerGlyphs.tsx` drop its name-regex inference entirely once the semantic column exists, or keep it as a fallback?
- [ ] What is the project cap per workspace, and where is it enforced so it mirrors the existing workspace-cap pattern in `helpers.ts` + `workspaceSwitcher.ts`?
- [ ] Are Phase dates strictly derived (`min(start)` / `max(end)`), or can a Phase carry explicit dates that override the derivation?
- [ ] Does the collapse-resets-on-navigation rule from `tracker-entity` v1 survive at three nesting levels, or does a long WBS require persistence?
- [ ] Where do Phase- and Project-level events surface? `tracker_events.tracker_item_id` is nullable so they can be logged workspace-scoped, but the changelog UI is per-item today.
- [ ] `tracker_item_assignees` is multi-select while the target layout shows a single named assignee per row — what is the display rule when an item has three assignees? (Display decision, not schema.)
- [ ] Should `tracker-items.ts` (878 lines) be split before or as part of adding project/phase routes?

### Explicitly Out of Scope

Named here so grinding does not inherit them from the target screenshot:

- **Comments on tracker items** — the reference screenshot shows comment counts; Tracker has no comment subsystem today
- **Attachments on tracker items** — same reason
- **Roadmap / Gantt rendering** — this cycle produces the data (`start`, `end`, phase, rollup) that Roadmap will later consume; it does not render a timeline
- **Board changes of any kind**, per the `tracker-entity` spec
- **Tracker ↔ card linkage** — still deferred
- **Per-project status vocabularies** — status stays workspace-scoped
- **Re-keying items** under a project prefix

---

## Recommended Direction

Direction A — existing users have exactly one collection of tracker items, so hiding the project concept behind a default keeps the change invisible to them, avoids any URL ambiguity with the `FA-1` key pattern, and leaves the upgrade to B or C purely additive (new routes, unchanged schema).

---

## Handoff Context (for pocket-grinding)

When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Treat **Decisions Locked During Pitching** as settled input, not as options to re-explore
- Use Direction A as the working hypothesis for Phase 5 Design Proposals
- Treat Open Questions above as Phase 3 Discovery targets — the status-semantics question is the highest-value one, since rollup and overdue both depend on it
- Do NOT treat Approach Directions as final architecture — validate through GWT first
- Read `docs/pocket/spec/2026-08-03-tracker-entity/tracker-entity.md` alongside this doc; it defines the entity being extended and the Board-isolation constraint that still holds
