# Task T21 — Contract: remove shim code, checks and docs

**Phase:** 6
**Depends:** T20
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 21: Contract: remove shim code, checks and docs [depends: T20]

## OBJECTIVE
Delete the merge/dedup shim, detection tooling, source-branching and update docs; supersede the ADR.

Steps:
1. Write failing test for: "No shim remains"
   Test file: `server/src/lib/work-item-shim-removed.test.ts`
   Level: unit (source contract)
   Test intent: Given the repo sources / When read as text / Then `listMergedWorkItems` dedup, `core/work-item-debt.ts`, `src/scripts/check-key-collisions.ts`, `recordTrackerActivity`, and the tracker-wins comment no longer exist, and `package.json` has no `check:key-collisions` scripts
   Exercise through: `fs`/glob reads
   Test doubles: none
   Expected RED: they exist
2. Run test — verify FAIL: `npm run test --workspace=server -- src/lib/work-item-shim-removed.test.ts`
3. Remove: dedup and dual helpers in `lib/work-item-response.ts`; `core/work-item-debt.ts` and its test; `check-key-collisions` script and `package.json` entries; `lib/tracker-activity.ts` and its allowlist entry in `scripts/check-event-write-routing.mjs`; the nightly smoke step (`tracker-contracts.smoke.ts` if that is the CI smoke) and `.github/workflows` references; `deploy/DEBT-CHECKS.md` and `deploy/debt-check.cron.example` (and the host cron: document its removal in the checklist; do not touch the host without approval); the latency warn-log tied to the ADR gate; `check:mutation-routing` script and `source` branching in `client/src/shared/workItemMutations.ts` only if it can be removed without UI change (otherwise leave the client file and record it). Verify PASS; run `npm run test`, typecheck, lint, `make check`. Commit: `git commit -m "refactor(server): remove board-tracker shim"`.
3b. `bmad`/`camel.web.id` is confirmed decommissioned: delete `deploy/deploy.sh`, `deploy/docker-compose.prod.yml` and `deploy/nginx/camel.conf` (the web.id config) and fix every reference to them. Also remove the detection-gate artifacts listed in the old ADR: the scheduled ADR-revisit workflow (2027-09-01) under `.github/workflows/`, and the CODEOWNERS entries, PR template section and `AGENTS.md` lines that point at the dual-table ADR. Commit: `git commit -m "chore(deploy): remove legacy bmad deploy files and ADR gate artifacts"`.
4. Write ADR `docs/pocket/adr/2026-10-work-items-single-table.md` superseding `2026-09-board-tracker-dual-table.md` (mark the old one `superseded`); update the paragraph in `CLAUDE.md` about the dual table, and the `camel-server` skill's stale host and debt-check sections. Commit: `git commit -m "docs: supersede dual-table ADR with single-table decision"`.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Scope "Contract PR"; Appendix C (tracker-only infrastructure counts and files)
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: broad but mechanical removal; test is a guardrail so nothing is left behind.

## SANDWICH CONTEXT
[CRITICAL: The Contract is done only when every item in the removal list is gone; leaving one detection script or doc behind is the exact debt this change exists to remove.]
You are implementing the Contract cleanup for the work-items single-table merge.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (Contract stage)
Files in scope: the removal list above (including `deploy/deploy.sh`, `deploy/docker-compose.prod.yml`, `deploy/nginx/camel.conf`, the ADR-revisit workflow, CODEOWNERS, PR template, AGENTS.md), ADR, CLAUDE.md, skill file
Available after: T20
Architecture rule: public repo hygiene; no host changes without approval
[RESTATE: Everything on the list is removed.]

## DELIVERABLE
Given the repo, When scanned, Then no shim, detection script, tracker-activity writer or dedup remains and the ADR is superseded

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `make check` green after removal
Must-not-have:
  - Client UI changes; host changes
Open question risks:
  - Client `workItemMutations.ts` source-branching removal might alter UI → record, do not force
Rollback note:
  - Revert PR (no data change).
Red flags:
  - `closes #103` before every item is removed → STOP

## STOP CONDITIONS
Done when: scenario passes, full checks green, ADR written
Uncertain when: the CI smoke step identity is unclear
Escalate when: client change is unavoidable

## Carried from Phase 4 T9/T10 audits (2026-10-07)
- Remove the temporary shims if still present: `server/src/lib/legacy-tracker-item-response.ts`, `server/src/core/legacy-tracker-item-status-change.ts` (+ test).
- `server/src/lib/tracker-item-activity.ts` casts `tracker_item_*` event types into `recordActivity` because the union in `lib/helpers.ts` (623 lines, 300-on-touch) was not widened. When `helpers.ts` is split, widen the union and drop the cast.
- From T12 audit: `lib/legacy-tracker-item-response.ts` is dead code; `lib/tracker-assignees.ts` `loadTrackerAssigneesForItems` is only used by it and test mocks; `mergeMyWorkRows` (tracker-wins dedupe, `my-work-service-list.ts`) is dead logic since keys are unique; My Work tracker sort key `coalesce(c.updated_at, c.created_at)` should match the serializer fallback (`coalesce(c.updated_at, c.done_at, c.started_at, c.created_at)`).
