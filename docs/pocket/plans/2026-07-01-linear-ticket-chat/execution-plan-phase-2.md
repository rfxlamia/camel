# Linear Ticket-Intake Chat — Server router — chat-turn endpoint (Phase 2 of 3)

**Date:** 2026-07-01
**Original plan:** /Users/rfxlamia/project/camel/docs/pocket/plans/2026-07-01-linear-ticket-chat/execution-plan.md
**Prerequisite:** Phase 1 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T5, T6, T7}
**Unlocks next:** Phase 3

---

## Task List

Total: 3 tasks | Prerequisite phases must be complete before starting

T5: Server router — chat-turn endpoint [depends: T2, T4]
T6: Server router — submit + resubmit (async + SSE result) [depends: T1, T3, T4, T5]
T7: Server router — ticket history endpoint [depends: T3, T6]

---

## Pocket Packets

---

### Task 5: Server router — chat-turn endpoint [depends: T2, T4]

## OBJECTIVE
Create the ticket-intake router and its first endpoint: the turn-based chat message handler that asks the classifier question on turn 1 (unless auto-error), runs extraction + completeness (Task 2), enforces the chat rate limit (Task 4), and mounts under `requireAuth`.

Files:
- Create: `server/src/routes/ticket-intake.ts`
- Modify: `server/src/index.ts` (mount router)
- Test: `server/src/routes/ticket-intake.test.ts`

Steps:
1. Write failing test for: turn-1 classifier question (non-auto-error entry points)
   File: `server/src/routes/ticket-intake.test.ts`
   Test verifies: Given a workspace member, When `POST /api/workspaces/:wid/ticket-intake/chat` is called with `{message: "kanban-nya aneh", isFirstTurn: true, autoError: false}`, Then the response includes a classifier-directing question (bug/feature/improvement) and `ready: false`.
   Also test: Given the same conversation continues with `{message: "bug", conversationHistory: [...]}` and the accumulated input is already detailed (repro + expected/actual present), When the endpoint is called, Then it returns `ready: true` with a `draft` object and no further question (Story 1 fast path).
   Also test: Given the accumulated input is vague, When the endpoint is called after the classifier turn, Then it returns `ready: false` with a specific clarifying question (Story 2 guided path), not a generic one.
   Also test: Given a user who is not a workspace member (`lookupMembership` resolves `null`), When the endpoint is called, Then it returns `404` and no draft data — covering the [must-not] deliverable here rather than deferring it to Task 7's history tests.

   ```typescript
   import express from "express";
   import request from "supertest";
   import { beforeEach, describe, expect, it, vi } from "vitest";

   // Single resettable factory for ./helpers.js — Tasks 6 and 7 extend THIS
   // mock (vi.mock allows exactly one factory per module path per file; never
   // redeclare it when those tasks add their describes to this file).
   const mockLookupMembership = vi.fn();
   const mockRecordActivity = vi.fn();
   vi.mock("./helpers.js", () => ({
   	lookupMembership: (...args: unknown[]) => mockLookupMembership(...args),
   	recordActivity: (...args: unknown[]) => mockRecordActivity(...args),
   }));
   vi.mock("../agent/ticket-intake/rate-limits.js", () => ({
   	checkChatLimit: vi.fn().mockResolvedValue({ isLocked: false }),
   }));
   const mockExtractTicketFields = vi.fn();
   vi.mock("../agent/ticket-intake/llm.js", () => ({
   	extractTicketFields: (...args: unknown[]) =>
   		mockExtractTicketFields(...args),
   }));
   vi.mock("../agent/ticket-intake/completeness.js", () => ({
   	checkCompleteness: vi.fn(
   		(extraction: { title: string; expected: string; actual: string }) => {
   			if (!extraction.title) {
   				return {
   					ready: false,
   					missingFields: ["title"],
   					question: "What's a short title?",
   				};
   			}
   			if (!extraction.expected || !extraction.actual) {
   				return {
   					ready: false,
   					missingFields: ["expected", "actual"],
   					question: "What did you expect vs. what actually happened?",
   				};
   			}
   			return { ready: true };
   		},
   	),
   }));

   import { ticketIntakeRouter } from "./ticket-intake.js";

   const app = express();
   app.use(express.json());
   app.use((req, _res, next) => {
   	(req as Record<string, unknown>).user = { id: 7, displayName: "Bob" };
   	next();
   });
   app.use("/api", ticketIntakeRouter);

   describe("POST /api/workspaces/:workspaceId/ticket-intake/chat", () => {
   	beforeEach(() => {
   		mockExtractTicketFields.mockReset();
   		mockLookupMembership.mockReset().mockResolvedValue("member");
   	});

   	it("asks a classifier-directing question on turn 1 for non-auto-error entry points", async () => {
   		mockExtractTicketFields.mockResolvedValueOnce({
   			title: "",
   			description: "kanban-nya aneh",
   			expected: "",
   			actual: "",
   			repro: "",
   			type: null,
   		});

   		const res = await request(app)
   			.post("/api/workspaces/1/ticket-intake/chat")
   			.send({ message: "kanban-nya aneh", isFirstTurn: true, autoError: false });

   		expect(res.status).toBe(200);
   		expect(res.body.ready).toBe(false);
   		expect(res.body.question).toMatch(/bug|feature|improvement/i);
   	});

   	it("returns ready:true with a draft when accumulated input is already detailed (fast path)", async () => {
   		mockExtractTicketFields.mockResolvedValueOnce({
   			title: "Drag-drop breaks",
   			description: "desc",
   			expected: "card moves",
   			actual: "card snaps back",
   			repro: "drag card X",
   			type: "Bug",
   		});

   		const res = await request(app)
   			.post("/api/workspaces/1/ticket-intake/chat")
   			.send({
   				message: "bug",
   				conversationHistory: [{ role: "user", content: "kanban-nya aneh" }],
   			});

   		expect(res.status).toBe(200);
   		expect(res.body.ready).toBe(true);
   		expect(res.body.draft).toBeDefined();
   		expect(res.body.question).toBeUndefined();
   	});

   	it("asks a specific clarifying question when accumulated input is still vague (guided path)", async () => {
   		mockExtractTicketFields.mockResolvedValueOnce({
   			title: "Kanban aneh",
   			description: "desc",
   			expected: "",
   			actual: "",
   			repro: "",
   			type: "Bug",
   		});

   		const res = await request(app)
   			.post("/api/workspaces/1/ticket-intake/chat")
   			.send({
   				message: "bug",
   				conversationHistory: [{ role: "user", content: "kanban-nya aneh" }],
   			});

   		expect(res.status).toBe(200);
   		expect(res.body.ready).toBe(false);
   		expect(res.body.question).toMatch(/expect|actual/i);
   	});

   	it("returns 404 with no draft data for a user who is not a workspace member", async () => {
   		mockLookupMembership.mockResolvedValueOnce(null);

   		const res = await request(app)
   			.post("/api/workspaces/1/ticket-intake/chat")
   			.send({ message: "kanban-nya aneh", isFirstTurn: true, autoError: false });

   		expect(res.status).toBe(404);
   		expect(res.body.draft).toBeUndefined();
   	});
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/ticket-intake.test.ts`
   Expected failure: 404 (route does not exist yet) or module not found

3. Implement minimal code to satisfy the test:
   File: `server/src/routes/ticket-intake.ts`
   Implement: `export const ticketIntakeRouter = Router()`. `POST /workspaces/:workspaceId/ticket-intake/chat` (mounted with `requireAuth` per-route, matching the `agent/routes.ts` precedent of NOT applying `requireAuth` at router level to avoid double-mounting): validates workspace membership, calls `checkChatLimit(userId)` from Task 4 — if locked, `429`; on `isFirstTurn && !autoError`, injects the classifier question into the conversation flow before calling `extractTicketFields`; calls `extractTicketFields` (Task 2) then `checkCompleteness` (Task 2); returns `{ready, question?, draft?}`. On `autoError: true`, skips the classifier question entirely and force-sets `type: "Bug"` on the extraction.
   File: `server/src/index.ts`
   Implement: Add `import { ticketIntakeRouter } from "./routes/ticket-intake.js";` and `app.use("/api", ticketIntakeRouter);` near the existing `app.use("/api", createAgentRouter());` line.

4. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/ticket-intake.test.ts`
   Expected: PASS

5. Commit:
   `git add server/src/routes/ticket-intake.ts server/src/index.ts server/src/routes/ticket-intake.test.ts`
   `git commit -m "feat(ticket-intake): add chat-turn endpoint with classifier and adaptive completeness"`

## REFERENCES LOADED
`docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md` — rule: Entry points (Story 1 Rule 1, Story 2 Rule 1, Story 4 Rule 3), Acceptance Criteria "Classification & adaptive chat"
`server/src/agent/routes.ts` — router-mounting precedent: `requireAuth` applied per-route (not at router level), workspace-scoped path structure, deps-injection style for testability
`server/src/index.ts` — exact mount-point pattern (`app.use("/api", createAgentRouter())`) copied for the new router

## WHY THIS APPROACH
Complexity: standard
Justification: Cross-file coordination (new router + index.ts mount) plus conditional branching on `isFirstTurn`/`autoError` that determines whether the classifier question fires — this is judgment-bearing routing logic, not a mechanical CRUD endpoint.

## SANDWICH CONTEXT
[CRITICAL: This router MUST NOT import from `server/src/agent/templates.ts` or `server/src/agent/tools/registry.ts` — those are board-context specific per Architecture Constraints.]
You are implementing the ticket-intake chat-turn endpoint for the Linear Ticket-Intake Chat feature.
Spec: docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md
Design decision: Option B — structured extraction + completeness check drives the turn logic (this endpoint is the HTTP surface over Task 2's pure logic).
Files in scope: `server/src/routes/ticket-intake.ts`, `server/src/index.ts` (mount line only), `server/src/routes/ticket-intake.test.ts`. No other files. (Tasks 6 and 7 will extend this same router file later — do not attempt to build submit/history endpoints in this task.)
Test framework: Vitest + supertest (or the existing route-test pattern used elsewhere in `server/src/routes/`), per `testing-conventions.md`.
Available after: T2 (extraction/completeness), T4 (rate limits).
Architecture rule: `requireAuth` gate on every route, applied per-route not at router level (matches `agent/routes.ts` to avoid double-mounting under `/api`).
[RESTATE: No imports from `templates.ts` or `tools/registry.ts`.]

## DELIVERABLE
Given a non-auto-error entry point, When the AI's first turn runs, Then it always asks a classifier-directing question (bug/feature/improvement)
Given already-detailed input and the classifier answered, When the endpoint is called, Then it skips further clarifying questions and returns `ready: true` with a draft (Story 1 fast path)
Given vague input and the classifier answered, When the endpoint is called, Then it asks a specific clarifying question and `ready: false` (Story 2 guided path)
Given `autoError: true`, When the chat opens, Then the classifier question is skipped and `type` is forced to `"Bug"`
[must-not] Given a user without workspace membership, When they call this endpoint, Then it returns 404, not draft data

All tests PASS. Commit exists with message matching `feat(ticket-intake): add chat-turn endpoint with classifier and adaptive completeness`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `requireAuth` applied per-route (not router-level), matching `agent/routes.ts` precedent
  - Chat rate limit (Task 4) enforced before the LLM call, returning 429 when locked
  - Tests written BEFORE implementation

Must-not-have:
  - Submit or history endpoints in this task (Tasks 6, 7)
  - Any import from `templates.ts` or `tools/registry.ts`
  - Manual type override endpoint/param (out of scope)

Open question risks:
  - None specific to this task

Rollback note:
  - Entry points independently removable from the client without touching this server logic, per spec's Rollback Plan — this task itself has no migration to reverse.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: none identified
Escalate when: satisfying a test requires touching `templates.ts` or `tools/registry.ts`

---

### Task 6: Server router — submit + resubmit (async + SSE result) [depends: T1, T3, T4, T5]

## OBJECTIVE
Add the ticket submission endpoint to the router created in Task 5. Submit runs the retry loop asynchronously in the background (not held inside the HTTP request) and publishes the outcome via the existing Redis Pub/Sub → SSE channel, because the global 30-second `requestTimeout` middleware would otherwise race an early 503 to the client while a multi-minute retry loop kept running server-side — risking a client-visible "failure" followed by a user-triggered resubmit while the original attempt is still in flight (duplicate-ticket risk). User confirmed this async+SSE approach over holding the connection open.

Files:
- Modify: `server/src/routes/ticket-intake.ts`
- Modify: `server/src/realtime.ts`
- Modify: `server/src/routes/ticket-intake.test.ts`

Steps:
1. Write failing test for: submit returns immediately and eventually publishes success
   File: `server/src/routes/ticket-intake.test.ts`
   Test verifies: Given a valid draft and a mocked `createLinearIssue` that succeeds on the first call, When `POST /api/workspaces/:wid/ticket-intake/submit` is called, Then the HTTP response returns `202` within the test's synchronous assertion (no `await` on the retry loop itself), and — after flushing pending microtasks/timers — a mocked `publishEvent` was called with `{type: "ticket_intake.submit_result", workspaceId, cardId, success: true, issueUrl, issueIdentifier}`.
   Also test: Given `createLinearIssue` fails with a 500-class error on the first 2 calls then succeeds, When submit is called, Then `publishEvent` is eventually called with `success: true`, and `recordSubmitSuccess` (Task 4) was called exactly once (quota consumed only at final success).
   Also test: Given `createLinearIssue` fails with a 400-class error, When submit is called, Then `publishEvent` is called quickly with `{success: false, errorMessage: <human-readable>, retryable: false}` and no retry delay elapses.
   Also test: Given `createLinearIssue` fails with 500-class errors on all 10 attempts, When submit is called, Then `publishEvent` is eventually called with `{success: false, retryable: true}` (graceful failure, not a success message) and `recordSubmitSuccess` was never called.
   Also test: Given `createLinearIssue` succeeds but `createLinearComment` (metadata) throws, When submit is called, Then `publishEvent` still reports `success: true` (issue exists in Linear), and the comment failure is logged server-side with no retry attempted for the comment call.
   Also test: Given the submit rate limit is locked (Task 4's `peekSubmitLimit` returns `isLocked: true`), When submit is called, Then the endpoint returns `409` immediately without attempting `createLinearIssue` at all (defense in depth per Story 7).

   > **Merge note (shared test file):** this extends Task 5's
   > `ticket-intake.test.ts`. `vi.mock` allows exactly ONE factory per module
   > path per file — `./helpers.js` is already mocked by Task 5's resettable
   > factory (`mockLookupMembership`/`mockRecordActivity`); do NOT redeclare it.
   > Reuse the file's existing imports and express `app` harness too — the
   > snippet below is written standalone for readability, so drop anything the
   > file already declares when merging.

   ```typescript
   import express from "express";
   import request from "supertest";
   import { beforeEach, describe, expect, it, vi } from "vitest";

   // ./helpers.js is already mocked at the top of this file (Task 5's
   // resettable factory) — reuse mockLookupMembership/mockRecordActivity.
   vi.mock("../realtime.js", () => ({
   	publishEvent: vi.fn().mockResolvedValue(undefined),
   }));
   const mockPeekSubmitLimit = vi.fn();
   const mockRecordSubmitSuccess = vi.fn();
   vi.mock("../agent/ticket-intake/rate-limits.js", () => ({
   	peekSubmitLimit: (...args: unknown[]) => mockPeekSubmitLimit(...args),
   	recordSubmitSuccess: (...args: unknown[]) => mockRecordSubmitSuccess(...args),
   }));
   const mockCreateLinearIssue = vi.fn();
   const mockCreateLinearComment = vi.fn();
   vi.mock("../agent/ticket-intake/linear-client.js", () => ({
   	createLinearIssue: (...args: unknown[]) => mockCreateLinearIssue(...args),
   	createLinearComment: (...args: unknown[]) => mockCreateLinearComment(...args),
   	getLabelId: vi.fn().mockResolvedValue("label-bug-id"),
   }));
   // Real backoff/timing is already covered by Task 1's retry.test.ts — this
   // router test only needs the classify-then-retry-or-throw *shape*, without
   // real sleeps, so the router's own tests stay fast and deterministic.
   vi.mock("../agent/ticket-intake/retry.js", () => ({
   	executeWithRetry: async (
   		op: () => Promise<unknown>,
   		opts: { maxAttempts: number },
   	) => {
   		let attempt = 0;
   		for (;;) {
   			attempt++;
   			try {
   				return await op();
   			} catch (err: unknown) {
   				const status = (err as { status?: number })?.status ?? 500;
   				const retryable = status >= 500;
   				if (!retryable) throw { retryable: false, cause: err };
   				if (attempt >= opts.maxAttempts) throw { retryable: true, cause: err };
   			}
   		}
   	},
   }));

   import { publishEvent } from "../realtime.js";
   import { ticketIntakeRouter } from "./ticket-intake.js";

   const mockPublishEvent = vi.mocked(publishEvent);

   const app = express();
   app.use(express.json());
   app.use((req, _res, next) => {
   	(req as Record<string, unknown>).user = { id: 7, displayName: "Bob" };
   	next();
   });
   app.use("/api", ticketIntakeRouter);

   async function flush() {
   	await new Promise((resolve) => setImmediate(resolve));
   	await new Promise((resolve) => setImmediate(resolve));
   }

   describe("POST /api/workspaces/:workspaceId/ticket-intake/submit", () => {
   	beforeEach(() => {
   		mockLookupMembership.mockReset().mockResolvedValue("member");
   		mockRecordActivity.mockReset().mockResolvedValue(undefined);
   		mockPeekSubmitLimit.mockReset().mockResolvedValue({ isLocked: false });
   		mockRecordSubmitSuccess.mockReset();
   		mockCreateLinearIssue.mockReset();
   		mockCreateLinearComment.mockReset().mockResolvedValue(undefined);
   		mockPublishEvent.mockReset();
   	});

   	it("responds 202 immediately and eventually publishes success on first-try issueCreate", async () => {
   		mockCreateLinearIssue.mockResolvedValueOnce({
   			issueUrl: "https://linear.app/cam/issue/CAM-1",
   			issueIdentifier: "CAM-1",
   		});

   		const res = await request(app)
   			.post("/api/workspaces/1/ticket-intake/submit")
   			.send({ title: "Bug title", description: "desc", type: "Bug" });

   		expect(res.status).toBe(202);

   		await flush();
   		expect(mockPublishEvent).toHaveBeenCalledWith(
   			1,
   			expect.objectContaining({
   				type: "ticket_intake.submit_result",
   				success: true,
   				issueUrl: "https://linear.app/cam/issue/CAM-1",
   				issueIdentifier: "CAM-1",
   			}),
   		);
   	});

   	it("reports eventual success after transient 500-class failures, consuming quota exactly once", async () => {
   		mockCreateLinearIssue
   			.mockRejectedValueOnce({ status: 500 })
   			.mockRejectedValueOnce({ status: 500 })
   			.mockResolvedValueOnce({
   				issueUrl: "https://linear.app/cam/issue/CAM-2",
   				issueIdentifier: "CAM-2",
   			});

   		await request(app)
   			.post("/api/workspaces/1/ticket-intake/submit")
   			.send({ title: "Bug title", description: "desc", type: "Bug" });

   		await flush();
   		expect(mockPublishEvent).toHaveBeenCalledWith(
   			1,
   			expect.objectContaining({ success: true }),
   		);
   		expect(mockRecordSubmitSuccess).toHaveBeenCalledTimes(1);
   	});

   	it("reports failure quickly on a 400-class error with no retry", async () => {
   		mockCreateLinearIssue.mockRejectedValueOnce({ status: 422 });

   		await request(app)
   			.post("/api/workspaces/1/ticket-intake/submit")
   			.send({ title: "Bug title", description: "desc", type: "Bug" });

   		await flush();
   		expect(mockCreateLinearIssue).toHaveBeenCalledTimes(1);
   		expect(mockPublishEvent).toHaveBeenCalledWith(
   			1,
   			expect.objectContaining({ success: false, retryable: false }),
   		);
   	});

   	it("reports graceful failure after all 10 retries are exhausted on 500-class errors", async () => {
   		mockCreateLinearIssue.mockRejectedValue({ status: 500 });

   		await request(app)
   			.post("/api/workspaces/1/ticket-intake/submit")
   			.send({ title: "Bug title", description: "desc", type: "Bug" });

   		await flush();
   		expect(mockCreateLinearIssue).toHaveBeenCalledTimes(10);
   		expect(mockPublishEvent).toHaveBeenCalledWith(
   			1,
   			expect.objectContaining({ success: false, retryable: true }),
   		);
   		expect(mockRecordSubmitSuccess).not.toHaveBeenCalled();
   	});

   	it("still reports overall success when issueCreate succeeds but createLinearComment fails", async () => {
   		mockCreateLinearIssue.mockResolvedValueOnce({
   			issueUrl: "https://linear.app/cam/issue/CAM-3",
   			issueIdentifier: "CAM-3",
   		});
   		mockCreateLinearComment.mockRejectedValueOnce(new Error("comment failed"));

   		await request(app)
   			.post("/api/workspaces/1/ticket-intake/submit")
   			.send({ title: "Bug title", description: "desc", type: "Bug" });

   		await flush();
   		expect(mockPublishEvent).toHaveBeenCalledWith(
   			1,
   			expect.objectContaining({ success: true }),
   		);
   	});

   	it("returns 409 immediately without calling createLinearIssue when the submit rate limit is locked", async () => {
   		mockPeekSubmitLimit.mockResolvedValueOnce({ isLocked: true });

   		const res = await request(app)
   			.post("/api/workspaces/1/ticket-intake/submit")
   			.send({ title: "Bug title", description: "desc", type: "Bug" });

   		expect(res.status).toBe(409);
   		expect(mockCreateLinearIssue).not.toHaveBeenCalled();
   	});
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/ticket-intake.test.ts`
   Expected failure: `POST /submit` returns 404 or `publishEvent` mock never called

3. Implement minimal code to satisfy the test:
   File: `server/src/realtime.ts`
   Implement: Extend the `BoardEvent["type"]` union with `"ticket_intake.submit_result"`. Add optional fields to `BoardEvent` needed to carry the payload: `cardId?: number`, plus a new `ticketResult?: {success: boolean; issueUrl?: string; issueIdentifier?: string; errorMessage?: string; retryable?: boolean}`.
   File: `server/src/routes/ticket-intake.ts`
   Implement: `POST /workspaces/:workspaceId/ticket-intake/submit` — checks `peekSubmitLimit(userId)` first (409 if locked, before any Linear call); on pass, immediately responds `202 {status: "submitting"}`; detaches an async IIFE (not awaited by the request handler) that calls `getLabelId` + `executeWithRetry(() => createLinearIssue(...), {...})` (Task 1); on success, calls `recordSubmitSuccess(userId)` (Task 4), `recordActivity(db, actor, workspaceId, "linear_ticket_created", {cardId, payload: {issueUrl, issueIdentifier, title}})` (Task 3's extended union), attempts `createLinearComment` best-effort (catch + `console.error`, no retry), then `publishEvent(workspaceId, {type: "ticket_intake.submit_result", ...success})`; on final failure (retryable exhausted or non-retryable), `publishEvent(workspaceId, {type: "ticket_intake.submit_result", ...failure})` — quota never consumed on this path. Add `POST /workspaces/:workspaceId/ticket-intake/resubmit` as a thin alias that re-invokes the same submission logic (same logical submission per Story 6 Rule 3) without re-checking `peekSubmitLimit` if the prior attempt never succeeded (it wouldn't have consumed quota anyway, so this is just a call to the same internal function).

4. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/ticket-intake.test.ts`
   Expected: PASS

5. Commit:
   `git add server/src/routes/ticket-intake.ts server/src/realtime.ts server/src/routes/ticket-intake.test.ts`
   `git commit -m "feat(ticket-intake): add async submit/resubmit with SSE result notification"`

## REFERENCES LOADED
`docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md` — rule: Submission & failure handling (Story 6, all 3 rules), Story 5 Rule 3, Story 7 Rule 1
`server/src/index.ts` — `isTimeoutExempt` and `requestTimeout(30000)` confirmed via code read: the middleware races an early 503 response but does NOT abort the underlying handler, which is exactly the hazard this task's async design avoids
`server/src/realtime.ts` — existing `BoardEvent` union and `publishEvent` function, extended rather than replaced; `workspaceAccessService`'s use of `publishEvent(...).catch(() => {})` is the precedent for best-effort event publishing
`client/src/context/BoardContext.tsx` — existing `agent.*` prefix-dispatch pattern in the SSE `onmessage` handler is the model this event's client-side consumption (Task 9) will mirror

## WHY THIS APPROACH
Complexity: standard
Justification: The retry-vs-timeout conflict required an explicit architectural decision (confirmed with the user) — async execution with SSE notification rather than a held HTTP connection. The endpoint itself has substantial branching (locked/unlocked, retryable/non-retryable, comment-failure-tolerance, resubmit-vs-submit) that requires deliberate sequencing, not a template CRUD handler.

## SANDWICH CONTEXT
[CRITICAL: The retry loop MUST run detached from the HTTP request/response cycle — never `await`ed inside the request handler before responding. The global `requestTimeout(30000)` middleware applies to this path (it does not match `/agent/` or `/events/stream`), and while it won't kill the retry loop, it WILL send a premature 503 to the client if the loop is awaited synchronously, causing the client to misreport failure while Linear silently succeeds moments later.]
You are implementing async ticket submission with SSE result notification for the Linear Ticket-Intake Chat feature.
Spec: docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md
Design decision: Option B (extraction/completeness) feeds the draft this endpoint submits; the async+SSE submission architecture was a separate decision confirmed with the user during planning (see plan's Architecture Constraints Addendum).
Files in scope: `server/src/routes/ticket-intake.ts` (extends Task 5's file — do not touch the chat-turn endpoint's logic), `server/src/realtime.ts` (BoardEvent union + payload fields only), `server/src/routes/ticket-intake.test.ts` (extends Task 5's test file). No other files.
Test framework: Vitest, mock `createLinearIssue`/`createLinearComment`/`publishEvent`/`recordSubmitSuccess` at top level per `testing-conventions.md`. Use `vi.useFakeTimers()` or the injectable `sleepFn` from Task 1's `executeWithRetry` to avoid real multi-second waits in tests.
Available after: T1 (Linear client + retry), T3 (recordActivity extension), T4 (rate limits), T5 (router file + mount already exist).
Architecture rule: `recordActivity()` / `card_events` MUST be called for this mutation (project-wide rule) — use the Task 3-extended `eventType: "linear_ticket_created"`.
[RESTATE: Never await the retry loop before sending the HTTP response — detach it.]

## DELIVERABLE
Given issueCreate succeeds on the first try, When submit is called, Then the client eventually receives a success SSE event with issueUrl/issueIdentifier, and a `card_events` row is written
Given issueCreate fails transiently (500-class) then a retry succeeds, When submit is called, Then the eventual SSE event reports success, and submit rate-limit quota is consumed only at that success point
Given issueCreate fails permanently (400-class), When submit is called, Then the SSE event reports failure quickly with a clear message, no retry attempted, and quota is NOT consumed
Given all 10 retries fail (500-class), When the last retry completes, Then the SSE event reports graceful failure (not success), and quota is NOT consumed
Given issueCreate succeeds but commentCreate fails, When submit is called, Then the SSE event still reports overall success, and the comment failure is logged server-side with no retry
Given the submit rate limit is already locked, When submit is called, Then it returns 409 immediately without calling `createLinearIssue`
[must-not] Given the retry loop has not yet resolved, Then the HTTP response for the initiating request must NOT still be open/pending — it must have already returned 202

All tests PASS. Commit exists with message matching `feat(ticket-intake): add async submit/resubmit with SSE result notification`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Retry loop detached from the request/response cycle — request returns 202 near-instantly regardless of eventual outcome
  - `recordSubmitSuccess` called exactly once, only on confirmed Linear success
  - `recordActivity` called with `eventType: "linear_ticket_created"` on success, `card_id` nullable when no card context
  - `commentCreate` failure is logged but never retried and never flips overall success to failure
  - Tests written BEFORE implementation, using fake timers or injected `sleepFn` — no real multi-second test runtime

Must-not-have:
  - Awaiting the retry loop before sending the HTTP response
  - Adding `server/src/routes/ticket-intake.ts`'s submit path to `isTimeoutExempt` in `index.ts` (rejected alternative — not needed with async+SSE)
  - Retrying `commentCreate` failures
  - Consuming rate-limit quota on any non-success outcome

Open question risks:
  - Multi-tab double-submit near the 5-min rate-limit boundary — accepted per spec's Open Questions (non-destructive, narrow race) → no additional coordination needed

Rollback note:
  - No DB migration. If deployed and problematic, unsetting `LINEAR_API_KEY` gates the whole feature off per spec's Rollback Plan.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: none identified
Escalate when: a test forces the retry loop to be awaited inside the request handler to pass — that reintroduces the timeout hazard this task exists to avoid

---

### Task 7: Server router — ticket history endpoint [depends: T3, T6]

## OBJECTIVE
Add the read-only ticket history endpoint to the router, backed by Task 3's `getTicketHistory` query.

Files:
- Modify: `server/src/routes/ticket-intake.ts`
- Modify: `server/src/routes/ticket-intake.test.ts`

Steps:
1. Write failing test for: history endpoint
   File: `server/src/routes/ticket-intake.test.ts`
   Test verifies: Given a card with 2 recorded `linear_ticket_created` events, When `GET /api/workspaces/:wid/ticket-intake/history?cardId=42` is called, Then the response is `200` with `{tickets: [{title, issueUrl, createdAt}, ...]}` (2 entries).
   Also test: Given a card with no history, When the endpoint is called, Then the response is `200` with `{tickets: []}` (empty array, not an error).
   Also test: Given a user who is not a member of the workspace, When the endpoint is called, Then it returns `404` (matching the existing `getCard`/`getBoard` membership-check convention in `routes/helpers.ts`).

   > **Merge note (shared test file):** same rule as Task 6 — `./helpers.js`
   > is already mocked once at the top of this file by Task 5's resettable
   > factory; reuse `mockLookupMembership` from there instead of redeclaring
   > the mock, and drop any imports/harness lines the file already has.

   ```typescript
   import express from "express";
   import request from "supertest";
   import { beforeEach, describe, expect, it, vi } from "vitest";

   // mockLookupMembership comes from Task 5's resettable factory at the top
   // of this file — reuse it directly.
   const mockGetTicketHistory = vi.fn();
   vi.mock("../agent/ticket-intake/history.js", () => ({
   	getTicketHistory: (...args: unknown[]) => mockGetTicketHistory(...args),
   }));

   import { ticketIntakeRouter } from "./ticket-intake.js";

   const app = express();
   app.use(express.json());
   app.use((req, _res, next) => {
   	(req as Record<string, unknown>).user = { id: 7, displayName: "Bob" };
   	next();
   });
   app.use("/api", ticketIntakeRouter);

   describe("GET /api/workspaces/:workspaceId/ticket-intake/history", () => {
   	beforeEach(() => {
   		mockLookupMembership.mockReset().mockResolvedValue("member");
   		mockGetTicketHistory.mockReset();
   	});

   	it("returns 2 entries for a card with recorded history", async () => {
   		mockGetTicketHistory.mockResolvedValueOnce([
   			{
   				title: "T1",
   				issueUrl: "https://linear.app/cam/issue/CAM-1",
   				createdAt: "2026-07-01T00:00:00Z",
   			},
   			{
   				title: "T2",
   				issueUrl: "https://linear.app/cam/issue/CAM-2",
   				createdAt: "2026-06-30T00:00:00Z",
   			},
   		]);

   		const res = await request(app).get(
   			"/api/workspaces/1/ticket-intake/history?cardId=42",
   		);

   		expect(res.status).toBe(200);
   		expect(res.body.tickets).toHaveLength(2);
   	});

   	it("returns an empty array for a card with no history", async () => {
   		mockGetTicketHistory.mockResolvedValueOnce([]);

   		const res = await request(app).get(
   			"/api/workspaces/1/ticket-intake/history?cardId=99",
   		);

   		expect(res.status).toBe(200);
   		expect(res.body.tickets).toEqual([]);
   	});

   	it("returns 404 for a user who is not a workspace member", async () => {
   		mockLookupMembership.mockResolvedValueOnce(null);

   		const res = await request(app).get(
   			"/api/workspaces/1/ticket-intake/history?cardId=42",
   		);

   		expect(res.status).toBe(404);
   	});
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/ticket-intake.test.ts`
   Expected failure: `GET /history` returns 404 (route not yet added) — distinguish from the membership-404 test by checking the response body shape differs (no route vs. explicit `{error: "Not found"}`)

3. Implement minimal code to satisfy the test:
   File: `server/src/routes/ticket-intake.ts`
   Implement: `GET /workspaces/:workspaceId/ticket-intake/history` — `requireAuth`, verify workspace membership (reuse `lookupMembership` from `routes/helpers.ts`), parse `cardId` query param, call `getTicketHistory(pool, workspaceId, cardId)` (Task 3), return `{tickets: [...]}`.

4. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/ticket-intake.test.ts`
   Expected: PASS

5. Commit:
   `git add server/src/routes/ticket-intake.ts server/src/routes/ticket-intake.test.ts`
   `git commit -m "feat(ticket-intake): add per-card ticket history endpoint"`

## REFERENCES LOADED
`docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md` — rule: Traceability & history (Story 8)
`server/src/routes/helpers.ts` — `lookupMembership`, membership-check-then-404 convention reused exactly as in `createScopedBoardService`

## WHY THIS APPROACH
Complexity: lightweight
Justification: Single GET endpoint, no branching beyond the standard membership check, thin pass-through to Task 3's already-tested query function.

## SANDWICH CONTEXT
[CRITICAL: History is snapshot-only — this endpoint MUST NOT call the Linear API to refresh status (out of scope per spec, protects the 5,000 req/hr Linear rate limit).]
You are implementing the ticket history endpoint for the Linear Ticket-Intake Chat feature.
Spec: docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md
Design decision: N/A for this task.
Files in scope: `server/src/routes/ticket-intake.ts` (extends Tasks 5/6's file — add only the history route), `server/src/routes/ticket-intake.test.ts` (extends the same test file). No other files.
Test framework: Vitest per `testing-conventions.md`.
Available after: T3 (history query), T6 (router file with submit endpoint already present).
Architecture rule: `requireAuth` on this route; workspace membership required (404 if not a member, matching existing convention).
[RESTATE: No Linear API call in this endpoint — snapshot from `card_events` only.]

## DELIVERABLE
Given a card with 2 ticket-history events, When the history endpoint is called, Then it returns 2 entries (title, link, created_at)
Given a card with no history, When the endpoint is called, Then it returns `{tickets: []}`, not an error
[must-not] Given a non-member calls this endpoint, Then it must NOT return ticket data — 404 instead

All tests PASS. Commit exists with message matching `feat(ticket-intake): add per-card ticket history endpoint`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Membership check before returning any data (404 for non-members)
  - Empty history returns `200 {tickets: []}`, never a 404 or error
  - Tests written BEFORE implementation

Must-not-have:
  - Any live Linear API call
  - A global (cross-card) history query — per-card only

Open question risks:
  - None specific to this task

Rollback note:
  - No migration. Revert commit directly if needed.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: none identified
Escalate when: satisfying a test requires a live Linear status call

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to Phase 3 ONLY after this gate passes.
