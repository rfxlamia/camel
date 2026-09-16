# Task T6 — ADR and agent convention docs

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 6: ADR and agent convention docs [depends: T1] [parallel: T2]

## OBJECTIVE
Document the locked convention in an ADR plus AGENTS.md and CLAUDE.md: feature map, public API, 300-on-touch, one-way imports, shrinking kernel allowlist, hotfix sequence, and pointer to the guard script as source of truth for lists.

Files:
- Create: `docs/pocket/adr/2026-09-16-feature-module-convention.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

Steps:
1. Create the ADR covering context (#129, type-folders, god files, PR #128), decision (feature modules + kernel + Option A guard), map tables, 300 rules, public API, shrinking allowlist, hotfix order (kernel extract → tracker git-mv → later splits land in modules/features), and consequences (deletable work-items adapter; BoardContext not split in this PR). Record: unmapped-feature checks use the working-tree map (same PR may add a feature); missing `origin/main` merge-base is fail-loud; generated files for the 300 rule are `*.generated.ts(x)` and paths containing `/generated/`; CI must fetch full history so merge-base exists.
2. Verify: `test -f docs/pocket/adr/2026-09-16-feature-module-convention.md` and that AGENTS.md + CLAUDE.md contain a Feature-module convention section that links the ADR and `scripts/check-feature-modules.mjs` / `scripts/feature-modules/map.mjs`. Do not duplicate the full allowlist in prose if the map file is cited as canonical; do state the behavioral rules (300, index.ts, one-way, new files in agent/ fail).
3. Commit: `git add docs/pocket/adr/2026-09-16-feature-module-convention.md AGENTS.md CLAUDE.md`
   `git commit -m "docs(architecture): record feature-module convention and CI guard"`

## REFERENCES LOADED
docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md — Implementation Notes, feature map, out-of-scope
docs/pocket/adr/2026-09-board-tracker-dual-table.md — ADR tone; dual-table shim stays; work-items adapter remains kernel
AGENTS.md / CLAUDE.md — existing dual-table bullet pattern to mirror, not replace

## WHY THIS APPROACH
Justification: Docs are independently useful once the map file exists; they must not wait for CI wiring.
Complexity: lightweight

## SANDWICH CONTEXT
[CRITICAL: Do not describe work-items as a product feature; it remains a deletable kernel adapter per ADR #103.]
You are writing convention docs for Feature-module directory convention.
Spec: docs/pocket/spec/2026-09-16-feature-module-convention/feature-module-convention.md
Design decision: Option A — document the guard, do not introduce ESLint/Nx.
Files in scope: docs/pocket/adr/2026-09-16-feature-module-convention.md, AGENTS.md, CLAUDE.md — no other files
Test framework: n/a (structural)
Available after: T1 (map path exists to cite)
Architecture rule: Keep dual-table mutation-routing bullet intact; add a new bullet, do not rewrite #103 away.
[RESTATE: Do not describe work-items as a product feature; it remains a deletable kernel adapter per ADR #103.]

## DELIVERABLE
Verification — task is DONE when all pass:

[derived] Given the convention PR, When merged, Then AGENTS.md/CLAUDE.md + ADR describe the map, public API, 300 rules, hotfix sequence
[must-not] Given the ADR, When read, Then it must NOT instruct a big-bang git-mv in the convention PR
[must-not] Given AGENTS.md, When read, Then it must NOT drop the dual-table workItemMutations routing rules

QUALITY BAR: `[no-tdd — structural task]`

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Hotfix order: kernel extract, then tracker move, then later splits into modules/features
  - Pointer to map.mjs as canonical lists
  - `[no-tdd — structural task]`
  - Commit message follows conventional commits format

Must-not-have:
  - Claiming BoardContext must be split in this PR
  - Nest/Nx migration language as a required implementation
  - Modifications to files outside the listed scope

Open question risks:
  - none

Rollback note:
  - Revert this commit; guard code remains

## STOP CONDITIONS
Done when: ADR exists, AGENTS.md and CLAUDE.md updated, commit created
Uncertain when: docs and map.mjs drift — cite the map file rather than copying tables
Escalate when: docs instruct changing workItemMutations behavior
