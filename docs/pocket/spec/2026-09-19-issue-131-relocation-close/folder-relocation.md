# Issue #131 feature-module folder relocation close path

**Date:** 2026-09-19
**Status:** approved
**Author:** brainstorm session
**Spec path:** docs/pocket/spec/2026-09-19-issue-131-relocation-close/folder-relocation.md
**GitHub:** [#131](https://github.com/rfxlamia/camel/issues/131)

---

## Summary

Finish GitHub #131 by relocating remaining mapped product leftovers into `client/src/features/<name>/` and `server/src/modules/<name>/`, and by moving true cross-cutting chrome/helpers into `client/src/shared/` and `server/src/lib/`. This is a sequenced `git mv` program (one FEATURES name per PR, client+server together). It is not a god-file split, HTTP/schema change, or UI rewrite. Close the issue only from the last packet that meets the close rule. Pages stay leftover orchestrators. Tracker re-export stubs stay as thin orchestrators. The 300-on-touch ceiling stays 300.

---

## Context

### Current State

- Convention + CI guard already merged (#129 / PR #130). `KERNEL_IN_WAITING` is empty.
- Only feature trees that exist: `client/src/features/tracker/` (UI + tests + `index.ts`) and `server/src/modules/tracker/` (routers + `index.ts`).
- Tracker production bodies are already in `features/tracker/`. `client/src/components/tracker/` is thin default re-export stubs so oversized Tracker pages keep default imports.
- Remaining product leftovers live under client type-folders (`components/`, `hooks/`, `context/`, `lib/`, `client/src/chat/`) and server trees (`routes/`, `agent/`, `chat/`, `notifications/`). Composition hubs (`App.tsx`, `api.ts`, `server/src/routes.ts`, `index.ts`, `auth.ts`) stay.
- All client `pages/` files stay in `pages/`. Auth screen components (`AuthPage`, `EmailGatePage`, `PickUsernamePage`) currently live under `components/` and must be `git mv`'d into `pages/` so they match the page-orchestrator rule.

### Problem / Motivation

#131 stays open until mapped product leftovers are relocated or documented as thin orchestrators / 300-on-touch grandfathers. A single kernel extract or tracker seed must not `closes` the issue (the #129 failure mode). Remaining surface is too wide for one-boundary hotfix loops; this spec packetizes the rest so the issue can close without splitting `cards.ts` / `agent/service.ts` / BoardContext.

### Related Areas

- ADR: `docs/pocket/adr/2026-09-16-feature-module-convention.md`
- Dual-table kernel (unchanged): `docs/pocket/adr/2026-09-board-tracker-dual-table.md`
- Map + guard: `scripts/feature-modules/map.mjs`, `scripts/check-feature-modules.mjs`
- Cycle Map locks: `scripts/feature-modules/git-diff.test.mjs`
- Follow-up splits after files live in modules: #115 (`cards.ts`), #121 (`agent/service.ts`)

---

## Scope

### In-Scope

- `git mv` leftover product files for each FEATURES name into `features/<name>/` and `modules/<name>/` (client+server in the same PR when both sides exist)
- FEATURES names: `board`, `tracker` (already seeded; residual is stub documentation only), `my-work`, `agent`, `chat` (including `client/src/chat/`), `focus`, `settings`, `workspaces`, `notifications`, `activity`, `auth`
- True cross-cutting chrome/helpers → `client/src/shared/` or `server/src/lib/` **before** a module would import leftover type-folder paths
- `AuthPage`, `EmailGatePage`, `PickUsernamePage` → `client/src/pages/` (then they stay there)
- Public `index.ts` per new tree; composition roots and leftover pages import the index only
- Colocate tests next to moved production files; page tests stay next to pages
- Cycle Map path lock updates
- Mutation-routing allowlist path update if `BoardContext` moves
- Progress comments on #131 with `refs #131` until the last packet, which may `closes #131`

### Out-of-Scope

- Splitting god files to ≤300 (#115, #121, BoardContext, TrackerPage, and other fat files stay follow-ups **after** they live in the allowed tree)
- Temporarily raising `LINE_BUDGET_MAX` from 300 to 500
- Deleting tracker (or future) thin re-export stubs; they are documented orchestrators so oversized pages keep default imports
- Moving files already under `client/src/pages/` into `features/`
- Runtime / HTTP / schema / dual-table / `workItemMutations` behavior changes
- `features/work-items/` or treating the merge adapter as a product feature
- Adding `dashboard` (or other new names) to `FEATURES`; `DashboardPage.tsx` stays in `pages/`
- One PR big-bang of all FEATURES
- UI redesign / product behavior changes
- Filling `shared/index.ts` (stays `export {}`)

---

## Architecture Constraints

- Layers this work may touch: `features/`, `modules/`, leftover type-folders (mv + specifier), `pages/` only for the three auth screens currently under `components/`, `shared/` / `server/src/lib/` for agreed cross-cutting files, `App.tsx`, `server/src/routes.ts`, `server/src/index.ts`, Cycle Map, CODEOWNERS, mutation-routing allowlist paths
- Layers this work must NOT touch: schema SQL, dual-table write routing behavior, `KERNEL_IN_WAITING` (stays `[]`), `shared/index.ts` body, HTTP contracts, `LINE_BUDGET_MAX`
- Patterns: tracker `index.ts`; `git mv` with rename detection; FM-RULE-1/3/4/5; NodeNext `.js` on server; client bundler without extensions; one-way import wall; leftover orchestrators may import module `index.ts`; modules must not import leftover type-folder feature files
- Architecture validation result: PASS (see Phase 6 in the grinding session)

---

## Dependencies

### Existing (to leverage)

- Node `fs` / git rename detection (`git mv`, `git diff -M`) — relocate mechanics already used in PR #132–#155
- `scripts/check-feature-modules.mjs` + Cycle Map tests — acceptance
- Existing tracker public `index.ts` as the copy pattern

### New (proposed)

none. This is internal folder layout, not a commodity library problem (crypto/auth/parsing/retry/validation). No new npm dependency.

---

## Stories + Scenarios

### Story: Per-feature relocate packet

> As a Camel maintainer, I want leftover product files for exactly one FEATURES name moved into `features/<name>/` and `modules/<name>/` in a single PR (client + server together), while pages stay in `pages/`, so #131 progresses without a big-bang dump or import-wall failure.

**Rule 1: One FEATURES name per PR; pages already in `pages/` never move.**
- Example A: my-work components/lib + server `routes/my-work*` move; `MyWorkPage.tsx` stays; `App.tsx` still lazy-imports `./pages/MyWorkPage`.
- Example B: a PR that also moves chat files with my-work is invalid.

**Rule 2: Path-only relocate; light format only on files that stay ≤300; fat files are specifier-only.**
- Example C: `AddCard` body unchanged; import specifiers retarget.
- Example D: Biome import-order rewrite on 492-line `BoardContext` is reverted on that file (not split). If FM-RULE-3 still fails, revert the whole packet.

**Rule 3: Public index; outside the module import index only.**
- Example E: leftover `DashboardPage` / `AppLayout` import `features/board` index after `BoardContext` moves, not `features/board/BoardContext`.

**Rule 4: Tests move with production files; page tests stay with pages; test file count must not drop.**
- Example F: deleting a broken test instead of moving it is invalid.

**Rule 5: Fail → path/mock fix only, else revert the whole packet.**
- Example G: leftover `vi.mock` path updated → green. Matcher/logic edit → rejected.

**Rule 6: Oversized product files `git mv` as-is. #115 / #121 stay open.**
- Example H: `cards.ts` (999) lands in `modules/board/`; #115 remains open.

**Rule 7: No new type-folder stubs. Existing tracker stubs stay. No `features/work-items/`.**

**Rule 8: `client/src/chat/` is chat product and moves in the chat packet with a public index. `ChatPage` stays in `pages/`.**

```gherkin
Scenario: Happy path one feature packet without moving the page
  Given leftover my-work components and server my-work routes exist under type-folders
  And MyWorkPage.tsx lives under client/src/pages/
  When the maintainer git-mvs product files into features/my-work and modules/my-work
  And adds index.ts and retargets the page and hubs to those indexes
  And colocates tests for moved production files
  Then check:feature-modules and npm run test pass
  And test file count is not lower than before
  And MyWorkPage.tsx path is unchanged
  And no other FEATURES tree is created in that PR

Scenario: Two features in one PR rejected
  Given a branch that moves both my-work and chat leftover product files
  When the packet is reviewed against the one-name rule
  Then it is split and chat files are not merged in the my-work PR

Scenario: Fat file format reverted not split
  Given BoardContext.tsx is 492 lines and is git-mv'd to features/board/
  When biome reorders imports and check:feature-modules reports FM-RULE-3
  Then import-order hunks on that file are reverted
  And the file is not split
  And if still red the whole packet is reverted

Scenario: Logic change not allowed
  Given an agent relocate PR
  When a test fails and the maintainer changes a matcher or service branch to go green
  Then that change is rejected
  And the move is reverted if path-only fixes do not make tests pass

Scenario: cards.ts moves without closing #115
  Given server/src/routes/cards.ts is 999 lines
  When it is git-mv'd to server/src/modules/board/ with rename or specifier-only hunks
  Then routes.ts imports modules/board/index.js
  And GitHub issue #115 stays open

Scenario: BoardContext consumers use the board index
  Given BoardContext git-mvs to features/board
  When leftover pages, App.tsx, and layout specifiers are updated
  Then they import from features/board index only
  And the mutation-routing allowlist path is updated in the same PR

Scenario: client/src/chat/ moves with chat
  Given ChatRuntimeProvider and adapters live under client/src/chat/
  When the chat packet runs
  Then those files live under features/chat/ with index.ts
  And ChatPage.tsx stays under pages/
```

### Story: Kernel and shared extracts before one-way would fail

> As a maintainer, I want chrome and true cross-cutting files in `shared/` / `lib/` before any `features/<name>/` or `modules/<name>/` file would import a leftover type-folder path.

**Rule 9: Shared chrome extract is not a FEATURES product name.** Chrome includes Toast, ToastContext, PresenceBar, PresenceContext, PageHeader, EmptyState, LoadingCamel, SuccessAnimation, `lib/title.ts`, and `ToolTrace` (plus `lib/toolTrace.ts` when agent+chat share it). All specifiers (layout, leftover pages, tests) retarget in that PR. Tests colocate under `shared/`. `shared/index.ts` stays `export {}`.

**Rule 10: Cross-feature and/or kernel files extract to `shared/` / `lib/` first.** Includes at least `card-assignees.ts`, `card-response.ts` when kernel + my-work/board share it, `types/myWork.ts` (kernel `workItemMutations` + my-work), Workspace/ticket-intake client files when layout + multiple FEATURES import them, and `lib/agentQueue.ts` when both chat (`useChatStream`) and agent (`useAgentChat`, `AgentChatPanel`) import it. **BoardContext stays board product** (moves in the board packet, not to `shared/`).

**Rule 11: Auth screens currently under `components/` `git mv` to `pages/`**, then remain leftover orchestrators. `App.tsx` specifiers follow. `auth.ts` server entry stays kernel; product `oauth` / `oauth-bridge` move in the auth FEATURES packet.

```gherkin
Scenario: Chrome extract retargets every importer
  Given PageHeader lives under client/src/components/ and layout plus many pages import it
  When chrome is git-mv'd to client/src/shared/
  Then every specifier is updated in that PR
  And colocated chrome tests live under shared/
  And pages remain under pages/

Scenario: Module must not import leftover card-assignees
  Given card-assignees.ts is still under routes/ and kernel work-item-response imports it
  When a my-work or board module packet would need those helpers
  Then card-assignees already lives under server/src/lib/ from an earlier extract
  And the module imports kernel lib, not leftover routes/

Scenario: BoardContext is not dumped into shared
  Given BoardContext is board-owned
  When kernel extract PRs run
  Then BoardContext is not moved to shared/
  And it moves later in the board FEATURES packet to features/board/

Scenario: Auth screens become page orchestrators
  Given AuthPage.tsx lives under client/src/components/
  When the auth-pages packet runs
  Then AuthPage.tsx, EmailGatePage.tsx, and PickUsernamePage.tsx live under client/src/pages/
  And App.tsx imports the pages/ paths
  And they are not placed under features/auth/
```

### Story: Sequenced close of #131

> As a maintainer, I want #131 to stay open until every mapped FEATURES leftover is relocated (pages and thin stubs excepted as documented orchestrators) and shared chrome is in `shared/`, and only then close it from the last PR.

**Rule 12: Packet order**

1. Kernel/shared extracts that unblock one-way (chrome, then other cross-cutting files as needed; may be more than one PR, still not a FEATURES product name)
2. Auth screens `components/` → `pages/`
3. Tracker residual: **no stub deletion**; Cycle Map / issue comment records stubs as thin orchestrators
4. Remaining FEATURES, one name per PR (a name may take more than one PR when FM-RULE-4 requires a wave split), assumed order: `my-work`, `focus` wave-1, `chat` client, `agent` wave-1 (closed client slice; `agentStream*`/`agentBoardSync*` remain wave-2), `chat` server, separate agent helper hotfix (shared workspace-reset helper required before board relocation), `board` wave-1 (no ContextPanel), `focus` wave-2 (`FocusSessionContext` + `FocusEntryButton`), `board` wave-2 (`ContextPanel`), `agent` wave-2 (BoardContext consumers, `agentStream*`/`agentBoardSync*`, + `llm.ts`), `settings`, `workspaces`, `notifications`, `activity`, `auth`
5. Last successful packet uses `closes #131`; all earlier PRs use `refs #131` only

**Rule 13: Partial progress keeps #131 OPEN.** No replacement issue as a way to close early.

**Rule 14: Close bar**

- Every FEATURES name has `features/<name>/` and/or `modules/<name>/` with `index.ts` as applicable
- Leftover **product** files for those names are gone from `components/` (except documented thin stubs), `hooks/`, `context/`, `client/src/lib/`, `client/src/chat/`, `server/src/routes/` (except kernel tests that remain documented), `server/src/agent/`, `server/src/chat/`, `server/src/notifications/`
- Pages remain under `pages/` (including Dashboard and the three auth screens after their move)
- Chrome + agreed cross-cutting files live under `shared/` / `lib/`
- `npm run test` from repo root is green; test **file** count is not reduced
- `npm run check:feature-modules` and `make check` are green

**Rule 15: Later PRs rebase onto `origin/main`** so chrome/one-way prerequisites still hold. Merge-base is not used to sneak two FEATURES names into one diff.

**Rule 16: Verify with `npm run test` from repo root**, workspace-scoped single files when needed, never `npx vitest` from root, never `-t` / `describe.skip` to hide failures.

```gherkin
Scenario: Tracker stubs remain
  Given 25 thin re-export stubs under components/tracker/
  And Tracker pages live under pages/ with default imports of those stubs
  When the close program runs
  Then those stubs remain
  And Tracker pages are not git-mv'd
  And no default-to-named binding change is applied to oversized pages

Scenario: Early close forbidden
  Given agent leftovers still live under server/src/agent/
  When a board PR is merged
  Then the board PR uses refs #131, not closes/fixes #131

Scenario: Final close
  Given chrome and cross-cutting files are in kernel dirs
  And every FEATURES name has been relocated on main
  And pages and tracker stubs remain as documented orchestrators
  When the last remaining FEATURES packet is merged
  Then that PR may use closes #131
  And test file count is not reduced
  And DashboardPage.tsx still lives under client/src/pages/

Scenario: Guard fail reverts the packet
  Given a board packet and FM-RULE-4 one-way fails
  When path-only retarget cannot fix without moving a second FEATURES name
  Then the whole board packet is reverted or the missing kernel extract is done first
  And board is not merged half-moved
  And a second FEATURES name is not added to the same PR
```

---

## Acceptance Criteria

```
ACCEPTANCE CRITERIA — #131 folder relocation close
Date: 2026-09-19 | Scope confirmed: yes

Rule: One FEATURES name per PR; pages stay
  ✓ Given leftover my-work product files and MyWorkPage in pages/, When that packet git-mvs product files into features/my-work and modules/my-work, Then guards and full tests pass, test file count is not down, and MyWorkPage path is unchanged
  ✗ Given a branch that also moves chat product files, When reviewed, Then it is not merged as one packet

Rule: Path-only; no logic; fat files not split
  ✓ Given a relocate PR, When import/mock paths and Cycle Map locks update, Then production bodies and test assertions (except path locks) are unchanged
  ✓ Given biome reorders imports on a file >300 lines, When FM-RULE-3 fires, Then those hunks are reverted and the file is not split
  ✗ Given a failing test, When someone edits logic or matchers to go green, Then that change is rejected; revert the packet if path-only cannot fix

Rule: Public index and one-way wall
  ✓ Given BoardContext moves to features/board, When leftover pages/layout import it, Then they use the board index only and the mutation allowlist path updates
  ✗ Given a new module file would import leftover routes/ or components/ feature files, When check:feature-modules runs, Then FM-RULE-4 fails and the packet does not merge until a prior kernel extract or revert

Rule: Kernel/shared first for true cross-cutting
  ✓ Given PageHeader/Toast/Presence/chrome still in type-folders, When a later module would import them, Then chrome already lives under shared/ from an earlier PR
  ✓ Given card-assignees is used by kernel and more than one feature, When my-work/board modules land, Then it already lives under server/src/lib/
  ✗ Given a kernel extract PR, When BoardContext is moved to shared/, Then that is rejected (board product)

Rule: Auth screens and chat legacy tree
  ✓ Given AuthPage lives under components/, When the auth-pages packet runs, Then it lives under pages/ and stays there
  ✓ Given client/src/chat/ leftover runtime files, When the chat packet runs, Then they live under features/chat/ with index.ts and ChatPage stays in pages/

Rule: Stubs and 300 ceiling
  ✓ Given tracker thin stubs, When the close program finishes, Then stubs still exist and LINE_BUDGET_MAX is still 300
  ✗ Given a proposal to delete stubs by changing oversized pages to named index imports, When FM-RULE-3 would fire, Then that approach is out of scope

Rule: Close #131 only when complete
  ✓ Given agent leftovers still exist, When board merges, Then refs #131 only
  ✓ Given all FEATURES product leftovers relocated, chrome in shared/lib, pages+stubs documented, tests green, test file count not down, When the last packet merges, Then closes #131 is allowed
  ✗ Given only a subset of FEATURES relocated, When a PR uses closes #131, Then that is invalid
```

---

## Design Decision

**Chosen option:** Option A — Kernel-first ladder, then one FEATURES name per PR

**Summary:** Extract chrome and true cross-cutting files into kernel dirs first (one or more PRs), move the three auth screens into `pages/`, leave tracker stubs and all pages in place, then relocate each remaining FEATURES name (client+server) as its own PR. A name may take more than one PR when FM-RULE-4 requires a wave split (`focus`, `board`, `agent`). Last packet closes #131.

**Rejected options:**

- Option B (just-in-time kernel extract inside each feature PR): rejected because chrome is required before close anyway (Rule 9) and mixing kernel extract with a FEATURES packet hides one-way failures and bloats diffs; Scenario "Module must not import leftover card-assignees" is cheaper as an explicit prior PR.
- Option C (leave oversized product files in type-folders as grandfathers and only move small files): rejected because Scenario "Final close" and issue close rule 3 require mapped **product** leftovers relocated; `cards.ts` / `agent/service.ts` must land under `modules/` even if they stay oversized (#115/#121 remain split issues).

**Key tradeoffs accepted:**

- Thin tracker stubs remain until a later non-#131 page extract
- Fat files move as-is; next non-trivial body edit still owes 300-on-touch
- Cross-cutting workspace/ticket-intake/card-response files may land in kernel even though a FEATURES name also exists — only when layout/kernel/multiple features already import them; BoardContext does not get that treatment
- Many specifier PRs (shotgun path updates) instead of one dump

---

## Open Questions / Assumptions

| Question | Resolution | Risk if Wrong |
|----------|------------|---------------|
| FEATURES PR order after kernel + auth pages | assumed: my-work → focus-1 → client chat → repaired agent-1 closed slice → server chat → separate shared agent-helper hotfix → board-1 → focus-2 → board-2 → agent-2 (BoardContext consumers, stream/sync, + llm.ts) → settings → workspaces → notifications → activity → auth | T9 is blocked until the helper hotfix; if a later packet still hits one-way, insert a kernel extract or same-name wave split rather than combining FEATURES |
| `server/src/routes/presence.ts` | assumed: stay beside realtime kernel if it is only a facade | If it is product, move with workspaces in that packet |
| Work-item integration tests under `server/src/routes/` | assumed: remain documented kernel tests | Close comment must list them so they are not mistaken for board leftovers |
| `client/src/api.ts` / `client/src/api/myWork.ts` | hub `api.ts` stays; `api/myWork.ts` moves with my-work and the hub imports the feature index | If `api/myWork.ts` stays, my-work module may still be incomplete; planner should include it in the my-work packet |
| `lib/chatToolTrace.ts` | assumed: chat packet unless the chrome/ToolTrace PR needs it for one-way | Extra kernel file in shared/; harmless if conservative |
| Ticket-intake client files | assumed: kernel/shared extract before the board packet because BoardContext + layout import them | If treated as agent-only, board packet fails one-way; then extract first |
| `lib/agentQueue.ts` | assumed: kernel/shared extract in T1 because chat `useChatStream` and agent `useAgentChat` / `AgentChatPanel` both import it | If left as agent product, the chat packet fails FM-RULE-4; extract first, do not combine chat+agent names |

---

## Implementation Notes

- Copy `client/src/features/tracker/index.ts` and `server/src/modules/tracker/index.ts` as the public-API pattern (server re-exports with `.js`).
- Prefer identical-content `git mv` so Git reports R100. Failed rename detection on an oversized file looks like a new >300 file → revert and retry the move.
- Husky staged Biome: do not let `--write` reorder imports on files already >300 in a relocate PR.
- Cycle Map in `scripts/feature-modules/git-diff.test.mjs` must lock new homes and old-path absences in the same PR as each extract/relocate.
- `npm run test` from repo root; client singles via `npm run test --workspace=client -- <rel path>`.
- Every non-final PR: `refs #131`. Final PR: `closes #131` only after the close bar is met on that branch vs `main`.
- Do not `closes #115` or `closes #121` from relocate PRs.
- Pocket Enterprise: `branch_strategy: branch`, `create_pr: true`.

---

## Rollback Plan

- Each packet is an independent git revert of that PR (no schema/data migration).
- If a packet is half-applied locally: discard the branch; do not merge a tree that has both new `features/<name>/` files and leftover sources for the same bodies.
- `KERNEL_IN_WAITING` is never reopened to paper over one-way failures; extract or revert instead.
