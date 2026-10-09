# Pitch Exploration: tracker-onboarding-seed
Date: 2026-08-04 | Project: Camel | Status: pitch-only

---

## Problem Statement
The Tracker page ships with zero onboarding — a new or existing user lands on an empty page (`EmptyState` was just removed in `655b865`) with no explanation of what Tracker is for or how it differs from the Board (kanban). Existing workspaces need a one-time, idempotent backfill of 2-3 self-explanatory tracker items that teach the distinction through their own content, with no new UI.

## Root Tension
`schema.sql` is reapplied wholesale on every `make db-migrate`, so a naive seed block re-runs every deploy. The guard must be a durable per-workspace flag, not content matching (content matching would resurrect items after a user soft-deletes them). The seed must also respect each workspace's *live* state — current key counter, current status vocabulary, which may already be customized or renamed — rather than assuming fresh defaults.

## Key Constraints
- Key allocation is `UPDATE workspaces SET tracker_key_counter = tracker_key_counter + 1 RETURNING ...`, one bump per item (`server/src/routes/tracker-items.ts:391-398`). The seed must bump the counter by exactly the item count, starting from each workspace's *current* value — otherwise the first item a real user creates after the seed collides on `UNIQUE (workspace_id, key_number)`.
- The key string (`CAM-1`) is derived at read time via `formatKey(prefix, key_number)` (`server/src/core/tracker-key.ts:14`), not stored — the seed only needs `key_number` right, nothing else to reproduce.
- Idempotency guard: new column `workspaces.tracker_onboarding_seeded_at TIMESTAMPTZ`, seed only where NULL, set it in the same transaction/block. Not a title/content match.
- `status_id` is `NOT NULL` and status vocab is user-customizable — a bare `WHERE name = 'Todo'` lookup can return NULL for a workspace that renamed or deleted it, aborting the whole migration block for every workspace. Must fall back to the lowest-`position` status per workspace, and skip workspaces with no statuses at all.
- Every mutation needs a `card_events`-equivalent row per `CLAUDE.md` convention: one `tracker_item_created` row in `tracker_events` per seeded item, `actor_id NULL` (nullable, left-joined safely in `server/src/routes/tracker-items.ts:811-829`, confirmed the detail page's activity rail won't break on a null actor).
- Scope is existing workspaces only (user's explicit choice) — no hook on workspace creation. A brand-new signup's first workspace gets nothing from this migration; it is a backfill, not an ongoing onboarding mechanism.
- Reuse the exact retroactive-seed shape already proven in this file: `DO $$ ... FOR ws IN SELECT id FROM workspaces LOOP ... END $$;` (`schema.sql:432-461`), appended after it, not a new mechanism.

---

## Brainstorming Methods Used

Four methods — UX/product-direction problem type (default trio + Reverse Brainstorming per the selection guide).

### Question Storming — deep
Key insights:
- Can title/description alone teach the concept, or is a separate explanatory banner still needed? (Resolved: items only, no banner — user asked for items, EmptyState was just removed.)
- Should seeded items be deletable/completable like real items, or protected? (Resolved: real items — no special-casing, protected-item logic would be new UI/behavior.)
- Should items span multiple statuses to demonstrate each status, or sit in one group?
- Should workspaces that already have real tracker items be skipped?
- How does a user grasp the tracker/kanban distinction without reading a paragraph?

### First Principles Thinking — creative
Key insights:
- A tracker item is just title + description + status (+ optional priority/label) — onboarding needs no new component, only the right content in those fields.
- The most effective teaching mechanism is the item *being* a concrete example of weeks-horizon work, not an abstract description of the concept.
- Kanban = fast daily ops (`push PR deviano`); Tracker = weeks-horizon product work (`Workspace Rename`). The strongest onboarding item demonstrates this granularity gap directly, using the project's own real data pattern as reference.
- Label/priority fields sit unused in onboarding items unless deliberately populated — but populating them for onboarding's sake adds fragile name lookups for zero teaching value.

### Six Thinking Hats — structured
Key insights:
- **White:** the exact retroactive-seed pattern already exists and is proven (`schema.sql:432-461`) — reuse, don't reinvent.
- **Red:** risk of the seed feeling like it "pollutes" a workspace that already has real tracker items from an early adopter.
- **Yellow:** zero new UI required — `TrackerPage.tsx` renders whatever exists in the database as-is.
- **Black:** seeded items consume real `key_number` slots from the per-workspace counter; if the counter isn't advanced identically, the first real item a user creates collides and 500s.
- **Green:** an item's description can literally point back at the Board ("compare this with your Board card for X") — zero new feature, just content.
- **Blue:** sequencing matters — resolve the idempotency guard and key-counter mechanics before writing the seed SQL, not after.

### Reverse Brainstorming — creative
Key insights:
- Fails if copy is generic ("Get familiar with Tracker") without naming a concrete difference from the Board.
- Fails if items are non-idempotent — re-running `make db-migrate` duplicates them.
- Fails if resurrected after a user deletes them (content-based idempotency check would cause this via soft delete).
- Works better if a description invites a concrete comparison action rather than only stating the concept.
- More than 2-3 items becomes noise the user must clean up themselves — hard cap holds.

---

## Advisor Synthesis
The advisor confirmed the content direction (item-as-example) was the strongest idea in the divergence, but flagged that the bigger risk was the seed SQL mechanics, not the copy — the Black Hat insight was only half-caught. It named four concrete, verifiable risks (key-counter consistency, idempotency-guard shape, status-lookup safety, activity-row convention) and required each be resolved via code read before converging, rather than assumed. It also flagged that spreading items across multiple statuses or attaching label/priority "to demonstrate the vocab" should be discarded — the reference screenshot groups everything in one status, and vocab attachment adds fragile lookups for no teaching value.

---

## Spike Results

**Unknown resolved:** Do the seed migration's four mechanical risks (key-counter allocation, idempotency guard shape, status-lookup safety, activity-row requirement) hold as stated, and what do they require the SQL to do?

**Finding:** All four confirmed via direct code read:
1. Key allocation is `UPDATE workspaces SET tracker_key_counter = tracker_key_counter + 1 RETURNING tracker_key_counter` per item (`tracker-items.ts:391-398`); the key string is derived at read time, not stored (`tracker-key.ts:14`).
2. No existing idempotency mechanism fits — a new `tracker_onboarding_seeded_at` column on `workspaces` is required since `make db-migrate` reapplies `schema.sql` on every run.
3. The app's own `getBacklogStatusId()` helper (`tracker-items.ts:304-319`) throws if "Backlog" isn't found by name — confirming the raw-SQL migration must not copy that pattern and instead needs a position-based fallback.
4. `tracker_events.actor_id` is nullable and left-joined to `users` (`tracker-items.ts:811-829`) — a seeded item with `actor_id NULL` renders safely in the activity rail.

**Implication:** The migration's shape is now fully determined: per-workspace loop bumping the counter N times (N = item count), status resolved by lowest `position` with a skip-if-none fallback, guarded by the new seeded-at column, with a matching `tracker_events` row per item. No open technical unknowns remain for pocket-grinding to resolve architecturally — only content/copy and minor sequencing decisions.

---

## Approach Directions

All directions share the same mechanics (settled above): one-time SQL migration, `DO $$ / FOR ws IN SELECT id FROM workspaces LOOP` pattern, `tracker_onboarding_seeded_at` guard, key counter bumped per item, status = lowest-position fallback, one `tracker_events` row per item. They differ only in **content voice and item count**.

### Direction A: Explanatory pair (2 items)
Item 1 states what Tracker is (product/backlog, weeks-horizon). Item 2 states how it differs from the Board, in its description. Reading voice, no call to action.
+ Simplest to write and verify — two clear sentences.
− Passive. The user reads about the difference rather than experiencing it.

### Direction B: Explanatory + comparative demo (3 items) *(recommended)*
Item 1 = concept intro. Item 2 = concrete comparison using this project's own real data pattern (a Tracker item like "Workspace Rename" vs a Board card like "push PR deviano") so the 1:N granularity gap is visible, not stated. Item 3 = a light call to action ("compare this list with your Board — notice these items outlive a single day").
+ Combines concept + concrete example + action — directly implements the First Principles insight that the item itself should be the demonstration.
− Item 2 references the Board by name in its own text — needs to read as natural tracker content, not as a meta/promotional aside.

### Direction C: Linear-style actionable checklist (3 items)
Mirrors the reference screenshot's voice exactly — every item framed as a task to check off ("Create your first tracker item", "See how a Board card differs"), not an explanatory paragraph.
+ Closest visual/tonal match to the Linear reference the user provided.
− Linear's checklist teaches *product setup* (connect tools, import data); forcing that voice onto a *conceptual* explanation (tracker vs kanban) risks losing clarity for tonal similarity.

---

## Open Questions for pocket-grinding
- [ ] Final copy for the 2-3 items (title + description text) — pitching settled the direction and voice, not the exact wording.
- [ ] Should the migration skip workspaces that already contain real (non-onboarding) tracker items, or seed regardless since the guard is workspace-level, not content-level?
- [ ] Exact column type/default for `tracker_onboarding_seeded_at` and whether it needs an index (unlikely at current workspace scale, but grinding should confirm against `idx_cards_workspace`-style precedent).
- [ ] Does the seed's `tracker_events` payload need to match the shape `recordTrackerActivity()` produces exactly (`{ title, key }`), or can it be simplified since no client code reads seeded events specially?

---

## Recommended Direction
Direction B — it directly implements the First Principles insight validated across three of four brainstorming methods (the item should demonstrate the tracker/kanban gap through a concrete, project-real example rather than only describing it), stays within the 3-item hard cap the Reverse Brainstorming pass justified, and avoids forcing Linear's product-setup checklist voice onto a conceptual-explanation problem it wasn't designed for.

---

## Handoff Context (for pocket-grinding)
- Start with this problem statement (Phase 1 context).
- Use **Direction B** as the working hypothesis for Phase 5 Design Proposals.
- Treat Open Questions above as Phase 3 Discovery targets — primarily final copy and the already-has-real-items edge case.
- Do NOT treat Approach Directions as final architecture — validate through GWT first, though the spike already resolved the mechanical migration shape (key-counter bump, idempotency guard, status fallback, activity row) with high confidence; grinding's GWT pass should confirm these hold under scenario testing, not re-derive them from scratch.
- **Settled during pitching, do not reopen without new evidence:** seed is existing-workspaces-only (no create-workspace hook); idempotency guard is a `workspaces.tracker_onboarding_seeded_at` column, not content matching; status is resolved by lowest `position`, not by name; seeded items get real `tracker_events` rows with `actor_id NULL`.
