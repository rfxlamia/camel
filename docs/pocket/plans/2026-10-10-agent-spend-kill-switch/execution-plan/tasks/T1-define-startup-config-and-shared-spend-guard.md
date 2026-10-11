# Task T1 — Define startup config and shared spend guard

**Phase:** 1
**Depends:** none
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 1: Define startup config and shared spend guard [prereq]

## OBJECTIVE

1. Write a failing config test for absent, explicit `false`, explicit `true`, and invalid values.
   Test file: `server/src/__tests__/config.test.ts`  
   Level: unit  
   Test intent: Given an environment with required variables and no flag or flag `false`/`true`, When `resolveConfig` parses it, Then the default is `false` and explicit values remain exact strings; Given any other string, When parsed, Then Zod rejects it.  
   Exercise through: `resolveConfig()` and startup import behavior where needed, using the existing test module-reset pattern.  
   Test doubles: Supply isolated env values and module reset; no production config side effects, network, or DB.  
   Expected RED: the current parsed config strips the unknown key; default/explicit-true values are absent and invalid strings are not rejected, so all corresponding config assertions fail.
2. Run test — verify FAIL: `npm run test --workspace=server -- src/__tests__/config.test.ts`
3. Add the Zod string enum with default false to `server/src/config.ts`; add `AGENT_SPEND_KILL_SWITCH=false` with description to `server/.env.example`; rerun config test and verify PASS; refactor while green.
4. Write a failing unit test for the shared guard’s disabled/enabled contract.
   Test file: `server/src/modules/agent/spend-kill-switch.test.ts`  
   Level: unit  
   Test intent: Given the configured switch is absent or `false`, When `assertAgentSpendAllowed()` runs, Then it returns without error; Given it is `true`, When it runs, Then it throws the typed error with stable code `AGENT_SPEND_KILL_SWITCH` and message `Agent spend is disabled by kill switch`.  
   Exercise through: exported guard and error class from agent module API.  
   Test doubles: Mock config module value for enabled/disabled cases; do not mock guard/error; no network/DB.  
   Expected RED: guard module and exports do not exist.
5. Run test — verify FAIL: `npm run test --workspace=server -- src/modules/agent/spend-kill-switch.test.ts`
6. Implement one assertion and typed error in `server/src/modules/agent/spend-kill-switch.ts`, export via `server/src/modules/agent/index.ts`; rerun guard test and verify PASS; refactor while green; commit `feat(agent): add global spend guard`.

## REFERENCES LOADED

- Spec: `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md` — rules Default off, Deny new spend, Verification.
- `server/src/config.ts`, `server/src/__tests__/config.test.ts`, `server/src/modules/agent/index.ts`, `server/src/modules/agent/service.ts`.
- `docs/pocket/adr/2026-09-16-feature-module-convention.md` — module public API and 300-on-touch.
- Zod `4.4.3` (lockfile-resolved); official API docs: `https://zod.dev/api` (enum and object parsing); Context7 was not available in this session. Existing config enum and `resolveConfig` tests confirm repository usage. No new API beyond existing Zod calls is required.

## WHY THIS APPROACH

Complexity: standard.  
Justification: A small config addition plus a public typed contract used by multiple feature boundaries; the error’s stable shape and default must be established before consumers work in parallel.

## SANDWICH CONTEXT

[CRITICAL: Cross-feature consumers must use the guard/error only through `server/src/modules/agent/index.ts`; do not create a deep-import dependency.]  
You are implementing the shared startup config and guard for the Global Agent Spend Kill Switch.  
Spec: `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md`  
Design decision: one shared `assertAgentSpendAllowed()` assertion and typed error, with explicit HTTP-boundary mapping.  
Files in scope: `server/src/config.ts`, `server/.env.example`, `server/src/modules/agent/spend-kill-switch.ts`, `server/src/modules/agent/index.ts`, `server/src/modules/agent/spend-kill-switch.test.ts`, `server/src/__tests__/config.test.ts`.  
Architecture rule: The flag is startup-only, enum-limited to string values `true`/`false`, default false; keep server ESM `.js` specifiers.  
[RESTATE: Cross-feature consumers must use the guard/error only through `server/src/modules/agent/index.ts`; do not create a deep-import dependency.]

## DELIVERABLE

Given the flag is absent or `false`, When config is resolved and the guard is asserted, Then spend is allowed.  
Given the flag is `true`, When the guard is asserted, Then a typed error with stable code/message is thrown.  
Given an invalid flag string, When config is resolved, Then validation rejects startup/config resolution.

## QUALITY BAR

Must-have:
- One assertion/error definition shared by all affected feature surfaces.
- Test default false, explicit false/true, invalid value, stable error message/code.
- New source file remains within 300 lines; use only `agent/index.ts` as external API.

Must-not-have:
- No runtime hot-reload, dependency, UI, DB/schema, or migration work.

Open question risks:
- Startup-only semantics are intentional; env changes require recreation. If this assumption changes, stop and request design clarification.

Rollback note:
- Remove the config/env additions and guard module/export; no data rollback required.

Red flags:
- Work outside listed files → DONE_WITH_CONCERNS.
- Duplicated assertion or error contracts → STOP.

## STOP CONDITIONS

Done when all unit tests pass and downstream modules can import the same typed contract through the public API.  
Uncertain when the existing config pattern cannot express the string enum/default without a new dependency.  
Escalate when a consumer proposes deep imports or an in-flight guard.
