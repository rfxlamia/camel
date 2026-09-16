# Feature-module directory convention

**Date:** 2026-09-16
**Status:** approved
**Author:** brainstorm session
**Issue:** [#129](https://github.com/rfxlamia/camel/issues/129)
**Spec path:** `docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md`

---

## Summary

Adopt a Nest/Angular-inspired feature-module convention for Camel's React + Express monorepo, enforced in CI from day 1 so coding agents cannot keep growing type-folders. The convention PR documents the map, adds `client/src/shared/`, and ships a Node guard in the same style as `check:mutation-routing`. Physical `git mv` / kernel extracts are follow-up hotfix PRs that must satisfy the same guard. This is a prerequisite so god-file splits (#115, #121, #33) land in their final home instead of creating more files under `routes/` and `components/`.

---

## Context

### Current State

The repo is organized by technical type (`client/src/{components,hooks,pages,context,lib}`, `server/src/{routes,core,lib}`). Partial feature grouping already exists (`components/tracker`, `server/src/agent`, `server/src/chat`) but those are not module boundaries: any file may import any other file.

PR #128 split `tracker-items.ts` into a thin router still under `routes/`. Oversized files remain, including `agent/service.ts` (~1261), `client/src/api.ts` (~1055), `routes/cards.ts` (~999), `pages/TrackerPage.tsx` (~906), `BoardContext.tsx` (~492 after PR #126). Enforcement today is a custom Node script (`scripts/check-work-item-mutation-routing.mjs`) wired into `make check` and CI. There are no path aliases and no `eslint-plugin-boundaries` / dependency-cruiser.

Shared code is mis-homed: `tracker-item-parsers.ts` is used by `cards.ts`; `tracker-assignees.ts` by My Work and `work-item-response.ts`; client `trackerUtils` / `TrackerGlyphs` by board taxonomy. Dual-table merge lives in `work-item-response.ts` and `workItemMutations.ts` (ADR: shim, not a product feature).

### Problem / Motivation

At ~113k LOC, one feature is scattered across 4–6 type-folders. Nothing structurally prevents god files. Agents copy the visible type-folder layout. Issue #129: without a target structure, splits #115 / #121 / #33 create more files in the same flat folders and get moved again later.

### Related Areas

- Docs: `AGENTS.md`, `CLAUDE.md`, `docs/pocket/adr/2026-09-board-tracker-dual-table.md`
- CI: `scripts/check-work-item-mutation-routing.mjs`, `Makefile` `check`, `.github/workflows/ci.yml`
- Server: `server/src/routes.ts`, `server/src/index.ts`, `server/src/agent/`, `server/src/chat/`, `server/src/notifications/`, `server/src/routes/*`
- Client: `client/src/App.tsx`, `client/src/api.ts`, `client/src/lib/`, `client/src/pages/`, `client/src/components/`
- Follow-on issues: #115 (`cards.ts`), #121 (`agent/service.ts`), #33 / PR #126 (`BoardContext` leftover), tracker first-adopter relocate after kernel extract

---

## Scope

### In-Scope

- Write the feature-module convention in `AGENTS.md` / `CLAUDE.md` and an ADR under `docs/pocket/adr/`.
- Day-1 complete feature map (client `features/` + server `modules/` + named kernel).
- Create `client/src/shared/` in the convention PR (kernel home for new client shared code).
- CI guard (`scripts/check-feature-modules.mjs` or equivalent) covering: new-file placement, 300-line rules, public-API / deep-import walls, shrinking kernel-in-type-folder allowlist.
- Wire the guard into `make check` and CI beside `check:mutation-routing`.
- Document hotfix sequence after the convention PR (kernel extract → feature `git mv`), without performing those moves in the convention PR.

### Out-of-Scope

- Big-bang `git mv` of every feature in the convention PR — later hotfix PRs, one boundary per PR.
- Forcing #115 / #121 / #33 in the convention PR. Those fire when the oversized files are next **non-trivially** touched (see 300-on-touch).
- Nest / Nx / Angular / ESLint migration.
- HTTP contract, schema, or dual-table write-routing changes (`workItemMutations.ts` behavior stays).
- Path aliases or a new module loader.
- `camel-lottie/` (already excluded from root lint).

---

## Architecture Constraints

- **Layers this work may touch:** `AGENTS.md`, `CLAUDE.md`, `docs/pocket/adr/`, `scripts/`, `package.json`, `Makefile`, `.github/workflows/ci.yml`, empty or barrel-only `client/src/shared/` (and optionally empty `modules/` / `features/` trees if needed for the map fixture). Tests for the guard script.
- **Layers this work must NOT touch:** runtime handlers, Kysely schema, SSE, `workItemMutations` routing logic, BoardContext behavior, production API paths.
- **Patterns that must be followed:** NodeNext `.js` imports on server; existing custom-script CI pattern; `npm run test` from repo root; dual-table ADR remains authoritative for work-items.
- **Architecture validation result:** PASS (Option A — single Node guard).

---

## Dependencies

### Existing (to leverage)

- Node built-ins (`fs`, `path`) — same as `scripts/check-work-item-mutation-routing.mjs`
- `git` in CI/dev — merge-base vs `origin/main`, rename detection
- Biome — unchanged; this guard is not a Biome rule

### New (proposed)

none. Import-boundary libraries (dependency-cruiser, ESLint boundaries) were rejected: they do not cover 300-on-touch, git-rename grandfather, import-path-only exceptions, or the shrinking kernel allowlist. Those rules are the actual product of this spec.

---

## Feature map (day 1)

### Features

Same name on `server/src/modules/<name>/` and `client/src/features/<name>/` when both sides exist.

| Feature | Owns |
|---------|------|
| `board` | cards, columns, card-attachment **routes**, BoardContext, BoardPage, calendar, column templates, dashboard **shell** |
| `tracker` | items, projects, phases, vocabularies, tracker pages |
| `my-work` | My Work page and client/server my-work cluster |
| `agent` | agent board/service/tools, **nested ticket-intake**, HistoryPage |
| `chat` | chat routes/UI (`server/src/chat/` and `client/src/chat/` are legacy trees) |
| `focus` | focus session + FocusIndicator hosted in layout |
| `settings` | workspace logo / board_name settings |
| `workspaces` | workspace, members, invites, ManageMembersSection |
| `notifications` | notifications backend + **InboxPage** (not a peer feature) |
| `activity` | card/tracker/unified events (not agent HistoryPage) |
| `auth` | client pages only (AuthPage, EmailGatePage, PickUsernamePage). Server `auth.ts` stays kernel |

### Kernel (not a feature)

- Work-items **adapter**: `work-item-response.ts`, `work-items.ts` URL rewrite, client `workItemMutations.ts`. No product screens. **Deletable** when tables merge (ADR #103).
- Taxonomy: parsers, `vocabulary-response`, client `trackerUtils` / glyphs (shared by board + tracker + settings).
- Task-entry shell (AddCard and TrackerCreate).
- Attachment **platform** libs (`server/src/lib/attachment-*`); card attachment routes stay `board`; chat attachments stay `chat`.
- Presence + realtime; oauth + `auth.ts`.
- `helpers.ts`, `client/src/api.ts` / `types.ts` (thin remaining hubs).
- Layout + chrome + LandingPage.
- `db/`, `middleware/`, `realtime/`, `validators/`, `server/src/core/` (generic), `server/src/lib/` (platform).
- Feature-specific files currently in `core/` (`my-work-*`, `focus-session`, `metrics`, board/tracker status helpers) move with that feature's hotfix.

### Legacy trees treated like type-folders

Existing `server/src/agent/`, `server/src/chat/`, `server/src/notifications/`, `client/src/chat/` may be **edited in place**. **New files there fail.** New files go to `modules/<feature>/` or `features/<feature>/`.

---

## Stories + Scenarios

### Story: New code lands in the mapped home

> As a coding agent or human contributor, I want CI to reject new files in type-folders and unmapped modules, so that the convention is real on day 1 even before most code has moved.

**Rule 1: Placement allowlist**

- Allowed new `.ts`/`.tsx`: `server/src/modules/<mapped-feature>/`, `client/src/features/<mapped-feature>/`, `server/src/{db,middleware,realtime,validators,core,lib}`, `client/src/{layout,shared}`.
- Forbidden new `.ts`/`.tsx`: `routes/`, `components/`, `pages/`, `hooks/`, `context/`, `client/src/lib/`, `server/src/{agent,chat,notifications}/`, `client/src/chat/`, `server/src/__tests__/`, new siblings at `client/src/` or `server/src/` root.
- Unmapped `modules/billing/` or `features/billing/` fails until the map on `origin/main` includes it (or the same PR updates the map).
- `.css`, `.md`, JSON fixtures, SQL, snapshots: placement rule does not apply.
- `camel-lottie/`: ignored.

```gherkin
Scenario: New board handler in the module tree
  Given the convention guard is enabled and board is on the map
  When a contributor adds server/src/modules/board/cards-update.ts (≤300 lines) and modules/board/index.ts re-exports it
  Then the guard passes

Scenario: New board handler in routes/
  Given the convention guard is enabled
  When a contributor adds server/src/routes/cards-update.ts
  Then the guard fails with a placement rule id and path

Scenario: New page file
  Given pages/ is a type-folder
  When a contributor adds client/src/pages/ReportsPage.tsx
  Then the guard fails

Scenario: New kernel helper on the client
  Given client/src/shared/ exists
  When a contributor adds client/src/shared/taxonomy/sortVocab.ts (≤300 lines)
  Then the guard passes

Scenario: New kernel helper on the server lib
  Given server/src/lib/ is a kernel allowlist path
  When a contributor adds server/src/lib/attachment-foo.ts (≤300 lines)
  Then the guard passes

Scenario: New file in client/src/lib/
  Given client/src/lib/ is closed to new files
  When a contributor adds client/src/lib/foo.ts
  Then the guard fails

Scenario: New agent tool in the legacy tree
  Given server/src/agent/ is a legacy feature tree
  When a contributor adds server/src/agent/tools/newTool.ts
  Then the guard fails
  And the file must be added under server/src/modules/agent/ instead

Scenario: Unmapped feature folder
  Given billing is not on the feature map compared to origin/main
  When a contributor adds server/src/modules/billing/x.ts
  Then the guard fails

Scenario: New src-root sibling
  Given client/src/api.ts already exists
  When a contributor adds client/src/apiClient.ts
  Then the guard fails

Scenario: Existing src-root file edited in place (already ≤300)
  Given server/src/config.ts is an existing root file ≤300 lines
  When a contributor edits it without adding a new root sibling
  Then the guard passes (placement)
```

**Rule 2: Tests follow the file they test**

- New tests only in allowed directories, colocated.
- Existing type-folder tests may be edited in place.
- The 300-line rule does not apply to test files (`*.test.ts`, `*.test.tsx`, `*.integration.test.ts`, `*test-support*`).
- Tests inside a module may import that module's internals.
- Tests outside a module may import only that module's public API.

```gherkin
Scenario: New test beside leftover routes/cards.ts
  Given cards.ts still lives under routes/
  When a contributor adds server/src/routes/cards.write.test.ts
  Then the guard fails (new file in forbidden tree)

Scenario: Colocated module test
  Given cards-update.ts lives in modules/board/
  When a contributor adds modules/board/cards-update.test.ts that imports ./cards-update.js
  Then the guard passes

Scenario: New file under server/src/__tests__/
  Given __tests__/ is closed to new files
  When a contributor adds server/src/__tests__/foo.test.ts
  Then the guard fails
```

---

### Story: Oversized files cannot be drive-by grown

> As a maintainer, I want any non-trivial edit to a source file over 300 lines to leave that file at ≤300 lines in the same PR, so agents cannot pad god files to dodge the new-file rule.

**Rule 3: 300-line ceiling**

- Count = raw newline records on `.ts`/`.tsx` source (repo is LF).
- New source files >300 lines fail.
- If a PR **non-trivially** modifies a source file that is currently >300 lines, the result must be ≤300. Extracts land in `modules/` / `features/` / kernel allowlist, not type-folders. Leftover type-folder file becomes an orchestrator (parse/mount/import) ≤300 calling the module **public API**.
- Untouched oversized files are grandfathered. The convention PR must not modify `BoardContext.tsx`; it may stay ~492.
- **Not a touch:** whitespace/format-only; import-specifier-only updates caused by another file's move; git rename/copy with unchanged content (grandfather follows the path).
- **Is a touch:** any other content hunk (logic, comments, new exports).
- Test and generated files excluded.

```gherkin
Scenario: One-line logic edit to cards.ts without extract
  Given server/src/routes/cards.ts is ~999 lines
  When a contributor changes a handler body and does not extract
  Then the guard fails until cards.ts is ≤300 and new files are under modules/board/

Scenario: Extract on touch
  Given cards.ts is ~999 lines
  When the PR extracts logic to modules/board/* (each ≤300), adds index.ts public API, and leaves cards.ts ≤300 importing that index
  Then the guard passes

Scenario: Untouched BoardContext in the convention PR
  Given BoardContext.tsx is ~492 lines and the convention PR does not modify it
  Then the guard passes

Scenario: New module file 301 lines
  Given a new file server/src/modules/board/cards-update.ts
  When it contains 301 lines
  Then the guard fails

Scenario: Pure git mv of an oversized tracker file
  Given tracker-item-update.ts is 521 lines
  When the PR only git-mv's it to modules/tracker/ with identical content
  Then the 300-new-file rule does not fail
  And grandfather moves with the file

Scenario: Rename plus non-trivial edit
  Given the same 521-line file is renamed into modules/tracker/ and its body is edited
  Then the destination file must be ≤300 in that PR

Scenario: Format-only on BoardContext
  Given BoardContext.tsx is 492 lines
  When the only diff is whitespace/formatting
  Then the 300-on-touch rule does not fire

Scenario: Import-path-only update on cards.ts
  Given cards.ts is 999 lines
  When the only change is import specifiers because a helper moved
  Then the 300-on-touch rule does not fire

Scenario: Oversized test file
  Given a test file is 800 lines
  When it is edited or added under an allowed path
  Then the 300 rule does not apply
```

---

### Story: Nest-style module walls

> As a contributor, I want outside code to depend only on a module's public API, so folders are real boundaries rather than renamed type-folders.

**Rule 4: Public API**

- Public API of a feature module is `modules/<f>/index.ts` (client: `features/<f>/index.ts`). The index may re-export the router.
- `index.ts` is required when the **first** file lands in that module. Empty stubs for unused features are not required on day 1.
- Composition roots (`server/src/routes.ts`, `server/src/index.ts`, `client/src/App.tsx`, `main.tsx`) import that `index.ts`, not `board.routes.ts`.
- Inside a module, files may import each other freely.
- Feature A may import Feature B's `index.ts` only (Nest `exports`).
- Deep imports fail, including `import type`, dynamic `import()`, and `export * from` a non-index path.
- Feature modules must not import leftover **feature** files under type-folders (one-way: old orchestrator → new module index is allowed; reverse is not).
- **Shrinking allowlist:** kernel files still living under type-folders may be imported by modules until extracted: at least `work-item-response.ts`, `work-items.ts`, `helpers.ts`, `vocabulary-response.ts`, `tracker-item-parsers.ts` (and documented equivalents such as `client/src/lib/workItemMutations.ts` while it remains kernel-in-waiting). Each extract hotfix removes entries.
- Kernel paths (`shared/`, `server/src/lib`, `core` generic, db, middleware, …) may be imported by any feature.
- There is no `features/work-items/` product module. New product UI there fails.

```gherkin
Scenario: Orchestrator imports module internals
  Given cards-update.ts lives in modules/board/cards-update.ts
  When routes/cards.ts imports ../modules/board/cards-update.js
  Then the guard fails (deep import)

Scenario: Orchestrator imports public API
  Given modules/board/index.ts re-exports updateCard
  When routes/cards.ts imports ../modules/board/index.js
  Then the guard passes

Scenario: Same-module internal import
  Given two files in modules/board/
  When cards-update.ts imports ./cards-repo.js
  Then the guard passes

Scenario: Cross-feature public API
  Given features/activity/index.ts exports describeEvent
  When features/board imports from features/activity/index.ts
  Then the guard passes

Scenario: Cross-feature deep import
  When features/board imports features/activity/describeEvent.ts
  Then the guard fails

Scenario: Module imports leftover same-feature type-folder file
  When modules/board/x.ts imports routes/card-response.js
  Then the guard fails (one-way; not on kernel allowlist)

Scenario: Module imports leftover client feature tree
  When features/my-work/x.tsx imports components/my-work/MyWorkList.tsx
  Then the guard fails until that file is moved or exposed via features/my-work/index.ts

Scenario: Module imports kernel-in-waiting adapter
  When modules/board/x.ts imports routes/work-item-response.js
  Then the guard passes until that path is removed from the shrinking allowlist

Scenario: Composition root imports board.routes.ts
  When server/src/routes.ts imports modules/board/board.routes.js
  Then the guard fails
  And it must import modules/board/index.js instead

Scenario: First module file without index.ts
  When the first file is added under modules/board/ and index.ts is missing
  Then the guard fails

Scenario: Product feature named work-items
  When a contributor adds client/src/features/work-items/WorkItemsPage.tsx
  Then the guard fails (work-items is kernel adapter, not a mapped feature)
```

**Rule 5: Guard contract**

- Diff base: `origin/main` merge-base (stacked PRs still fail unmapped folders vs main).
- Invoked from `make check` and CI, same as mutation-routing.
- Violation messages include rule id, path, and line count or import specifier.
- Rollback: delete the script and revert docs; no data migration.

```gherkin
Scenario: Stacked PR adds unmapped module before the map is on main
  Given origin/main does not list billing
  When a stacked branch adds modules/billing/x.ts
  Then the guard fails against the origin/main merge-base
```

---

## Acceptance Criteria

```
ACCEPTANCE CRITERIA — Feature-module directory convention
Date: 2026-09-16 | Scope confirmed: yes

Rule: Placement allowlist
  ✓ Given board is on the map, When adding modules/board/cards-update.ts (≤300) + index.ts, Then guard passes
  ✓ Given shared/ exists, When adding client/src/shared/taxonomy/sortVocab.ts (≤300), Then guard passes
  ✓ Given server/src/lib is kernel, When adding server/src/lib/attachment-foo.ts (≤300), Then guard passes
  ✗ Given routes/ is closed, When adding routes/cards-update.ts, Then placement failure (rule id + path)
  ✗ Given pages/ is closed, When adding pages/ReportsPage.tsx, Then placement failure
  ✗ Given client/src/lib/ is closed, When adding client/src/lib/foo.ts, Then placement failure
  ✗ Given legacy agent/ tree, When adding server/src/agent/tools/newTool.ts, Then placement failure
  ✗ Given billing not on the map vs origin/main, When adding modules/billing/x.ts, Then placement failure
  ✗ Given src root, When adding a new sibling client/src/apiClient.ts, Then placement failure

Rule: Tests
  ✗ Given leftover routes/cards.ts, When adding routes/cards.write.test.ts, Then placement failure
  ✓ Given modules/board/cards-update.ts, When adding colocated cards-update.test.ts importing ./cards-update.js, Then pass
  ✗ Given server/src/__tests__/, When adding a new file there, Then placement failure
  ✓ Given an 800-line test file under an allowed path, When edited, Then 300 rule does not apply

Rule: 300-on-touch
  ✗ Given cards.ts ~999 lines, When a handler body changes without extract, Then fail until file ≤300 and extracts are in modules/board/
  ✓ Given that extract + leftover orchestrator ≤300 importing modules/board/index.js, Then pass
  ✓ Given convention PR does not modify BoardContext.tsx (~492), Then pass
  ✗ Given new modules/board/file.ts with 301 lines, Then fail
  ✓ Given git mv of 521-line tracker file with identical content into modules/tracker/, Then 300-new-file does not fail
  ✗ Given rename + body edit of that file, Then destination must be ≤300
  ✓ Given whitespace/format-only diff on BoardContext.tsx, Then 300-on-touch does not fire
  ✓ Given import-specifier-only update on cards.ts from another move, Then 300-on-touch does not fire

Rule: Public API / one-way imports
  ✗ Given routes/cards.ts imports modules/board/cards-update.js, Then deep-import failure
  ✓ Given it imports modules/board/index.js, Then pass
  ✓ Given in-module relative import, Then pass
  ✓ Given features/board imports features/activity/index.ts, Then pass
  ✗ Given features/board imports features/activity/describeEvent.ts, Then deep-import failure
  ✗ Given modules/board imports routes/card-response.js, Then one-way failure
  ✓ Given modules/board imports allowlisted routes/work-item-response.js, Then pass until extract removes it
  ✗ Given routes.ts imports modules/board/board.routes.js, Then fail (must use index.ts)
  ✗ Given first files in modules/board/ without index.ts, Then fail
  ✗ Given features/work-items/ product page, Then fail (adapter is kernel)

Rule: Docs + wiring
  ✓ Given convention PR, When merged, Then AGENTS.md/CLAUDE.md + ADR describe the map, public API, 300 rules, hotfix sequence
  ✓ Given make check and CI, When run, Then the new guard runs beside check:mutation-routing
```

---

## Design Decision

**Chosen option:** Option A — single Node guard (`scripts/check-feature-modules.mjs` or equivalent), plus docs/ADR/`client/src/shared/`.

**Summary:** Placement, 300-on-touch (with rename / whitespace / import-path exceptions), deep-import walls, and the shrinking kernel allowlist are one script following `check-work-item-mutation-routing.mjs`. No new npm dependencies.

**Rejected options:**

- Option B (dependency-cruiser + small script): rejected because the discriminating scenarios (300-on-touch, git rename, import-path-only, shrinking allowlist) stay custom; two tools for a Biome-only repo.
- Option C (ESLint boundaries + path aliases): fails 300-on-touch and rename rules; violates “no path aliases unless required.”

**Key tradeoffs accepted:**

- Hand-rolled import scan (NodeNext `.js` aware) instead of a graph library.
- Kernel `server/src/lib` and `client/src/shared` can become dump zones; docs/review catch that, not CI classification of “feature vs kernel” by filename.
- Next non-trivial touch of god files forces ≤300 in that PR (may absorb #115/#121/#33 then). Convention PR itself does not touch them.

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| Diff base for new vs modified | assumed: `origin/main` merge-base | Stacked PRs vs other bases misclassify files |
| Line count | assumed: raw LF newline records | CRLF checkout could disagree; repo is LF |
| File types | assumed: `.ts`/`.tsx` only | A new `.mts` or `.js` source file would be invisible |
| `workItemMutations.ts` until client extract | assumed: kernel-in-waiting equivalent on the shrinking allowlist | Features importing `client/src/lib/workItemMutations.ts` might fail until listed |
| Empty `modules/` trees on day 1 | assumed: not required until first file lands (with `index.ts`) | Agents may not see folders until first extract |

---

## Implementation Notes

Convention PR (this spec's implementation packet) should:

1. Add ADR + AGENTS.md/CLAUDE.md (map, public API, 300 rules, one-way imports, hotfix order).
2. Create `client/src/shared/` (placeholder export or README-equivalent barrel if required by the guard).
3. Encode the feature map and shrinking kernel allowlist as data the script reads (single source of truth, not duplicated prose-only).
4. Implement the guard with tests (fixture trees or unit tests of rule functions).
5. Wire `package.json` + `make check` + CI.

**Hotfix order after the convention PR** (not this packet; each PR one boundary):

1. Extract kernel-in-waiting files (taxonomy parsers, vocabulary-response, work-items adapter, glyphs/utils, task-entry) into `server/src/lib` or `client/src/shared`; shrink the allowlist.
2. `git mv` remaining tracker-owned files into `modules/tracker/` + `features/tracker/` (pure moves OK if content unchanged).
3. Subsequent splits (#115 board, #121 agent, leftover BoardContext if next touched) land directly in `modules/` / `features/` with `index.ts`.

Dependency closure: extract kernel **before** a module file that would otherwise import non-allowlisted `routes/*`.

Do not put product behavior in the work-items kernel adapter.

---

## Rollback Plan

- Revert the convention PR: remove the script, npm/`make`/CI wiring, ADR, AGENTS.md/CLAUDE.md sections, and `client/src/shared/` if unused.
- No database or API rollback.
- Later hotfix moves revert with `git mv` back; the guard would need to be disabled or the map rolled back first if those PRs already merged.
