# Pitch Exploration: board-tracker-schema-unify
Date: 2026-08-29 | Project: camel-kanban | Status: pitch-only

---

## Problem Statement
`cards` (board) and `tracker_items` (tracker) share a core shape (title/description/position/version/soft-delete/assignee) but diverge on status representation, priority, label, key_number, and temporal fields — a result of tracker being built as a new table rather than extending `cards`. The user confirmed this original separation was a mistake and wants a refactor that unifies the model and unblocks future features.

## Root Tension
Status is not pure taxonomy — on the board it also carries workflow behavior (`wip_limit`, `policy`, `is_signable`, `signable_assignee_id`) attached to a specific column instance, not to a status value in general. Merging `status_id` onto a shared vocabulary requires deciding whether that behavior moves with the vocab row (one vocab row per board-column instance) or stays external, with vocab rows only supplying name/color.

## Key Constraints
- `cards.position` is `NOT NULL`; `tracker_items.position` was added nullable with no default — a merge needs a backfill.
- `tracker_items` enforces `UNIQUE (workspace_id, key_number)` (allocation owned by `core/tracker-key.ts`) — merging requires allocating numbers to every existing card without colliding with live tracker items.
- `cards` has no `updated_at` column; `tracker_items` does.
- `tracker_vocabularies.category` (`backlog|started|completed|canceled`) already encodes the lifecycle that `columns.is_done` (boolean) only partially covers (doesn't distinguish canceled from completed).
- `core/wip.ts` keys purely off `currentCount` vs `wipLimit` — a pure function, but `wipLimit` today lives on a column instance, not a status taxonomy row shared across boards.
- Product direction on record (memory): "Tracker + Roadmap become separate features, kanban stays the core" — but if Roadmap ever surfaces board cards too, `project_id`/`phase_id` stop being tracker-exclusive. Unresolved.

---

## Brainstorming Methods Used

### Question Storming — deep
Key insights:
- Is board a temporary view or a first-class model alongside tracker?
- Unifying status means board loses (or must relocate) `wip_limit`/`policy`/`is_signable`.
- Do non-tracker workspaces get forced into migration?
- Should priority/label be opt-in per workspace or default-on for board (added UI complexity)?
- Does `card_events` (narrow, column-move-only) get folded into `tracker_events` (generic JSONB) as part of this?
- How do existing board cards without `key_number`/`priority_id` get backfilled?

### First Principles Thinking — creative
Key insights:
- Card and tracker item are both fundamentally "a unit of work" — the difference is presentation (kanban swimlane vs list/WBS), not core data.
- `columns` is arguably a status vocab row plus board-specific behavior, not a genuinely separate model.
- Priority and label are general task metadata the board is missing by accident, not tracker-exclusive concepts.
- `project_id`/`phase_id` may or may not be genuinely tracker-only — depends on whether Roadmap needs them on board cards (see Open Questions).
- `key_number` (issue-style numbering) could be a universal task identity property, not tracker-specific.

### Solution Matrix — structured
Key insights:
- Mapped three candidate directions (full merge / shared vocab / strangler) across status, priority/label, project/phase, event log, and migration risk.
- Full merge scores best on "duplication removed" but worst on migration risk and WIP-behavior placement.
- Shared vocab is the only option that closes the taxonomy gap without forcing the WIP-ownership or Roadmap questions to be answered first.

### Assumption Reversal — deep
Key insights:
- "Board and tracker are different domains" reversed: they're two views of one work-item concept; the split was accidental (tracker was faster to build as a new table than to extend `cards`).
- "Column is UI-only" reversed: column already carries workflow-policy, so it's closer to a first-class vocab-adjacent entity than to pure presentation.
- "Sync means writing a bidirectional converter" reversed: real sync means removing the duplicated schema, not adding a translation layer on top of it.
- "Migrate incrementally forever to avoid risk" reversed: every new feature (label picker, kebab menu, row pickers) keeps landing tracker-only per recent commit history, and the board falls further behind by default.

---

## Advisor Synthesis
The advisor flagged two facts that change the risk calculus: `tracker_vocabularies.category` already carries the lifecycle slot `columns.is_done` only half-covers, so status unification is cheaper than the initial matrix assumed — and `core/wip.ts` proves WIP behavior is genuinely column-instance-scoped, which is the real discriminator between a full-merge and a shared-vocab direction (not migration risk in the abstract). It also surfaced a direct conflict between "project/phase is tracker-only" (First Principles) and the standing product direction to ship a Roadmap feature, which the user said this refactor should also unblock — that conflict is left open rather than resolved here. Event-log unification and a `view_type`-enum design were cut from scope: the former is a separate defect (`card_events.to_column_id` is `NOT NULL`, so it can't record non-move mutations regardless of this refactor) and the latter smuggles in an architecture decision that belongs in grinding.

---

## Spike Results

**Unknown resolved:** Does `tracker_vocabularies.category` already cover the lifecycle semantics split across `columns.is_done` and `cards.started_at`/`done_at`? Is `wip_limit` enforcement taxonomy-scoped or instance-scoped?

**Finding:** `category` values are `backlog|started|completed|canceled` (`core/tracker-vocabulary-seed.ts`) — a superset of `is_done`'s boolean. `checkWipLimit` (`core/wip.ts`) takes `currentCount`/`wipLimit` per column instance; nothing about it is taxonomy-shaped.

**Implication:** Status unification (vocab-level) is lower-cost than assumed going in. But WIP/policy/signable behavior cannot move onto a workspace-scoped vocab row as-is — it needs either per-instance rows (full merge) or to stay external to vocab (shared-vocab direction). This is the deciding constraint between Direction A and Direction B below.

---

## Approach Directions

### Direction A: Full merge
Single `work_items` table; status becomes a vocab FK where the vocab row also owns workflow behavior (wip_limit/policy/signable) per instance.
+ Removes all schema duplication long-term.
− Requires reworking `wip.ts` scoping plus a big-bang migration (position backfill, key_number allocation); risky to commit to before the Roadmap/project-phase question is resolved.

### Direction B: Shared vocab, two tables
`cards` and `tracker_items` stay separate, but status/priority/label both reference `tracker_vocabularies`; `columns` keeps `wip_limit`/`policy` as a board-specific overlay on top of the vocab row.
+ Incremental, non-breaking, closes the priority/label gap on board immediately without waiting on the bigger decision.
− Structural duplication (two tables) remains — only the taxonomy layer unifies.

### Direction C: Strangler (tracker becomes canonical)
`tracker_items` becomes the source of truth; `columns` becomes a view-config that maps onto the status vocab. Board reads migrate to `tracker_items` first, writes follow.
+ No big-bang migration; converges toward one model over time.
− Assumes tracker's model wins by default — a product call, not just a technical one, and it's blocked on the same Roadmap question.

---

## Open Questions for pocket-grinding
- [ ] Does Roadmap (future feature) need `project_id`/`phase_id` on board cards too, or does it stay tracker-exclusive?
- [ ] Does `wip_limit`/`policy`/`is_signable` move onto the vocab row (per-status, global) or stay in a board-specific layer external to vocab?
- [ ] How does `key_number` get allocated to existing cards — one-time backfill, or lazy-assign on first touch?
- [ ] Is `card_events` (narrow, `to_column_id NOT NULL`) in scope for this refactor, or a separate follow-up?

---

## Recommended Direction
Direction B — closes the root cause (duplicated vocab) without forcing the Roadmap or WIP-ownership decisions before they're ready; A and C become viable follow-ons once grinding resolves the open questions above.

---

## Handoff Context (for pocket-grinding)
When pocket-grinding reads this doc:
- Start with this problem statement (Phase 1 context)
- Use Direction B as the working hypothesis for Phase 5 Design Proposals
- Treat Open Questions above as Phase 3 Discovery targets
- Do NOT treat Approach Directions as final architecture — validate through GWT first
