# ADR: Feature-module directory convention

**Date:** 2026-09-16
**Status:** accepted
**Issue:** [#129](https://github.com/rfxlamia/camel/issues/129)
**Spec:** [feature-module-convention.md](../spec/2026-09-16-feature-module-convention/feature-module-convention.md)

## Context

Camel’s client and server are still organized primarily by technical type (`components/`, `routes/`, `pages/`, `context/`, `lib/`). Partial feature grouping exists (`server/src/agent/`, `components/tracker/`) but without import walls those trees behave like renamed type-folders. God files remain (`routes/cards.ts`, `agent/service.ts`, `BoardContext.tsx`, and others). PR #128 split tracker routing while leaving handlers under `routes/`; agents and humans keep adding files in the same flat layout.

At ~113k LOC a single product area often spans four to six directories. Issue #129: without a locked target structure, follow-on splits (#115, #121, #33) would create more type-folder files that must move again. The dual-table work-items shim ([2026-09-board-tracker-dual-table.md](./2026-09-board-tracker-dual-table.md)) stays authoritative; the merge adapter is kernel debt, not a product feature module.

## Decision

**Adopt feature modules with a shared kernel, enforced by a single Node guard (Option A).** Same pattern as `check:mutation-routing`: no Nest/Nx/ESLint boundary plugins, no path aliases, no big-bang `git mv` in the convention PR.

### Layout

| Area | Path | Role |
|------|------|------|
| Client features | `client/src/features/<name>/` | Product UI and client logic per mapped feature |
| Server modules | `server/src/modules/<name>/` | Routes/handlers per mapped feature |
| Client kernel | `client/src/shared/`, `client/src/layout/` | Cross-feature client shared code |
| Server kernel | `server/src/{db,middleware,realtime,validators,core,lib}/` | Platform and generic server code |

**Canonical lists** (feature names, scan roots, shrinking kernel-in-waiting paths): [`scripts/feature-modules/map.mjs`](../../../scripts/feature-modules/map.mjs). Do not duplicate those arrays in prose; update the map when adding a feature or shrinking the allowlist.

**Feature map (summary):** Locked feature names are the `FEATURES` export in `map.mjs` (e.g. `board`, `tracker`, `my-work`, `agent`, `chat`, `focus`, `settings`, `workspaces`, `notifications`, `activity`, `auth`). Same name on client and server when both sides exist. Kernel owns the deletable work-items adapter (`work-item-response.ts`, `work-items.ts`, client `workItemMutations.ts`), taxonomy/parsers, thin hubs (`api.ts`, `helpers.ts`), auth server entry, layout, and platform libs. There is no `features/work-items/` product module.

**Legacy trees** (`server/src/agent/`, `server/src/chat/`, `server/src/notifications/`, `client/src/chat/`): existing files may be edited in place; **new** `.ts`/`.tsx` files there fail placement checks.

### Public API (Rule 4)

- Public surface of a feature is `modules/<f>/index.ts` or `features/<f>/index.ts` (may re-export routers).
- `index.ts` is required when the first non-test file lands in that module tree.
- Composition roots (`server/src/routes.ts`, `server/src/index.ts`, `client/src/App.tsx`, `main.tsx`) import module `index.ts`, not deep paths like `board.routes.ts`.
- Inside a module, relative imports are free. Cross-feature imports use the other feature’s `index.ts` only.
- **One-way:** leftover orchestrators under type-folders may import module `index.ts`; modules must not deep-import leftover **feature** files under type-folders except paths on the shrinking **kernel-in-waiting** allowlist (`KERNEL_IN_WAITING` in `map.mjs`).
- Kernel paths (`shared/`, `server/src/lib`, generic `core`, db, middleware, etc.) may be imported from any feature.

### 300-on-touch (Rule 3)

- Applies to `.ts`/`.tsx` source under scan roots; line count = raw LF newline records.
- New source files must be ≤300 lines.
- If a PR **non-trivially** touches a file already >300 lines, the result in that PR must be ≤300 (extract into `modules/` / `features/` / kernel allowlist; leave a thin orchestrator in type-folders if needed).
- **Grandfathered:** untouched oversized files (e.g. `BoardContext.tsx` ~492) are not forced split by the convention PR itself.
- **Not a touch:** whitespace/format-only; import-specifier-only updates from another file’s move; pure `git mv`/copy with unchanged body.
- **Excluded from 300 rule:** test files (`*.test.ts`, `*.test.tsx`, `*.integration.test.ts`, `*test-support*`), and generated sources (`*.generated.ts`, `*.generated.tsx`, paths containing `/generated/`).

### Placement (Rule 1–2)

- New `.ts`/`.tsx` only in mapped `modules/<feature>/`, `features/<feature>/`, kernel allowlist dirs (`shared/`, `layout/`, `server/src/lib`, etc.), not in closed type-folders (`routes/`, `components/`, `pages/`, `hooks/`, `context/`, `client/src/lib/`, new `__tests__/`, new siblings under `client/src/` or `server/src/` root).
- **Unmapped feature:** placement compares new paths against the **working-tree** `map.mjs` so the same PR can add a feature name and new files together.
- Tests follow the file they test; new tests only in allowed directories, colocated with production code.

### Guard contract (Rule 5)

- Entry point: [`scripts/check-feature-modules.mjs`](../../../scripts/check-feature-modules.mjs).
- Diff base: merge-base of `HEAD` and `origin/main` (default `--base-ref origin/main`) for new/modified classification; import walls scan configured roots per the script.
- If `origin/main` (or the configured base ref) is missing or merge-base cannot be computed, the guard **fails loud** (`FM-RULE-5`) — no silent pass.
- **CI** must fetch enough git history that `origin/main` exists locally; shallow clones without the base ref break the guard.
- Violations report rule id, path, and line count or import specifier as applicable.
- Verify locally: `npm run check:feature-modules` when wired; full gate: `make check` (alongside `check:mutation-routing`).

### Hotfix sequence (after convention PR)

Not in the convention PR — one boundary per follow-up PR:

1. **Kernel extract** — Move kernel-in-waiting files (taxonomy, vocabulary-response, work-items adapter pieces, shared client utils) into `server/src/lib` / `client/src/shared`; remove paths from `KERNEL_IN_WAITING`.
2. **Tracker relocate** — `git mv` tracker-owned leftovers into `modules/tracker/` and `features/tracker/` (pure moves with identical content are OK).
3. **Later splits** — #115 (`cards.ts`), #121 (`agent/service.ts`), and any future touch of oversized leftovers (including BoardContext when next non-trivially edited) land directly under `modules/` / `features/` with `index.ts`.

Extract kernel before a module would otherwise import non-allowlisted `routes/*`.

## Consequences

### Positive

- Agents and humans get a single enforced map; new code cannot expand forbidden type-folders.
- God-file splits target final homes instead of interim `routes/` growth.
- One script covers placement, 300-on-touch, and import walls; aligns with existing CI script culture.

### Negative

- Hand-rolled import scanning must stay in sync with NodeNext `.js` specifiers.
- Kernel `lib/` and `shared/` need review discipline to avoid dump zones.
- Stacked PRs depend on correct merge-base and fetched `origin/main`.

### Explicitly unchanged

- Dual-table write routing and `workItemMutations.ts` behavior ([ADR dual-table](./2026-09-board-tracker-dual-table.md)).
- **BoardContext** is not required to split in the convention PR; 300-on-touch applies only when that file is next non-trivially touched.
- HTTP contracts, schema, and production API paths.

## References

- [`scripts/feature-modules/map.mjs`](../../../scripts/feature-modules/map.mjs) — `FEATURES`, `SCAN_ROOTS`, `KERNEL_IN_WAITING`
- [`scripts/check-feature-modules.mjs`](../../../scripts/check-feature-modules.mjs) — CLI dispatcher
- [`scripts/feature-modules/git-diff.mjs`](../../../scripts/feature-modules/git-diff.mjs) — merge-base diff helper
- [`docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md`](../spec/2026-09-16-feature-module-convention/feature-module-convention.md) — full GWT scenarios
