# Structured Research — Issue #79 ORM/Query-Builder Choice Fit

**Date:** 2026-06-26
**Issue:** [#79](https://github.com/rfxlamia/camel/issues/79) — tech-debt: migrate raw SQL to type-safe query builder/ORM
**Skill:** structured-research (one assumption per run)
**Methods:** Documentation vs Reality Check · Counterexample Hunt (refutation) · First-Principles Decomposition

---

## Verdict: Confirmed (confidence: high)

**Assumption tested (operationalized):**
> For *this* codebase — TypeScript ESM (NodeNext, `.js` import extensions), `pg` 8 raw driver, hand-written `schema.sql`/`agent-schema.sql` migrations, SSE/Redis fan-out, optimistic-lock `version` fields, 112 queries / 20 files — a **type-safe query builder is a better fit than a full ORM**.

**Refined verdict:** Confirmed — *but the real discriminating axis is schema-ownership, not the query-builder-vs-ORM taxonomy.* The best fit is the candidate that **owns the least** and binds straight to the existing `pg` Pool: **Kysely**. Drizzle, despite the "query-builder" label, owns schema + migrations like the full ORMs and partially fails this codebase's "keep existing SQL migrations" constraint.

---

## Why

1. **Repo-specific anchor (decisive):** `kysely@0.29.2` and `@better-auth/kysely-adapter@1.6.20` are **already in the dependency tree** (transitive via `better-auth ^1.6.20`). Adopting Kysely adds no new core query-builder runtime dependency and aligns the app data layer with the auth layer already present.
2. **ESM/NodeNext fit:** Kysely is pure-ESM friendly with zero decorators / `reflect-metadata`. TypeORM's ESM story is documented-rough (entity glob loading fails: "Cannot use import statement outside a module", "Unknown file extension .ts") — directly relevant given CLAUDE.md's NodeNext + `.js`-extension rule.
3. **Keeps existing hand-written SQL migrations:** Kysely is bring-your-own-migrations — it does not own schema, so the current `schema.sql`/`agent-schema.sql` flow stays. Drizzle/Prisma/TypeORM all want to own schema/migrations.
4. **The issue's pro-TypeORM lean collapses:** `synchronize:true` is officially "don't use in production — you can lose production data," is not TypeORM-unique (Drizzle `push` / Prisma `db push` do the same dev-only thing), and is therefore not a real advantage.

---

## Key evidence

- `@better-auth/kysely-adapter@1.6.20` + `kysely@0.29.2` present in `package-lock.json` — **project lockfile** (primary, repo-specific).
- TypeORM `synchronize:true` data-loss warning — typeorm.io official docs (Data Source Options, Migrations/why) + SO #66771091 (emptied M2M join table), #65222981.
- TypeORM ESM entity-loading failures under `"type":"module"` — SO 2025, Vitest discussion #3290 (Feb 2025), TypeORM CHANGELOG (node16/nodenext since 0.3 but rough).
- Kysely binds to existing `pg` Pool + `sql` template-tag escape hatch + types from existing DB via `kysely-codegen` — Context7 `/kysely-org/kysely`; marmelab "Kysely vs Drizzle" (2025-06-26, hands-on, existing-DB project).
- `drizzle-kit pull`/`introspect:pg` introspects existing DB but Drizzle owns migrations — Context7 `/drizzle-team/drizzle-orm-docs`.
- `synchronize`/`push` are equivalent dev-only footguns across ORMs — makerkit "Drizzle vs Prisma 2026".

### Counter-evidence (honestly weighed)
- **Against Kysely specifically:** complex nested relational reads are more ergonomic in Prisma/Drizzle relational APIs than Kysely's manual joins + aggregation (prisma convergence blog; dev.to). Mild here — the kanban domain is join-shaped, not deeply nested.
- **Against the QB/ORM framing:** Drizzle sits on the "query-builder" side of the claim but behaves like an ORM on schema-ownership (marmelab: existing-DB adoption needs "significant rework"). Hence the verdict was re-cut around schema-ownership.

### Source hygiene
- Down-weighted: kysely.dev testimonial wall (cherry-picked), Reddit thread.
- Leaned on: official TypeORM docs, 2025 ESM failure reports, Context7 primary docs, marmelab hands-on, project lockfile.
- The bundle/runtime-cost row is **qualitative** (not measured this run).

---

## Recommendation (non-binding)

Adopt **Kysely** as the type-safe layer, migrated **incrementally**:
- Generate types from the live DB with `kysely-codegen` (database-first — matches the existing hand-written `schema.sql`).
- Keep `schema.sql`/`agent-schema.sql` as the migration source of truth (Kysely owns nothing there).
- Migrate route-by-route (`settings` → `cards` → `columns` → `board` → rest), keeping `pool.query` and Kysely side-by-side during transition (both share one `pg` Pool).
- Use the `sql` template tag for the fractional-positioning rebalance and any query that resists the builder; keep `recordActivity()` and optimistic-lock `version`/409 logic unchanged.
- Optional later: converge `auth.ts`'s hand-rolled `pool.query` onto the already-present `@better-auth/kysely-adapter`.

---

## What would change this verdict

- **If the team accepts "schema-in-code"** (issue #79 AC explicitly permits "schema defined in one place — code *or* schema file"): Drizzle/Prisma become competitive and the Kysely edge narrows — the verdict leans materially on the "keep hand-written SQL migrations" sub-claim (sensitivity flag).
- **If deeply nested relational reads become common**: Drizzle's relational API / Prisma `include` gain weight over Kysely's manual joins.
- **If `kysely` were removed from the tree** (better-auth swapped/removed): the decisive repo-specific anchor weakens to blog-consensus, dropping confidence high→medium.
