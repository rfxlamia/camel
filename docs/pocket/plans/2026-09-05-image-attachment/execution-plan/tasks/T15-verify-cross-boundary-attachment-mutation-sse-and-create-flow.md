# Task T15 — Verify cross-boundary attachment mutation, SSE, and create flow

**Phase:** 3
**Depends:** T6, T8, T9, T10, T12, T13
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 15: Verify cross-boundary attachment mutation, SSE, and create flow [depends: T6, T8, T9, T10, T12, T13] [test-risk]

## OBJECTIVE

Add focused system-level integration coverage proving that a real attachment mutation persists, broadcasts to another viewer, refreshes the client gallery, and that staged client card creation uses the actual multipart endpoint/atomic result rather than only independently mocked seams.

Files:

- Create: `server/src/routes/attachments-system.integration.test.ts`
- Create: `client/src/attachments-system.integration.test.tsx`
- Modify: `client/src/api.ts` (only if the in-process public-boundary harness requires a narrow adapter seam)

Steps:

1. Write failing test for: a real existing-card mutation reaches a second viewer through the realtime delivery boundary with persisted response state.
   Test file: `server/src/routes/attachments-system.integration.test.ts`
   Level: integration

   Test intent:
   Given two authenticated viewers, a card with one attachment, and an in-process realtime/SSE subscriber, When viewer A uploads a valid image through the public route, Then the real DB/storage transaction commits, the response contains the new ordered attachment, and viewer B's SSE stream receives `attachment.added` with matching workspace/card metadata after commit.

   Exercise through:
   - public HTTP upload route, real database/storage fixture, real in-process realtime hub/SSE handler, and a second subscriber connection.

   Test doubles:
   - fake Redis transport and temporary filesystem only at external boundaries
   - do not mock the upload route, DB transaction, `publishEvent`, realtime hub, or SSE handler.

   Expected RED:
   - existing route and unit/route tests prove persistence and publisher calls separately, but no system test observes the same committed mutation on a real subscriber stream.

2. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/attachments-system.integration.test.ts`
   Expected failure: the system harness is absent and no end-to-end mutation-to-SSE assertion exists.

3. Implement minimal code to satisfy the test:
   File: `server/src/routes/attachments-system.integration.test.ts`
   Implement: an isolated authenticated fixture and in-process realtime subscriber harness that uses the production route/hub boundaries; keep Redis/filesystem as explicit external doubles only.

4. Run test — verify PASS:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/attachments-system.integration.test.ts`
   Expected: one committed mutation is observed as one matching SSE event and response state.

5. Refactor while green (bounded):
   - Keep the harness isolated and do not weaken route authorization or replace production event code with a spy.
   - Re-run the system test and server typecheck — both must stay PASS.

6. Commit:
   `git add server/src/routes/attachments-system.integration.test.ts`
   `git commit -m "test(attachments): verify mutation reaches SSE"`

7. Write failing test for: the actual client API/BoardProvider/CardAttachments boundary consumes the server-shaped response and event from the system contract.
   Test file: `client/src/attachments-system.integration.test.tsx`
   Level: integration

   Test intent:
   Given a mounted `BoardProvider` and `CardAttachments` consumer initialized from the server's serialized card response, When the exact `attachment.added` payload is delivered through the EventSource adapter and the refresh response contains the committed attachment, Then the other viewer's UI changes from `1/3` to `2/3` and renders the new thumbnail without directly invoking an upload callback.

   Exercise through:
   - public client API response shape, BoardProvider EventSource boundary, and rendered attachment UI.

   Test doubles:
   - in-process HTTP/EventSource adapter at the browser network boundary using the server-system fixture payloads
   - do not mock BoardProvider, CardAttachments, response hydration, or the event dispatch.

   Expected RED:
   - independently passing API/context/component tests do not yet prove the serialized event/response reaches the mounted viewer surface.

8. Run test — verify FAIL:
   `npm run test -- client/src/attachments-system.integration.test.tsx`
   Expected failure: the mounted consumer remains at its initial count or cannot consume the server-shaped attachment contract.

9. Implement minimal code to satisfy the test:
   File: `client/src/attachments-system.integration.test.tsx`
   Implement: the client-side in-process network/EventSource adapter and mounted provider/UI harness; use the public API/type contracts, not private state setters.

10. Run test — verify PASS:
    `npm run test -- client/src/attachments-system.integration.test.tsx`
    Expected: the serialized attachment event/response updates the viewer UI.

11. Refactor while green (bounded):
    - Re-run the client system test, CardAttachments integration test, and `npm run typecheck` — all must stay PASS.

12. Commit:
    `git add client/src/attachments-system.integration.test.tsx`
    `git commit -m "test(attachments): verify viewer refresh contract"`

13. Write failing test for: staged client submission uses the actual multipart card-create route and yields the atomic card-plus-attachment response.
    Test file: `server/src/routes/attachments-system.integration.test.ts`
    Level: integration

    Test intent:
    Given an AddCard-equivalent staged title and valid thumbnail/original pair, When the public client FormData serializer submits to the in-process real card-create route, Then the endpoint returns the created card with its attachment summary and the isolated database contains both rows with no partial create path.

    Exercise through:
    - public client API/FormData serializer over real HTTP to the production card-create route and real DB transaction; do not call `persistCreatedCard()` directly.

    Test doubles:
    - authenticated test session, temporary filesystem, and isolated database only
    - do not mock the client serializer, HTTP request, card-create route, transaction, or attachment insert.

    Expected RED:
    - server card-create integration and client API serialization currently pass independently, but no test sends the staged client multipart contract to the actual endpoint and inspects the atomic result.

14. Run test — verify FAIL:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/attachments-system.integration.test.ts`
    Expected failure: the system harness cannot yet bind the public client multipart request to the real card-create endpoint/result assertion.

15. Implement minimal code to satisfy the test:
    Files: `server/src/routes/attachments-system.integration.test.ts`, `client/src/api.ts`
    Implement: only the test harness/adapter needed to invoke the exported client create API against the in-process real server route; keep production serialization and server multipart fields unchanged except for a seam required to make the public boundary executable.

16. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/attachments-system.integration.test.ts`
    Expected: one staged client submission creates exactly one card and one attachment row and returns the hydrated summary.

17. Refactor while green (bounded):
    - Re-run the full system test, card-create integration test, client API tests, and both typechecks — all must stay PASS.
    - Do not add a browser/E2E dependency when the existing in-process boundaries can prove the contract.

18. Commit:
    `git add server/src/routes/attachments-system.integration.test.ts client/src/api.ts`
    `git commit -m "test(attachments): verify staged create contract"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — cross-unit upload/SSE/viewer/create scenarios and atomicity boundary.
- `server/src/routes/card-attachments.ts`, `server/src/routes/card-create.ts`, and `server/src/realtime.ts` — production server boundaries under test.
- `client/src/api.ts`, `client/src/context/BoardContext.tsx`, and `client/src/components/CardAttachments.tsx` — client network/state/UI boundaries.
- T6/T8/T9/T10/T12/T13 packets — direct dependencies whose seams are composed here.

## WHY THIS APPROACH

Complexity: deep
Justification: These scenarios are independently useful as system acceptance checks and cannot be proven by isolated route, API, context, or component tests. The task uses existing in-process test infrastructure and explicit external-boundary doubles instead of adding a new E2E dependency.

## SANDWICH CONTEXT

[CRITICAL: The system harness must exercise public route/API/EventSource boundaries and must not replace the mutation, realtime hub, BoardProvider, or attachment UI with mocks.]
You are verifying cross-boundary Image Attachment behavior for Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: authenticated local-disk routes, multipart card-create atomicity, and existing SSE refresh are composed without a new transport.
Files in scope: `server/src/routes/attachments-system.integration.test.ts`, `client/src/attachments-system.integration.test.tsx`, and only the narrow `client/src/api.ts` seam if required by the harness.
Available after: T6 existing upload/SSE, T8 multipart create, T9 client API/context, T10 gallery, T12 AddCard, T13 board cover.
Architecture rule: no production tracker/unified mutation path, public file path, or new E2E dependency.
[RESTATE: The system harness must exercise public route/API/EventSource boundaries and must not replace the mutation, realtime hub, BoardProvider, or attachment UI with mocks.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given viewer A uploads, When the real mutation commits, Then viewer B receives the attachment SSE event and can refresh to the committed response.
Given the committed response/event, When the real BoardProvider/CardAttachments surface consumes them, Then the counter/gallery updates without a direct callback invocation.
Given staged client data, When the public client API submits multipart card-create, Then the real endpoint creates exactly one card/attachment pair atomically and returns the hydrated summary.

All tests PASS. Commits exist with messages matching `test(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- At least one test observes mutation → real realtime/SSE delivery and one observes event/response → mounted client UI.
- Staged client FormData is sent to the actual card-create route and its DB result is inspected.
- External Redis/filesystem/network boundaries are the only doubles; core units remain real.

Must-not-have:

- A test that only spies on `publishEvent`, directly sets BoardProvider state, directly invokes the gallery callback, or bypasses the public card-create route.
- New Playwright/Cypress/E2E dependency or changes to tracker systems.

Open question risks:

- If the existing test harness cannot host the actual server route for a client API call without importing production boot side effects, report NEEDS_CONTEXT and identify the narrow app-factory seam required; do not replace the route with a mock.

Rollback note:

- These are verification-only files; revert them independently without changing runtime behavior.

## STOP CONDITIONS

Done when all three system cycles pass with full typechecks and commits.
Uncertain when a public boundary cannot be hosted without mocking a core unit; report NEEDS_CONTEXT rather than weakening the acceptance test.
Escalate when verification requires a new E2E dependency or out-of-scope runtime architecture.
