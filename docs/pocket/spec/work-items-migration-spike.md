# Work-items migration spike

**Date:** 2026-09-01
**Status:** draft
**Issue:** [#100 P2#4](https://github.com/rfxlamia/camel/issues/100)
**ADR:** [2026-09-board-tracker-dual-table.md](../adr/2026-09-board-tracker-dual-table.md)

## Question

Should Camel migrate `cards` + `tracker_items` into a single `work_items` table, or continue the application-layer shim for the next 12 months?

## Options

### Option A: Continue dual-table shim (recommended)

**Description:** Keep `cards` and `tracker_items` as physical tables. Unified view remains in `work-item-response.ts` with tracker-wins dedup.

| Dimension | Assessment |
|-----------|------------|
| Impact | Low — no migration risk |
| Effort | Ongoing maintenance of merge layer (~200 LOC) |
| Risk | Low — proven in production via PR #99 |

**Pros:** No schema migration; board column semantics isolated; optimistic locking stays per-entity.

**Cons:** Every new unified feature must respect `source` routing; dedup logic is application-level.

### Option B: Unified `work_items` table

**Description:** Single table with `source` column or subtype discriminator. Junction tables consolidated.

| Dimension | Assessment |
|-----------|------------|
| Impact | High — simplifies queries, single audit trail possible |
| Effort | 5–8 weeks (schema, migration, SSE, tests) |
| Risk | High — fractional positions, column FK, signable columns, WIP |

**Draft schema sketch:**

```sql
CREATE TABLE work_items (
  id            BIGSERIAL PRIMARY KEY,
  workspace_id  INTEGER NOT NULL REFERENCES workspaces(id),
  source        TEXT NOT NULL CHECK (source IN ('board', 'tracker')),
  key_number    INTEGER NOT NULL,
  title         TEXT NOT NULL,
  -- board-only: column_id, position (fractional)
  -- tracker-only: project_id, phase_id, position
  -- shared: status_id, priority_id, dates, version
  UNIQUE (workspace_id, key_number)
);
```

**Breaking changes:** SSE event payloads, reorder APIs, soft-delete cascades, agent tools referencing `cards` table.

### Option C: PostgreSQL VIEW (read-only)

**Description:** `CREATE VIEW work_items_unified AS SELECT ... UNION ALL ...` for list/detail reads; writes still target underlying tables.

| Dimension | Assessment |
|-----------|------------|
| Impact | Medium — cleaner reads |
| Effort | 2–3 weeks |
| Risk | Medium — VIEW performance, write path still dual |

**Pros:** No write-path migration; dedup in SQL.

**Cons:** Kysely VIEW support; still two write tables; limited benefit over current shim.

## Data volume analysis

Run periodically:

```sql
SELECT w.id,
       (SELECT COUNT(*) FROM cards c WHERE c.workspace_id = w.id AND c.deleted_at IS NULL) AS cards,
       (SELECT COUNT(*) FROM tracker_items t WHERE t.workspace_id = w.id AND t.deleted_at IS NULL) AS tracker_items
FROM workspaces w
ORDER BY cards + tracker_items DESC
LIMIT 20;
```

At spike time, typical workspaces have low overlap (board cards with keys appearing in tracker list is the integration case, not bulk duplication).

## Decision matrix

| Criterion | A: Shim | B: work_items | C: VIEW |
|-----------|---------|---------------|---------|
| Time to ship | ✅ Now | ❌ 5–8 wk | ⚠️ 2–3 wk |
| Migration risk | ✅ None | ❌ High | ⚠️ Medium |
| Query simplicity | ⚠️ App merge | ✅ Single table | ✅ SQL UNION |
| Write complexity | ⚠️ Dual | ✅ Single | ❌ Still dual |
| Audit unification | ⚠️ Adapter | ✅ Possible | ❌ N/A |

## Recommendation

**Continue Option A for at least 12 months.** The shim is intentional (see ADR). Re-evaluate Option B only if re-evaluation criteria in the ADR are met.

Option C is a reasonable intermediate step if list-query performance becomes an issue before a full migration is justified.

## Next steps

1. Monitor p95 latency on `GET /work-items` in production.
2. Add collision detection metric if `key_number` overlap is ever detected.
3. Re-run this spike when audit requirements change or unified write volume exceeds 10k items/workspace.
