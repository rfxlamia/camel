# Task T3 — `FOCUS_MODE_ENABLED` flag + client visibility

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 3: `FOCUS_MODE_ENABLED` flag + client visibility [prereq]

## OBJECTIVE

Add the server feature flag that the Rollback Plan depends on, expose it to the client through a config endpoint, and surface it on `BoardContext` as `focusModeEnabled` — so later tasks can hide entry points when the feature is off.

This mirrors the existing ticket-intake flag end to end: `GET /api/ticket-intake/config → { enabled }` → `api.ticketIntake.getConfig()` → `ticketIntakeEnabled` on `BoardContext`. Read that path before writing anything; it is the precedent, and there is no `import.meta.env` pattern in this codebase.

Files:
- Modify: `server/src/config.ts`
- Create: `server/src/routes/focus-config.ts`
- Modify: `server/src/routes.ts`
- Modify: `client/src/api.ts`
- Modify: `client/src/context/BoardContext.tsx`
- Modify: `client/src/context/BoardContext.viewMode.test.tsx`
- Modify: `client/src/hooks/useTicketIntakeChat.integration.test.tsx`
- Test: `server/src/routes/focus-config.test.ts`
- Test: `client/src/context/BoardContext.focusFlag.test.tsx`

The two existing test files are in scope because this task adds a mount-time `api` call to `BoardProvider`. Both mock `../api` with a partial object literal, so `api.focus` is `undefined` and `api.focus.getConfig()` throws a synchronous `TypeError` inside the effect — *before* `.catch()` is ever attached, so the degrade-to-false guard does not save them. See step 9c.

The config endpoint lives in its own router file, separate from the lifecycle router T4 creates, so the two tasks never edit the same file.

**Test commands are workspace-scoped and workspace-relative.** `npm run test -- <path>` from the repo root does NOT work: the root script is `npm run test --workspace=server && npm run test --workspace=client`, and npm appends `--` arguments to the end of that whole string, so the path lands on the *client* command only — the server suite runs unfiltered and the client run exits 1 with "No test files found". Use `npm run test --workspace=server -- src/...` and `npm run test --workspace=client -- src/...`. Bare `npm run test` (whole suite) is unaffected.

**Do not use `-t` to filter by test name.** npm drops the quotes, so `-t "enabled true"` reaches vitest as `-t enabled` plus a stray positional filter, and can report `Tests 5 skipped (5)` at exit 0 — a green gate that ran nothing. Each cycle below runs the whole test file instead; the newly added case is the only one expected to be RED.

Steps:

1. Write the first independent failing test for: config endpoint reports enabled=true
   Test file: `server/src/routes/focus-config.test.ts`
   Level: unit

   Test intent:
   Independent RED case A: Given `FOCUS_MODE_ENABLED=true`, When an authenticated user requests `GET /focus/config`, Then the response is `200 { enabled: true }`. Flag-off and unauthenticated cases are separate cycles below.

   Exercise through:
   - HTTP, via `supertest` against a bare `express()` app with the router mounted — the same harness as `server/src/routes/work-items.test.ts`

   Test doubles:
   - mock `../config.js` with a **mutable** object so `FOCUS_MODE_ENABLED` can be flipped per test. `vi.mock` factories are hoisted, so a plain `let` cannot be closed over — use `vi.hoisted`:
     ```ts
     const mockConfig = vi.hoisted(() => ({ FOCUS_MODE_ENABLED: "false" }));
     vi.mock("../config.js", () => ({ config: mockConfig }));
     // in each test: mockConfig.FOCUS_MODE_ENABLED = "true";
     ```
     The handler must read `config.FOCUS_MODE_ENABLED` at request time, not at module load, or the flip will not take effect.
   - mock `../auth.js` `requireAuth` to a pass-through. Exact precedent: `server/src/routes/workspaces.patch.test.ts:35-37`. (`work-items.test.ts` is the supertest-app harness precedent, but it mocks `../middleware/workspace.js`, not auth.)
   - do NOT mock: the router itself

   Expected RED:
   - `server/src/routes/focus-config.ts` does not exist — import fails to resolve

2. Run test — verify FAIL: `npm run test --workspace=server -- src/routes/focus-config.test.ts`
   Expected failure: `Failed to resolve import "./focus-config.js"`

3. Implement the enabled-true path: add `FOCUS_MODE_ENABLED: z.enum(["true", "false"]).default("false")` to `envSchema` in `server/src/config.ts` beside `EMAIL_GATE_ENABLED`; create `server/src/routes/focus-config.ts` exporting `focusConfigRouter` with `GET /focus/config` returning `{ enabled: config.FOCUS_MODE_ENABLED === "true" }`, guarded by `requireAuth`. Model it on `ticketIntakeRouter.get("/ticket-intake/config", ...)` in `server/src/routes/ticket-intake.ts`.

4. Run test — verify PASS: `npm run test --workspace=server -- src/routes/focus-config.test.ts`

4a. Write/run a separate RED→implementation→PASS cycle for enabled=false: Given `FOCUS_MODE_ENABLED=false`, When the same authenticated request is made, Then the response is `200 { enabled: false }`.
    Test file: `server/src/routes/focus-config.test.ts`
    Level: unit
    Exercise through: `supertest` against the same mounted router
    Test doubles: flag-off `../config.js` mock, pass-through `requireAuth`
    Expected RED: the handler always returns `{ enabled: true }` or omits the false branch.
    Run FAIL then PASS: `npm run test --workspace=server -- src/routes/focus-config.test.ts`

4b. Write/run a separate RED→implementation→PASS cycle for unauthenticated access: Given an unauthenticated request, When `GET /focus/config` is made, Then auth rejects it while workspace membership is not required.
    Test file: `server/src/routes/focus-config.test.ts`
    Level: unit
    Exercise through: `supertest` against the same router with `requireAuth` stubbed to 401
    Test doubles: 401 `requireAuth` stub; do not mount `requireWorkspaceMember`
    Expected RED: the route is unguarded and returns 200, or it incorrectly requires workspace membership.
    Run FAIL then PASS: `npm run test --workspace=server -- src/routes/focus-config.test.ts`
    Do not combine the flag-value assertions with the auth assertion.

5. Register the router: in `server/src/routes.ts`, import `focusConfigRouter` from `./routes/focus-config.js` and add `api.use(focusConfigRouter);` immediately after the `requireEmailVerified` block (routes.ts:43-45) and before the `/workspaces/...` mounts. Verify nothing regressed: `npm run test`.

    Note the divergence from ticket-intake, and take it deliberately: `ticketIntakeRouter` is NOT mounted in `routes.ts` — it is mounted in `server/src/index.ts:122` as `app.use("/api", ticketIntakeRouter)`, outside the `api` router. There are no other top-level non-workspace-scoped routers in `routes.ts`; every mount there is `/workspaces/*`. Mounting on `api` (which `index.ts:119` mounts at `/api`) still yields `/api/focus/config`, but it additionally inherits `api.use(requireAuth)` (routes.ts:41) and the `requireEmailVerified` gate — which ticket-intake bypasses. That is the intended behavior here: an unverified-email user should not see focus surfaces. If the email gate turns out to be unwanted on this endpoint, mount in `index.ts` beside `ticketIntakeRouter` instead and say so in the commit body.

6. Write the first independent failing test for: client exposes `focusModeEnabled` default false while pending
   Test file: `client/src/context/BoardContext.focusFlag.test.tsx`
   Level: unit (component/hook, jsdom)

   Test intent:
   Independent RED case A: Given the config request is pending, When the provider mounts, Then `focusModeEnabled` is `false`. Enabled-true settle and rejection degrade are separate cycles below.

   Exercise through:
   - a probe component calling `useBoard()`, rendered inside `BoardProvider` via `@testing-library/react`

   Test doubles:
   - mock `../api` with `vi.hoisted` (the pattern in `client/src/pages/TrackerDetailPage.test.tsx`), stubbing every `api` method `BoardProvider` calls on mount
   - stub `EventSource` with a `MockEventSource` class, as `client/src/context/BoardContext.viewMode.test.tsx` does
   - do NOT mock: `BoardProvider` or `useBoard`

   Expected RED:
   - `focusModeEnabled` is not a member of the context value — the probe reads `undefined`

7. Run test — verify FAIL: `npm run test --workspace=client -- src/context/BoardContext.focusFlag.test.tsx`
   Expected failure: `expected undefined to be false`

8. Implement the pending default: in `client/src/api.ts` add `focus: { getConfig: () => request<{ enabled: boolean }>("/focus/config") }`, mirroring `api.ticketIntake.getConfig`. In `client/src/context/BoardContext.tsx` add `focusModeEnabled: boolean` to `BoardContextValue`, a `useState(false)`, a mount-time effect copying the ticket-intake effect verbatim in shape (`let active = true` guard, `.catch(() => setFocusModeEnabled(false))`), and the field on the provider value.

9. Run test — verify PASS: `npm run test --workspace=client -- src/context/BoardContext.focusFlag.test.tsx`

9a. Write/run a separate RED→implementation→PASS cycle for enabled true: Given `getConfig` resolves `{ enabled: true }`, When the provider settles, Then `focusModeEnabled` becomes `true`.
    Test file: `client/src/context/BoardContext.focusFlag.test.tsx`
    Level: unit (component/hook, jsdom)
    Exercise through: the same `useBoard()` probe after the mocked config promise resolves
    Test doubles: `vi.hoisted` `api.focus.getConfig` resolving `{ enabled: true }`; `MockEventSource`; do not mock `BoardProvider`
    Expected RED: the effect never writes `true` from the payload.
    Run FAIL then PASS: `npm run test --workspace=client -- src/context/BoardContext.focusFlag.test.tsx`

9b. Write/run a separate RED→implementation→PASS cycle for config rejection: Given `getConfig` rejects, When the provider settles, Then `focusModeEnabled` stays `false` and no error is surfaced. A missing flag endpoint degrades silently to feature off.
    Test file: `client/src/context/BoardContext.focusFlag.test.tsx`
    Level: unit (component/hook, jsdom)
    Exercise through: the same probe after the mocked config promise rejects
    Test doubles: `vi.hoisted` `api.focus.getConfig` rejecting; `MockEventSource`; do not mock `BoardProvider`
    Expected RED: the rejection surfaces as an error or leaves the field undefined.
    Run FAIL then PASS: `npm run test --workspace=client -- src/context/BoardContext.focusFlag.test.tsx`

9c. Repair the two existing `BoardProvider` test suites. Add
    `focus: { getConfig: vi.fn().mockResolvedValue({ enabled: false }) },`
    to the `vi.mock("../api", ...)` factory in each of:
    - `client/src/context/BoardContext.viewMode.test.tsx` (beside the existing `ticketIntake` entry, ~line 30)
    - `client/src/hooks/useTicketIntakeChat.integration.test.tsx`

    These are not new tests — they are the blast radius of adding a mount-time call to a shared provider. Verify with the full client suite: `npm run test --workspace=client`. Any other suite that renders `BoardProvider` behind a partial `../api` mock needs the same one-line addition.

10. Refactor while green (bounded):
    - Rule of three: the flag-fetch effect now exists twice (ticket intake, focus). Two is not three — do NOT extract a shared hook yet
    - `BoardContext.tsx` is already ~742 lines: this task may add only the state, the effect, and the value field. Do not extract unrelated existing code out of it — that is out of scope for this plan
    - Re-run `npm run test --workspace=server -- src/routes/focus-config.test.ts` and `npm run test --workspace=client -- src/context/BoardContext.focusFlag.test.tsx` — must stay PASS

11. Commit:
    `git add server/src/config.ts server/src/routes/focus-config.ts server/src/routes/focus-config.test.ts server/src/routes.ts client/src/api.ts client/src/context/BoardContext.tsx client/src/context/BoardContext.focusFlag.test.tsx client/src/context/BoardContext.viewMode.test.tsx client/src/hooks/useTicketIntakeChat.integration.test.tsx`
    `git commit -m "feat(focus): add FOCUS_MODE_ENABLED flag and client visibility"`

## REFERENCES LOADED

- `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md` — Rollback Plan ("Disable `FOCUS_MODE_ENABLED` flag — hides entry points and /focus route"); Open Questions row on `FOCUS_MODE_ENABLED` client visibility
- `server/src/routes/workspaces.patch.test.ts:35-37` — the `vi.mock("../auth.js")` pass-through shape
- `server/src/routes/ticket-intake.integration.test.ts:20-27` — the `vi.mock("../config.js")` shape (static there; this task needs the `vi.hoisted` mutable variant)
- `server/src/index.ts:119-122` — shows `api` mounted at `/api` and `ticketIntakeRouter` mounted separately, which is why step 5 diverges from the ticket-intake precedent

**Deliberate deviation from the spec.** Spec line 352 proposes exposing the flag "via bootstrap (`GET /me` or workspace read)". This task uses a dedicated `GET /api/focus/config` endpoint instead, because it copies a working precedent end to end and leaves `/me` untouched — which is also what this task's own STOP CONDITIONS require. Recorded here so the deviation is a decision rather than a drift.
- `server/src/routes/ticket-intake.ts` (line ~217) — the `GET /<feature>/config → { enabled }` endpoint precedent
- `client/src/api.ts` (line ~805) — `api.ticketIntake.getConfig` shape
- `client/src/context/BoardContext.tsx` (lines ~182, ~201–214, ~731) — the `ticketIntakeEnabled` state + mount effect + context value wiring this task copies
- `server/src/config.ts` — `OAUTH_ENABLED` / `EMAIL_GATE_ENABLED` establish `z.enum(["true","false"]).default("false")` as the flag convention
- `client/src/context/BoardContext.viewMode.test.tsx` — `MockEventSource` stub needed to render `BoardProvider` in jsdom

## WHY THIS APPROACH

Complexity: standard
Justification: six files across both workspaces, but every one of them is a near-mechanical copy of an existing, working flag. The interpretation cost is in matching the precedent exactly rather than in novel design.

## SANDWICH CONTEXT

[CRITICAL: the flag defaults to `"false"`. Every test that exercises focus behavior — here and in T4, T5 — must set `FOCUS_MODE_ENABLED` explicitly rather than relying on the default, or it will pass for the wrong reason.]

You are implementing the `FOCUS_MODE_ENABLED` feature flag for Commit Focus (personal focus mode).
Spec: `docs/pocket/spec/2026-09-04-commit-focus/commit-focus.md`
Design decision: Option A, gated behind a server config flag so the Rollback Plan can hide the entire feature without a code revert.
Files in scope: `server/src/config.ts`, `server/src/routes/focus-config.ts`, `server/src/routes.ts`, `client/src/api.ts`, `client/src/context/BoardContext.tsx`, the two new test files, and the two existing `BoardProvider` test files whose `../api` mocks must gain a `focus` entry (`client/src/context/BoardContext.viewMode.test.tsx`, `client/src/hooks/useTicketIntakeChat.integration.test.tsx`) — no other files.
Test framework: Vitest. Server (node): `npm run test --workspace=server -- src/routes/focus-config.test.ts`. Client (jsdom): `npm run test --workspace=client -- src/context/BoardContext.focusFlag.test.tsx`. Never `npm run test -- <path>` from the repo root, and never `-t "<multi word>"` — both fail silently or for the wrong reason.
Available after: none (prereq). Runs in parallel with T1 and T2.
Architecture rule: server imports carry `.js` extensions (NodeNext ESM); client imports carry none. Never read `process.env` outside `config.ts`. Never use `import.meta.env` — no such pattern exists in this codebase.

[RESTATE: `FOCUS_MODE_ENABLED` defaults to `"false"` — set it explicitly in every test that depends on it.]

## DELIVERABLE

Verification — task is DONE when all pass:

[derived] Given `FOCUS_MODE_ENABLED=true`, When an authenticated user requests `GET /api/focus/config`, Then the response is `200 { enabled: true }`
[derived] Given `FOCUS_MODE_ENABLED=false`, When the same request is made, Then the response is `200 { enabled: false }`
[derived] Given `BoardProvider` mounts and `getConfig` resolves `{ enabled: true }`, When the context is read, Then `focusModeEnabled` is `true`
[derived] Given `getConfig` rejects, When the context is read, Then `focusModeEnabled` is `false`
[must-not] Given `getConfig` rejects, When the app renders, Then it must NOT surface an error toast or block rendering — an unreachable flag endpoint degrades silently to "feature off"

All tests PASS. Commit exists with message matching `feat(focus): add FOCUS_MODE_ENABLED flag and client visibility`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR

Must-have:
- Flag default is `"false"`, matching `OAUTH_ENABLED` / `EMAIL_GATE_ENABLED`
- Config endpoint requires auth
- Client failure path degrades to "off", never to an error state
- Tests written BEFORE implementation (TDD — not after)
- Commit message follows conventional commits format

Must-not-have:
- Any focus lifecycle logic — this task ships a flag and nothing else
- Editing `server/src/routes/focus-session.ts` (T4 owns that file)
- Adding focus logic inline to `BoardContext.tsx` beyond the flag state, its effect, and the context field
- `import.meta.env` or a direct `process.env` read outside `config.ts`

Open question risks:
- Assumption: the flag is deployment-wide, not per-workspace. If focus must be enabled per workspace, this endpoint's shape changes → report NEEDS_CONTEXT before adding a workspace param.

Rollback note:
- This task IS the rollback mechanism. Setting `FOCUS_MODE_ENABLED=false` must leave the app fully functional with no focus surface — verify that path explicitly rather than assuming it.

Red flags:
- Work outside the listed files → DONE_WITH_CONCERNS. Extending an existing `../api` mock with a `focus` entry is expected work, not scope creep
- A green gate that ran zero tests (`Tests N skipped (N)`) treated as PASS → STOP
- Focus lifecycle behavior implemented here → STOP

## STOP CONDITIONS

Done when: all DELIVERABLE scenarios pass, the full `npm run test` (server + client) is green, commit created
Uncertain when: the deployment-wide vs. per-workspace assumption proves wrong
Escalate when: exposing the flag appears to require changing `/me` or the workspace read payload
