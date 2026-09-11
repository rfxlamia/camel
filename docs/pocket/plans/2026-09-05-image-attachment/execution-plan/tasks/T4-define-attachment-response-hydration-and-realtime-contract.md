# Task T4 — Define attachment response hydration and realtime contract

**Phase:** 1
**Depends:** T1
**Source plan:** ../../execution-plan.md

---

## Pocket Packet

### Task 4: Define attachment response hydration and realtime contract [depends: T1] [test-risk]

## OBJECTIVE

Expose safe attachment summaries on board/card responses in deterministic cover order and add explicit attachment realtime event types without exposing filesystem paths or changing tracker/work-item responses.

Files:

- Create: `server/src/routes/attachment-response.ts`
- Create: `server/src/routes/attachment-response.test.ts`
- Create: `server/src/routes/attachment-response.integration.test.ts`
- Modify: `server/src/routes/card-response.ts`
- Modify: `server/src/routes/board.ts`
- Modify: `server/src/routes/cards.ts`
- Modify: `server/src/realtime.ts`
- Modify: `client/src/types.ts`
- Modify: `client/src/types.test.ts`

Steps:

1. Write failing tests for: safe attachment mapping plus persisted board/card response hydration.
   Test files: `server/src/routes/attachment-response.test.ts`, `server/src/routes/attachment-response.integration.test.ts`
   Level: unit mapper + integration

   Test intent:
   Given attachment rows with different timestamps/tied timestamps and an isolated workspace/card with persisted rows, When the mapper and authorized board/card routes run, Then:
   - lower `created_at`, then lower `id`, determines order
   - summaries contain only id, safe thumbnail/original/download URLs, MIME, and created timestamp
   - board and card-detail responses include the same ordered list
   - no raw storage path appears

   Exercise through:
   - pure response mapper for URL/order assertions and real authenticated board/card HTTP routes for DB query/hydration.

   Test doubles:
   - plain mapper fixtures; isolated PostgreSQL and temporary provider files for route integration
   - do not mock response hydration, attachment selection, board/card routes, or URL construction.

   Expected RED:
   - no attachment response module/hydration field exists, so both pure and persisted-route assertions fail.

2. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/attachment-response.test.ts && RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test --workspace=server -- src/routes/attachment-response.integration.test.ts`
   Expected failure: mapper imports and board/card attachment response assertions fail.

3. Implement minimal code to satisfy the test:
   Files: `server/src/routes/attachment-response.ts`, `server/src/routes/card-response.ts`, `server/src/routes/board.ts`, `server/src/routes/cards.ts`
   Implement: typed attachment-row selection/hydration, deterministic ordering by `created_at,id`, safe URL construction using the locked workspace/card route shape, and board/detail/create-card hydration inputs. Update board and card queries without joining tracker tables.

4. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/attachment-response.test.ts && RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test --workspace=server -- src/routes/attachment-response.integration.test.ts`
   Expected: mapper, URL-safety, persisted board/card hydration, and empty-list assertions PASS.

5. Refactor while green (bounded):
   - Keep attachment query/serialization domain-scoped; do not duplicate URL construction.
   - Re-run both test commands and `npm run typecheck` — all must stay PASS.

6. Commit:
   `git add server/src/routes/attachment-response.ts server/src/routes/attachment-response.test.ts server/src/routes/attachment-response.integration.test.ts server/src/routes/card-response.ts server/src/routes/board.ts server/src/routes/cards.ts`
   `git commit -m "feat(attachments): hydrate safe card attachment summaries"`

7. Write failing test for: client card/activity fixtures accept the new attachment shape while the server realtime union accepts attachment mutation events.
   Test file: `client/src/types.test.ts`
   Level: unit (type/contract)

   Test intent:
   Given the client `Card`/`ActivityEvent` fixtures and server typecheck, When typed attachment-added/removed fixtures are compiled and exercised, Then card attachment URLs, metadata-only activity payload, and event names are accepted without widening tracker/work-item contracts.

   Exercise through:
   - executable typed fixtures in `client/src/types.test.ts` plus the server TypeScript compiler.

   Test doubles:
   - plain typed fixtures only
   - do not mock type declarations or contract modules.

   Expected RED:
   - `Card`/`ActivityEvent` lack attachment fields and `BoardEvent` lacks attachment event literals.

8. Run test — verify FAIL:
   `npm run test --workspace=client -- src/types.test.ts && npm run typecheck`
   Expected failure: client fixtures/typecheck fail because attachment card/activity/event types are missing.

9. Implement minimal code to satisfy the test:
   Files: `server/src/realtime.ts`, `client/src/types.ts`
   Implement: `attachment.added`/`attachment.removed` event literals and payload fields, `CardAttachment`/`Card.attachments`, and activity type literals for `attachment_added`/`attachment_removed`. Keep payloads metadata-only.

10. Run test — verify PASS:
    `npm run test --workspace=client -- src/types.test.ts && npm run typecheck`
    Expected: client contract test and server/client typechecks PASS.

11. Refactor while green (bounded):
    - Re-run both response tests, the client type test, the response integration test, and `npm run typecheck` — all must stay PASS.

12. Commit:
    `git add server/src/realtime.ts client/src/types.ts client/src/types.test.ts`
    `git commit -m "feat(attachments): define response and realtime contracts"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — safe delivery URLs, oldest-cover ordering, SSE event requirement, activity payload restriction.
- `server/src/routes/card-response.ts` — existing hydration/serialization boundary.
- `server/src/routes/board.ts` and `server/src/routes/cards.ts` — board/detail query paths that must include attachment summaries.
- `server/src/realtime.ts` — existing `BoardEvent` union and `publishEvent()` shape.
- `client/src/types.ts` — current `Card`, `ActivityEvent`, and `BoardEvent` contracts.

## WHY THIS APPROACH

Complexity: deep
Justification: This is the shared interface task for database rows, board/detail response hydration, client types, and event names. Defining it before route/UI work prevents server and client from inventing different URL or event shapes.

## SANDWICH CONTEXT

[CRITICAL: Response hydration may expose only safe authenticated route URLs; it must never expose `thumbnail_path`, `original_path`, private roots, or image bytes.]
You are implementing the shared response/realtime contract for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: one row maps to three authenticated URL paths: thumbnail, original inline, and original download.
Files in scope: `server/src/routes/attachment-response.ts`, `server/src/routes/attachment-response.test.ts`, `server/src/routes/attachment-response.integration.test.ts`, `server/src/routes/card-response.ts`, `server/src/routes/board.ts`, `server/src/routes/cards.ts`, `server/src/realtime.ts`, `client/src/types.ts`, `client/src/types.test.ts`.
Available after: T1 schema/types.
Architecture rule: card response hydration must not touch tracker/unified work-item response logic.
[RESTATE: Response hydration may expose only safe authenticated route URLs; it must never expose `thumbnail_path`, `original_path`, private roots, or image bytes.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given three attachments A/B/C uploaded in order, When board/detail hydration runs, Then the response lists A/B/C with A as cover and no private path leakage.
Given two rows with identical `created_at`, When response ordering runs, Then lower attachment id wins.
Given an attachment mutation, When the realtime contract is compiled, Then `attachment.added`/`attachment.removed` payloads are accepted and activity remains plain text/metadata-only.

All tests PASS. Commits exist with messages matching `feat(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Board and card detail responses hydrate the same ordered attachment summary shape.
- URL paths preserve workspace/card/attachment identity and separate inline/download routes.
- `Card` and event contracts are explicit and tracker contracts remain unchanged.
- Every behavioral cycle has its own test command.

Must-not-have:

- Raw storage path, disk root, inline thumbnail bytes, or public `/uploads` URL in JSON.
- Changes to `work-item-response.ts`, `tracker_items`, or `workItemMutations.ts`.

Open question risks:

- If empirical cookie testing shows `<img src>` cannot authenticate in dev/prod, report NEEDS_CONTEXT to switch the client gallery to credentialed blob fetches without changing route authorization.

Rollback note:

- Response fields/events are additive. Hide attachment UI/routes while existing card response fields remain backward-compatible.

## STOP CONDITIONS

Done when response/event cycles pass and server/client typechecks are green.
Uncertain when a response consumer requires raw filesystem paths; stop and report an architecture violation.
Escalate when implementing hydration requires modifying tracker/unified work-item serialization.
