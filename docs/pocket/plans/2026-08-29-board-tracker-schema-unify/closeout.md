# Closeout — 2026-08-29-board-tracker-schema-unify

- **Plan:** docs/pocket/plans/2026-08-29-board-tracker-schema-unify
- **Type:** phased
- **Started:** 2026-08-30  ·  **Closed:** 2026-08-31
- **Baseline SHA:** fcb9a368c9a5d5c7ec482d142bc22e5dbedf6f20  ·  **Final SHA:** 87dfbfb8d9003b2fcac89ebf7ed282e725157b72
- **Result:** CLOSED — all phases DONE, all reviewable tasks REVIEW_PASS

## Phases

### Phase 1 — execution-plan/phase-1.md  (DONE)

| Task | Name | done_sha | Verdict |
|------|------|----------|---------|
| T0 | Test-command preflight | 3ef4310aeac2a8b47d6ef417d7f9b69a15aa2ff2 | REVIEW_PASS |
| T1 | Column-to-slot mapping helper | a040714cb5c33ef595173ca43ef67d4316bf6b21 | REVIEW_PASS |
| T2 | Schema, slot seed, indexes, and idempotent backfill | 845ca56937580ce44386cccc0764782742eba9fb | REVIEW_PASS |

_SHA range: fcb9a368c9a5d5c7ec482d142bc22e5dbedf6f20..845ca56937580ce44386cccc0764782742eba9fb_

### Phase 2 — execution-plan/phase-2.md  (DONE)

| Task | Name | done_sha | Verdict |
|------|------|----------|---------|
| T3 | Shared vocabulary/card response and batched hydration | d4d7f6c23c25c10937274d391619af0ff2264a2c | REVIEW_PASS |
| T4 | Key/status allocation and final status NOT NULL | 5d140f787a352a88ade38ba2665b5e9ac6483a07 | REVIEW_PASS |
| T6 | Column overlay and transactional is_done remap | 7ad6253d51dd880fdea44856b611bfb2d1d9edc9 | REVIEW_PASS |
| T7 | Show formatted key on card face and list view | 96bea8f26d2d8ac44be06ae9a62a40ca4cd107d1 | REVIEW_PASS |

_Correction for T4: 383e64362caccc812fa45474cfd065e3fd51cb42_

_SHA range: 845ca56937580ce44386cccc0764782742eba9fb..96bea8f26d2d8ac44be06ae9a62a40ca4cd107d1_

### Phase 3 — execution-plan/phase-3.md  (DONE)

| Task | Name | done_sha | Verdict |
|------|------|----------|---------|
| T5 | Card move updates status_id | d7a89107827e197a70b3726e68f8e2beb58ed1fc | REVIEW_PASS |
| T8 | PATCH card priority, labels, project, and phase | d1bef41ed7767fb9669b55deb709908a15ad6f3c | REVIEW_PASS |
| T9 | Board panel pickers and dirty-state protection | f8515de850edee7b83235af280cb7ab00bd33d79 | REVIEW_PASS |
| T10 | Canonical migration smoke, fixture sweep, and final regression gate | 87dfbfb8d9003b2fcac89ebf7ed282e725157b72 | REVIEW_PASS |

_SHA range: 96bea8f26d2d8ac44be06ae9a62a40ca4cd107d1..87dfbfb8d9003b2fcac89ebf7ed282e725157b72_

## Carried Forward

Non-blocking observations from review — accepted at close, recorded for follow-up.

- **T4** (Minor): inconsistent indentation/formatting in columns-is-done-remap.failure.test.ts — server/src/routes/columns-is-done-remap.failure.test.ts:98-133
- **T7** (Minor): same formatting note in columns-is-done-remap.failure.test.ts — server/src/routes/columns-is-done-remap.failure.test.ts:98-133
- **T5** (Minor): no integration assertion that same-column reorder leaves status_id unchanged — server/src/routes/cards-identity.integration.test.ts
- **T5** (Minor): destination status resolution mirrors allocateCardIdentity inline (2 instances, below refactor threshold) — server/src/routes/cards.ts:776-806
- **T8** (Minor): HTTP integration does not cover every cross-workspace/wrong-kind label/phase case explicitly — server/src/routes/cards-taxonomy.integration.test.ts
- **T8** (Minor): diffIds behavior duplicated in cards.assignees.test.ts — server/src/routes/cards.assignees.test.ts:4-48
- **T8** (Minor): tracker-item-parsers.ts crosses ~300-line heuristic after spec-mandated growth — server/src/routes/tracker-item-parsers.ts
- **T8** (Minor): cards.assignees.test.ts and tracker-assignees.ts outside task file list (import-only) — server/src/routes/tracker-assignees.ts:2
- **T9** (Minor): projectName/phaseName not wired from ContextPanel — client/src/components/ContextPanel.tsx:341-356
- **T9** (Minor): BoardCardTaxonomyFields.tsx slightly above ~300-line heuristic — client/src/components/BoardCardTaxonomyFields.tsx
- **T9** (Minor): BoardContext.tsx extension outside declared file list (typecheck parity) — client/src/context/BoardContext.tsx:102-110
- **T10** (Minor): fresh-path migration test does not assert intermediate schema staging — server/src/db/full-migration.integration.test.ts:321-337, 413-420
- **T10** (Minor): tracker-vocabularies.test.ts seed-order fix outside declared T10 file list — server/src/routes/tracker-vocabularies.test.ts:97-101

## Skipped Tasks

_None_
