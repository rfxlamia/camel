# Task T5 — Add shared ownership guard and authenticated cached delivery

**Phase:** 2
**Depends:** T2, T4
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 5: Add shared ownership guard and authenticated cached delivery [depends: T2, T4] [test-risk]

## OBJECTIVE

Implement the one shared ownership-chain guard and the three authenticated GET delivery paths with private caching, ETags, inline content disposition, and forced download behavior.

Files:

- Create: `server/src/routes/card-attachments.ts`
- Modify: `server/src/routes.ts`
- Test: `server/src/routes/card-attachments.integration.test.ts`

Steps:

1. Write failing test for: a workspace member can fetch an attachment only when workspace, card, and attachment ids form one ownership chain.
   Test file: `server/src/routes/card-attachments.integration.test.ts`
   Level: integration

   Test intent:
   Given a member of workspace W and an attachment owned by card C in W, When the member requests the thumbnail/original route, Then the server returns the correct bytes; given a non-member or an attachment/card from another workspace, Then it returns 403/404 and never reads or sends bytes.

   Exercise through:
   - Supertest HTTP routes mounted through the real `api` router and the shared guard.

   Test doubles:
   - temporary private storage files and existing isolated database fixtures
   - mock only realtime if the harness starts Redis; do not mock membership/card/attachment queries or the guard under test.

   Expected RED:
   - no card attachment routes or ownership-chain lookup exists, so the requested route is 404 or authorization is incomplete.

2. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
   Expected failure: delivery route is not registered and ownership-chain cases cannot pass.

3. Implement minimal code to satisfy the test:
   Files: `server/src/routes/card-attachments.ts`, `server/src/routes.ts`
   Implement: one reusable middleware/factory that checks workspace membership, active card workspace ownership, and attachment-to-card ownership; register the router under `/workspaces/:workspaceId`; add thumbnail/original inline GET handlers that read only provider paths after the guard.

4. Run test — verify PASS:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
   Expected: authorized ownership-chain requests return bytes and cross-workspace/non-member requests are denied.

5. Refactor while green (bounded):
   - Keep the guard in one domain module and reuse it for every later POST/GET/DELETE route.
   - Re-run the integration command and `npm run typecheck` — both must stay PASS.

6. Commit:
   `git add server/src/routes/card-attachments.ts server/src/routes.ts server/src/routes/card-attachments.integration.test.ts`
   `git commit -m "feat(attachments): add ownership-guarded delivery routes"`

7. Write failing test for: cached thumbnail/original requests return private cache headers and a matching ETag produces 304.
   Test file: `server/src/routes/card-attachments.integration.test.ts`
   Level: integration

   Test intent:
   Given an authorized attachment delivery request, When the client sends no conditional header, Then the response includes `Cache-Control: private, max-age=300` and a stable ETag; when it sends `If-None-Match` with that ETag, Then the server returns 304 without a body.

   Exercise through:
   - real GET HTTP routes and response headers, not a cache helper.

   Test doubles:
   - temporary file stat/read boundary and deterministic file metadata
   - do not mock Express response caching behavior or the route under test.

   Expected RED:
   - the first delivery cycle adds authorized byte routes but deliberately omits ETag/private-cache behavior, so cache-header and conditional-request assertions fail.

8. Run test — verify FAIL:
   `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
   Expected failure: the existing delivery handlers return bytes without the required private cache header/stable ETag and do not produce the required 304 response.

9. Implement minimal code to satisfy the test:
   File: `server/src/routes/card-attachments.ts`
   Implement: ETag generation from file metadata, `Cache-Control: private, max-age=300`, conditional 304 handling, and separate `/thumbnail` and `/original` paths. Keep the ETag stable for unchanged bytes.

10. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected: private cache and 304 assertions PASS.

11. Refactor while green (bounded):
    - Do not add public proxy caching or merge inline/download paths.
    - Re-run the integration command — must stay PASS.

12. Commit:
    `git add server/src/routes/card-attachments.ts server/src/routes/card-attachments.integration.test.ts`
    `git commit -m "feat(attachments): add private attachment caching"`

13. Write failing test for: explicit download uses the distinct path and forced attachment disposition while inline original remains inline.
    Test file: `server/src/routes/card-attachments.integration.test.ts`
    Level: integration

    Test intent:
    Given an authorized member viewing an original, When they request `/original`, Then `Content-Disposition` is inline; when they request `/original/download`, Then it is attachment with a safe generated filename and the inline path remains independently cacheable.

    Exercise through:
    - both public delivery endpoints over HTTP.

    Test doubles:
    - temporary provider files
    - do not mock content-disposition behavior or route selection.

    Expected RED:
    - the distinct forced-download route and disposition are not present.

14. Run test — verify FAIL:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected failure: download route/disposition assertions fail.

15. Implement minimal code to satisfy the test:
    File: `server/src/routes/card-attachments.ts`
    Implement: `/original/download` with `Content-Disposition: attachment`, sanitized provider filename, and `/original` with `inline`; apply the same ownership/cache guard to both.

16. Run test — verify PASS:
    `RUN_INTEGRATION=1 RUN_LLM_IT=1 npm run test -- server/src/routes/card-attachments.integration.test.ts`
    Expected: inline/download and cache tests PASS.

17. Refactor while green (bounded):
    - Re-run the complete integration file and server typecheck; both must stay PASS.

18. Commit:
    `git add server/src/routes/card-attachments.ts server/src/routes/card-attachments.integration.test.ts`
    `git commit -m "feat(attachments): separate inline and download delivery"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md` — locked five route surfaces, ownership chain, private cache headers, ETag, and inline/download distinction.
- `server/src/middleware/workspace.ts` — existing membership middleware behavior.
- `server/src/routes.ts` — authenticated workspace router registration.
- `server/src/index.ts` — public static uploads boundary that this route must not reuse.
- `server/src/routes/attachment-response.ts` — URL/path contract from T4.
- Multer/Express documentation — route middleware/error boundary conventions.

## WHY THIS APPROACH

Complexity: deep
Justification: Authorization, filesystem reads, HTTP caching, and content disposition cross several boundaries and are security-sensitive. Integration tests through the real router are required; unit-testing a guard in isolation would not prove route registration or ID-substitution resistance.

## SANDWICH CONTEXT

[CRITICAL: Every delivery response must pass the full workspace-member → card-in-workspace → attachment-on-card chain before reading bytes.]
You are implementing authenticated attachment delivery for Image Attachment on Board Cards.
Spec: `docs/pocket/spec/2026-09-05-image-attachment/image-attachment-spec.md`
Design decision: authenticated delivery routes, not capability URLs or public static files.
Files in scope: `server/src/routes/card-attachments.ts`, `server/src/routes.ts`, `server/src/routes/card-attachments.integration.test.ts`.
Available after: T2 storage and T4 response/event contract.
Architecture rule: reuse one guard for POST, all GET paths, and DELETE; private files are not served by `express.static`.
[RESTATE: Every delivery response must pass the full workspace-member → card-in-workspace → attachment-on-card chain before reading bytes.]

## DELIVERABLE

Verification — task is DONE when all pass:

Given a member requests an attachment in their workspace, When the authorized thumbnail/original route runs, Then correct bytes and private cache headers are returned.
Given a non-member or cross-workspace/card/attachment id substitution, When the route runs, Then it returns 403/404 without bytes.
Given a matching ETag, When the same authorized URL is requested with `If-None-Match`, Then it returns 304.
Given the explicit download button path, When `/original/download` is requested, Then `Content-Disposition: attachment` is returned while `/original` remains inline.

All tests PASS. Commits exist with messages matching `feat(attachments): ...`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:

- Shared guard is called by every attachment route.
- Private cache header, ETag, 304, and distinct inline/download paths are tested over HTTP.
- Provider paths are resolved only after authorization and are never user-controlled.

Must-not-have:

- Public static serving, signed/capability-only URLs, cross-workspace lookup, or tracker lookup.
- Authorization checks duplicated separately in each handler.

Open question risks:

- Cross-origin `<img src>` cookie behavior must be verified by T10; if it fails, change client transport only, not this guard.

Rollback note:

- Hide/remove the new route registration and UI; retain additive table/provider files.

## STOP CONDITIONS

Done when all delivery integration cycles pass and typecheck is green.
Uncertain when a route can read bytes before the ownership query completes; stop immediately.
Escalate when a proposed fix bypasses per-request membership or exposes a public URL.
