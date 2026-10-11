# Task T5 — Guard ticket extraction but preserve classifier question

**Phase:** 1
**Depends:** T2
**Source plan:** ../../execution-plan.md

---

### Pocket Packet

### Task 5: Guard ticket extraction but preserve classifier question [depends: T2] [parallel: T4]

## OBJECTIVE

**Regression baseline (write/run before route source edits; expected PASS today, not RED cycles):** In `server/src/modules/agent/ticket-intake/routes.test.ts`, independently characterize first-turn classifier question/no extraction; not-configured 503; malformed input/workspace 400; non-member 404; locked rate-limit 429; and default-off valid extraction response. Level: integration through mounted ticket router/Supertest. Test doubles: auth, membership, configured state, limiter, and extraction as needed; keep route ordering and guard real. Run `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts` before production edits; record current statuses/bodies and rerun after.

1. Write a failing ticket extraction HTTP test for the blocked spend path.
   Test file: `server/src/modules/agent/ticket-intake/routes.test.ts`  
   Level: integration  
   Test intent: Given ticket intake is configured, user is authenticated/member, message is valid, request is not the no-LLM first classifier turn, and rate limit allows it, When extraction is requested with switch enabled, Then exact HTTP 503 JSON is returned before `extractTicketFields` is invoked.  
   Exercise through: mounted ticket-intake router with Supertest.  
   Test doubles: Mock config/guard, auth, membership, rate-limit, configured state, and extraction; keep router/route ordering real.  
   Expected RED: extraction is currently invoked with no shared guard or typed response mapping.
2. Run test — verify FAIL: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`
3. Add the shared assertion immediately before extraction response processing, after configured check, workspace/message validation, membership, first-turn response, and existing rate-limit check. Catch/map only the typed error to exact 503 JSON. Run test and verify PASS; refactor while green.
4. Rerun the prewritten first-turn regression with switch enabled; verify classifier question is returned without guard or extractor call.
5. Run regression: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`
6. Confirm first-turn remains green; this is not a RED cycle.
7. Rerun prewritten not-configured baseline with switch enabled; verify exact existing 503 error/body is returned before kill-switch mapping.
8. Run regression: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`
9. Confirm configuration precedence remains green; this is not a RED cycle.
10. Rerun prewritten malformed-input cases independently; verify existing HTTP 400 response/body precedes guard and extraction.
11. Run regression: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`
12. Confirm validation precedence remains green; this is not a RED cycle.
13. Rerun prewritten non-member case; verify existing HTTP 404 body occurs before guard/extraction.
14. Run regression: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`
15. Confirm membership precedence remains green; this is not a RED cycle.
16. Rerun prewritten locked-rate-limit case; verify exact HTTP 429 response/metadata occurs before guard and extraction.
17. Run regression: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`
18. Confirm rate-limit precedence remains green; this is not a RED cycle.
19. Rerun the prewritten default-off extraction regression; verify extraction and current success/clarification response remain.
20. Run regression: `npm run test --workspace=server -- src/modules/agent/ticket-intake/routes.test.ts`
21. Confirm default-off extraction remains green; commit `fix(agent): guard ticket extraction spend and preserve precedence`.

## REFERENCES LOADED

- Spec rules Ticket extraction denied but first classifier question remains available; Access/validation precedence; open assumption that not-configured response wins.
- `server/src/modules/agent/ticket-intake/routes.ts`, `routes.test.ts`, `rate-limits.ts`, `llm.ts`; `server/src/modules/agent/index.ts`.
- Express `5.2.1`, Supertest `7.2.2`, Vitest `4.1.10` references recorded in T3/T4; repository tests mock extraction and route dependencies. No external service docs needed for a guard before existing extraction.

## WHY THIS APPROACH

Complexity: standard.  
Justification: Route branching deliberately separates the first no-LLM turn from extraction and has meaningful ordering across configuration, validation, membership, and rate limiting.

## SANDWICH CONTEXT

[CRITICAL: Guard only the branch that will invoke ticket extraction; preserve the first classifier question and all earlier validation/access/rate-limit responses.]  
You are implementing the ticket-intake HTTP boundary for the spend kill switch.  
Spec: `docs/pocket/spec/2026-10-10-agent-spend-kill-switch/spend-kill-switch.md`  
Design decision: shared typed guard and explicit response mapping at each HTTP boundary.  
Files in scope: `server/src/modules/agent/ticket-intake/routes.ts`, `server/src/modules/agent/ticket-intake/routes.test.ts`; depends on T1/T2, parallel with chat and deployment.  
Architecture rule: Do not gate Linear submit/resubmit or other non-LLM paths.  
[RESTATE: Guard only the branch that will invoke ticket extraction; preserve the first classifier question and all earlier validation/access/rate-limit responses.]

## DELIVERABLE

Given an extraction turn with switch enabled and all existing checks passed, When request reaches extraction, Then exact 503 JSON is returned before extractor call.  
Given the no-LLM first turn or any earlier error condition, When switch is enabled, Then the existing result is returned and no kill-switch error is produced.

## QUALITY BAR

Must-have:
- Preserve exact check order: configured → workspace/message validation → membership → first-turn no-LLM response → rate limit → guard → extraction.
- Assert exact 503 body and extractor-not-called; assert first-turn response and no guard invocation.
- Map only the typed error.

Must-not-have:
- No gate on ticket submit/resubmit, history/config/read, or classifier-only first turn.

Open question risks:
- If not configured, existing 503 must take precedence over kill-switch response.

Rollback note:
- Revert ticket route guard and tests; no persistent data changes.

Red flags:
- Gate before first-turn or rate limit → STOP.

## STOP CONDITIONS

Done when focused ticket route tests prove denial and allow paths with priority preserved.  
Uncertain when a branch unexpectedly invokes LLM despite first-turn condition.  
Escalate if extraction is discovered in a different production path outside the scoped route.
