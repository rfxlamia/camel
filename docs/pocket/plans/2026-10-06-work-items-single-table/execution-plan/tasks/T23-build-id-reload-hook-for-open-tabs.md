# Task T23 — Build-id reload hook for open tabs

**Phase:** 2
**Depends:** T2, T14
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 23: Build-id reload hook for open tabs [depends: T2, T14]

## OBJECTIVE
Make open browser tabs reload themselves after any new deployment, so a tab that predates the cutover cannot keep sending old tracker numeric ids (for example into focus sessions). **Ships with T24 (Phase A deploy), at least one day before T19; focus mode is ON in production, which is the stale-tab risk this removes.**

Steps:
1. Read-only first: find how the client builds its API base URL (`client/src/api.ts`), where the server health route is mounted (`server/src/index.ts:105`, and whether it is reachable as `/api/health` through nginx on `camel-ggf`), and where `App` mounts global listeners (`client/src/App.tsx`). Record the answers in the report.
2. Write failing test for: "Health reports a build id"
   Test file: `server/src/lib/health.test.ts`
   Level: unit
   Test intent: Given `BUILD_ID=abc123` in the environment / When `buildHealthPayload()` is called / Then it returns `{ ok: true, buildId: "abc123", workItemsListLatency: <snapshot> }`; and with `BUILD_ID` unset it returns a non-empty `buildId` that is stable across calls in one process
   Exercise through: exported `buildHealthPayload()` in `server/src/lib/health.ts`
   Test doubles: stub `getListLatencySnapshot` at the module boundary; do not mock the function under test
   Expected RED: `lib/health.ts` does not exist (`buildHealthPayload` is not exported)
3. Run test — verify FAIL: `npm run test --workspace=server -- src/lib/health.test.ts`
4. Create `server/src/lib/health.ts` and make `index.ts:105` return `buildHealthPayload()`. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "feat(server): expose build id on health"`.
5. Write failing test for: "Tab reloads when the build id changes"
   Test file: `client/src/shared/useBuildReload.test.tsx`
   Level: unit (React hook under jsdom)
   Test intent: Given the hook captured build id "a" at load / When the page becomes visible and the health fetch returns "b" / Then `window.location.reload` is called once; when it returns "a" it is not called; when the fetch fails or returns 503 (maintenance or restart) it is not called and no retry storm occurs (at most one check per visibility event and one per 5 minutes); and when the FIRST fetch at load fails (no captured id) and a later fetch succeeds, it captures that id and does NOT reload
   Exercise through: the exported `useBuildReload()` hook rendered in a test component with fake timers
   Test doubles: global `fetch` mocked, `window.location.reload` replaced with a spy; do not mock the hook
   Expected RED: `client/src/shared/useBuildReload.ts` does not exist
6. Run test — verify FAIL: `npm run test --workspace=client -- src/shared/useBuildReload.test.tsx`
7. Create `client/src/shared/useBuildReload.ts` and mount it once in `client/src/App.tsx`. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "feat(client): reload open tabs when the build changes"`.
7a. Write failing test for: "Health route and hook agree"
   Test file: `server/src/lib/health.test.ts` (separate `describe`)
   Level: integration (Express app) plus source contract
   Test intent: Given the server app / When `GET` is called on `HEALTH_PATH` (a constant exported from `lib/health.ts` and used to mount the route in `index.ts`) / Then it returns 200 JSON including `buildId`; and given the text of `client/src/shared/useBuildReload.ts` / Then it contains the same health path literal as the client really calls through the nginx `/api/` proxy (determined in step 1) and the field name `buildId`
   Exercise through: the app handler (the supertest-style helper used by `routes/*.integration.test.ts`) and `fs.readFileSync`
   Test doubles: none
   Expected RED: `HEALTH_PATH` is not exported and the route is mounted with a literal
7b. Run test — verify FAIL: `RUN_INTEGRATION=1 npm run test --workspace=server -- src/lib/health.test.ts`. Export `HEALTH_PATH`, mount the route through it, and make the hook use the same literal. Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "test(server): pin health route contract with the reload hook"`.
8. Write failing test for: "Images carry a build id"
   Test file: `server/src/lib/health.test.ts` (separate `describe`, source contract as used in `db/work-item-merge-expand.test.ts`)
   Level: unit (source contract)
   Test intent: Given the tracked `Dockerfile` / When read as text / Then it declares `ARG BUILD_ID` and sets `ENV BUILD_ID=$BUILD_ID` (the host-specific deploy script is local only, so it is not tested from the repo)
   Exercise through: `fs.readFileSync` on the Dockerfile
   Test doubles: none
   Expected RED: the Dockerfile does not mention `BUILD_ID`
9. Run test — verify FAIL (same command as step 3). Edit the Dockerfile (committed). Also edit the local-only `deploy/deploy-ggf.sh` so it passes `--build-arg BUILD_ID=<git short hash>-<timestamp>` (not committed, not tested from the repo). Verify PASS, refactor while green (re-run the same command), then commit: `git commit -m "chore(deploy): stamp images with a build id"`.
10. Run `npm run typecheck`, `npm run lint`, `npm run test --workspace=client -- src/shared/useBuildReload.test.tsx`; all green.

> Test **intent** only — never test source code. The implementer writes the test during the RED step, against the API that exists by then.

## REFERENCES LOADED
Spec — Story 3 scenario "Forced reload"; Appendix C (client files that compare numeric ids: `focusGuards.ts`, `FocusPage.tsx`, `TrackerDetailPage.tsx`, `TrackerPage.tsx`, `FocusSessionContext.tsx`, `FocusEntryButton.tsx`); Plan Overview note that no reload mechanism exists today
[CRITICAL: Without this section, packet is incomplete]

## WHY THIS APPROACH
Complexity: standard
Justification: the one place where the "client unchanged" constraint cannot hold; kept to a single hook plus a header-free health field, and it must be live in browsers before the cutover.

## SANDWICH CONTEXT
[CRITICAL: The hook must never reload during maintenance or while the server is unreachable (a 502/503 or failed fetch means do nothing), and must reload at most once per detected build change, otherwise it creates a reload loop for the whole team.]
You are implementing the reload hook for the work-items single-table merge cutover.
Spec: docs/pocket/spec/2026-10-06-work-items-single-table/single-table-merge.md
Design decision: Option B (cutover tooling)
Files in scope: server/src/lib/health.ts (new), server/src/lib/health.test.ts (new), server/src/index.ts, client/src/shared/useBuildReload.ts (new), client/src/shared/useBuildReload.test.tsx (new), client/src/App.tsx, Dockerfile, deploy/deploy-ggf.sh (local only, not committed)
Available after: T2, T14 (same files: Dockerfile, server/src/index.ts); deployed by T24, at least one day before T19
Architecture rule: client uses bundler resolution (no extensions); server uses `.js` extensions; no UI changes
[RESTATE: No reload on failure or maintenance; at most one reload per build change.]

## DELIVERABLE
Given build id "a" at load and "b" on the next visible check, When checked, Then the page reloads once
Given the same build id, or a failed or 503 health fetch, When checked, Then no reload
Given `BUILD_ID` set at image build, When `/health` is called, Then it reports that id
Given the Dockerfile, When read, Then it threads `BUILD_ID`; and as a manual check (not a test) the local-only deploy script passes `--build-arg BUILD_ID=...`

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Client test runs via the client workspace (`document` exists only there)
  - A comment-free hook under 80 lines; no new dependency
Must-not-have:
  - Any visible UI; polling faster than one check per visibility event plus one per 5 minutes; reload on non-2xx
Open question risks:
  - Whether `/health` is reachable through nginx on `camel-ggf` is unverified (the live vhost proxies `/api/` only) → NEEDS_CONTEXT; if only `/api/health` is proxied, use that path
Rollback note:
  - Revert the commits and redeploy; no data change.
Red flags:
  - A reload loop observed in tests → STOP

## STOP CONDITIONS
Done when: all four scenarios pass and typecheck/lint are green
Uncertain when: the API base cannot be derived the same way the rest of the client does
Escalate when: the hook would need a UI element
