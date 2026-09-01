# ADR: Dual-table shim for board-tracker unified view

**Date:** 2026-09-01
**Status:** accepted
**Issue:** [#100](https://github.com/rfxlamia/camel/issues/100)
**Spec:** [unified-view.md](../spec/2026-08-31-board-tracker-unified-view/unified-view.md)

## Context

PR #99 shipped a unified Tracker view where board cards appear alongside tracker items. The implementation uses two physical tables (`cards` and `tracker_items`) merged at read time in `work-item-response.ts`. Agents and developers may interpret this as incomplete migration debt rather than an intentional architecture.

## Decision

**Keep the dual-table model.** The unified view is a read/write shim, not a step toward immediate table consolidation.

### Intentional contracts

1. **Shared key namespace** — Both tables use `workspaces.tracker_key_counter`. Board cards allocate via `allocateCardIdentity()`; tracker items increment on POST.

2. **Tracker-wins dedup** — `listMergedWorkItems()` excludes board rows whose `key_number` already exists in `tracker_items`. Collisions must not occur in normal operation.

3. **Split writes** — Client routes mutations via `workItemMutations.ts` using `item.source`:
   - `source: "tracker"` → `PATCH /tracker/items/:key` (or `/work-items/:key`)
   - `source: "board"` → `PATCH /cards/:id` for field edits; status-only via tracker API (hybrid reverse)

4. **Split audit tables** — `card_events` for board mutations; `tracker_events` for tracker mutations. Unified changelog is an HTTP adapter concern, not a merged table.

5. **API naming** — `/work-items` is the canonical path for unified reads/writes. `/tracker/items` remains as a legacy alias.

### Explicitly deferred

| Item | Rationale |
|------|-----------|
| `work_items` table migration | High effort; shim satisfies current product scope |
| Unified `work_item_events` table | Read-layer unification sufficient for now |
| Roadmap UI / status vocab CRUD | Separate product tracks |

## Consequences

### Positive

- Board fractional positioning and column semantics stay isolated from tracker phase/project model.
- Optimistic locking (`version`) remains per-table without cross-entity conflicts.
- Incremental delivery: unified view shipped without risky schema migration.

### Negative

- Application-layer merge/dedup must be maintained in `work-item-response.ts`.
- New features must respect `source` routing or risk wrong-table writes.
- Two event streams require adapter logic for unified activity feeds.

## Re-evaluation criteria

Revisit `work_items` migration when **any** of:

- Query complexity in merge layer causes measurable latency (>100ms p95 on list)
- Key collision or dedup bugs occur in production
- Audit/compliance requires single-table event trail
- >30% of workspaces have overlapping board+tracker items with frequent cross-surface edits

See [work-items-migration-spike.md](../spec/work-items-migration-spike.md) for options analysis.

## References

- `server/src/routes/work-item-response.ts` — merge layer
- `client/src/lib/workItemMutations.ts` — client mutation router
- `server/src/core/board-card-status-change.ts` — hybrid reverse
