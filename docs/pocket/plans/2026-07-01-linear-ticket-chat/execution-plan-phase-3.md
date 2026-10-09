# Linear Ticket-Intake Chat — Client — api.ts additions + user-initiated tagging + auto-error bus (Phase 3 of 3)

**Date:** 2026-07-01
**Original plan:** /Users/rfxlamia/project/camel/docs/pocket/plans/2026-07-01-linear-ticket-chat/execution-plan.md
**Prerequisite:** Phase 2 must be COMPLETE — all tests green, all commits created
**Contains tasks:** {T8, T9, T10, T11, T12, T13, T14}
**Unlocks next:** All phases complete — proceed to final validation

---

## Task List

Total: 7 tasks | Prerequisite phases must be complete before starting

T8: Client — api.ts additions + user-initiated tagging + auto-error bus [depends: T5, T6, T7]
T9: Client — ticket-intake chat state machine hook [depends: T8]
T10: Client — chat + preview UI (floating button, ChatPanel, PreviewScreen) [depends: T9]
T11: Client — ContextPanel integration (Report issue + ticket history) [depends: T9]
T12: Client — auto-error entry point wiring [depends: T8, T9]
T13: Integration test — end-to-end ticket-intake flow [depends: T6, T7, T10, T11, T12]
T14: Integration test — SSE submit-result → chat hook → preview UI (client, Story 6) [depends: T9, T10]

---

## Pocket Packets

---

### Task 8: Client — api.ts additions + user-initiated tagging + auto-error bus [depends: T5, T6, T7]

## OBJECTIVE
Add typed client methods for the three new server endpoints, add an opt-in `userInitiated` tagging mechanism to `request()`, and build a lightweight pub/sub bus that publishes when a tagged call fails with 500+.

Files:
- Modify: `client/src/api.ts`
- Create: `client/src/lib/ticketIntakeBus.ts`
- Test: `client/src/lib/ticketIntakeBus.test.ts`
- Test: `client/src/api.test.ts` (create if it does not already exist, else extend)

Steps:
1. Write failing test for: the auto-error bus
   File: `client/src/lib/ticketIntakeBus.test.ts`
   Test verifies: Given a subscriber registered via `subscribeAutoError(callback)`, When `publishAutoError(detail)` is called, Then `callback` is invoked exactly once with `detail`.
   Also test: Given a subscriber unsubscribes (the function returned by `subscribeAutoError` is called), When `publishAutoError` is called again, Then the unsubscribed callback is NOT invoked.

   ```typescript
   import { describe, expect, it, vi } from "vitest";
   import { publishAutoError, subscribeAutoError } from "./ticketIntakeBus";

   describe("ticketIntakeBus", () => {
   	it("invokes a subscribed callback exactly once with the published detail", () => {
   		const callback = vi.fn();
   		subscribeAutoError(callback);

   		const detail = {
   			endpoint: "/workspaces/1/cards/5",
   			status: 500,
   			message: "Internal error",
   			timestamp: "2026-07-01T00:00:00Z",
   			userAction: "Save card",
   		};
   		publishAutoError(detail);

   		expect(callback).toHaveBeenCalledTimes(1);
   		expect(callback).toHaveBeenCalledWith(detail);
   	});

   	it("stops invoking a callback after it unsubscribes", () => {
   		const callback = vi.fn();
   		const unsubscribe = subscribeAutoError(callback);
   		unsubscribe();

   		publishAutoError({
   			endpoint: "/workspaces/1/cards/5",
   			status: 500,
   			message: "Internal error",
   			timestamp: "2026-07-01T00:00:00Z",
   			userAction: "Save card",
   		});

   		expect(callback).not.toHaveBeenCalled();
   	});
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- ticketIntakeBus.test.ts`
   Expected failure: Cannot find module `../lib/ticketIntakeBus`

3. Implement minimal code to satisfy the test:
   File: `client/src/lib/ticketIntakeBus.ts`
   Implement: `export interface AutoErrorDetail { endpoint: string; status: number; message: string; timestamp: string; userAction: string; }`, `export function publishAutoError(detail: AutoErrorDetail): void`, `export function subscribeAutoError(cb: (detail: AutoErrorDetail) => void): () => void` — a minimal in-module `Set<callback>` pub/sub, no external dependency.

4. Run test — verify PASS:
   `npm run test --workspace=client -- ticketIntakeBus.test.ts`
   Expected: PASS

5. Write failing test for: user-initiated tagging triggers the bus on 500+
   File: `client/src/api.test.ts`
   Test verifies: Given `fetch` is mocked to return a 500 response, When `api.updateCard(workspaceId, id, patch, {userInitiated: true, userAction: "Save card"})` is called (or the tagged call-site signature chosen in implementation), Then `publishAutoError` (mocked via `vi.mock("./lib/ticketIntakeBus")`) is called with `{status: 500, endpoint: <matching path>, userAction: "Save card", ...}`.
   Also test: Given the same 500 response but the call is NOT tagged `userInitiated` (e.g. a hypothetical presence heartbeat call), When it fails, Then `publishAutoError` is NOT called.
   Also test: Given a tagged call fails with a 400 (not 500+), When it fails, Then `publishAutoError` is NOT called (auto-error entry point is 500+ only per spec).

   ```typescript
   // Inserted into the existing client/src/api.test.ts, which already declares
   // `const mockFetch = vi.fn(); vi.stubGlobal("fetch", mockFetch);` at the top
   // of the file — reuse that, do not redeclare it here.
   const mockPublishAutoError = vi.fn();
   vi.mock("./lib/ticketIntakeBus", () => ({
   	publishAutoError: (...args: unknown[]) => mockPublishAutoError(...args),
   }));

   describe("user-initiated auto-error tagging", () => {
   	it("publishes an auto-error when a tagged call (updateCard) fails with 500+", async () => {
   		mockFetch.mockResolvedValueOnce({
   			ok: false,
   			status: 500,
   			json: () => Promise.resolve({ error: "Internal error" }),
   		});

   		const { api, ApiError } = await import("./api");
   		await expect(
   			api.updateCard(1, 5, { title: "New title" }),
   		).rejects.toBeInstanceOf(ApiError);

   		expect(mockPublishAutoError).toHaveBeenCalledWith(
   			expect.objectContaining({ status: 500, userAction: expect.any(String) }),
   		);
   	});

   	it("does not publish when the same 500 response comes from an untagged call", async () => {
   		mockFetch.mockResolvedValueOnce({
   			ok: false,
   			status: 500,
   			json: () => Promise.resolve({ error: "Internal error" }),
   		});

   		const { api } = await import("./api");
   		await expect(api.getBoard(1)).rejects.toThrow();

   		expect(mockPublishAutoError).not.toHaveBeenCalled();
   	});

   	it("does not publish when a tagged call fails with a 400-class error", async () => {
   		mockFetch.mockResolvedValueOnce({
   			ok: false,
   			status: 400,
   			json: () => Promise.resolve({ error: "Bad request" }),
   		});

   		const { api } = await import("./api");
   		await expect(
   			api.updateCard(1, 5, { title: "New title" }),
   		).rejects.toThrow();

   		expect(mockPublishAutoError).not.toHaveBeenCalled();
   	});
   });
   ```

6. Run test — verify FAIL:
   `npm run test --workspace=client -- api.test.ts`
   Expected failure: `publishAutoError` mock never called, or `userInitiated` option not recognized

7. Implement minimal code to satisfy the test:
   File: `client/src/api.ts`
   Implement: Extend `request<T>()`'s options with an optional `{userInitiated?: boolean; userAction?: string}` tag; in the `!res.ok` branch, if `res.status >= 500 && userInitiated`, call `publishAutoError({endpoint: path, status: res.status, message, timestamp: new Date().toISOString(), userAction: userAction ?? "Unknown action"})` before throwing `ApiError`. Tag the three call sites the spec identifies as user-initiated (Save/submit/drag-drop): `updateCard` (Save), `createCard` (submit), `moveCard` (drag-drop) — thread a `userAction` label through each. Add `ticketIntake` namespace: `sendMessage`, `submit`, `resubmit`, `getHistory` methods calling the Task 5/6/7 endpoints.

8. Run test — verify PASS:
   `npm run test --workspace=client -- api.test.ts ticketIntakeBus.test.ts`
   Expected: PASS

9. Commit:
   `git add client/src/api.ts client/src/lib/ticketIntakeBus.ts client/src/lib/ticketIntakeBus.test.ts client/src/api.test.ts`
   `git commit -m "feat(ticket-intake): add client API methods, user-initiated tagging, and auto-error bus"`

## REFERENCES LOADED
`docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md` — rule: Entry points (Story 4, all rules), Implementation Notes (opt-in tagging mechanism)
`client/src/api.ts` — existing `request<T>()` wrapper extended in place; existing method signatures (`updateCard`, `createCard`, `moveCard`) are the exact call sites to tag

## WHY THIS APPROACH
Complexity: standard
Justification: Requires judgment on which existing call sites count as "user-initiated" (Save/submit/drag-drop, explicitly named in the spec) versus which must stay untagged (SSE, polling, presence heartbeat — none of which go through `api.ts`'s tagged path anyway, since they use `EventSource`/separate calls). The bus itself is lightweight, but the tagging decision has real behavioral consequences (Story 4's negative scenario).

## SANDWICH CONTEXT
[CRITICAL: Only `updateCard`, `createCard`, and `moveCard` (Save/submit/drag-drop) get the `userInitiated` tag — background/passive calls (presence heartbeat, notification polling) MUST remain untagged, or the auto-error entry point will violate Story 4's explicit exclusion of background-triggered auto-open.]
You are implementing the client API layer additions for the Linear Ticket-Intake Chat feature.
Spec: docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md
Design decision: N/A for this task (infrastructure, not the extraction decision).
Files in scope: `client/src/api.ts`, `client/src/lib/ticketIntakeBus.ts`, and their test files. No other files.
Test framework: Vitest, run via `npm run test --workspace=client` (jsdom environment required — do not run raw `vitest` from repo root).
Available after: T5, T6, T7 (server endpoint contracts must exist for the client methods to target correct paths/shapes).
Architecture rule: bundler resolution imports on the client (no `.js` extensions).
[RESTATE: Do not tag `heartbeat`, `getPresence`, or `getNotifications` as user-initiated — those are background/passive per Story 4's explicit exclusion.]

## DELIVERABLE
Given a tagged call (Save/submit/drag-drop) fails with 500+, When the error is caught, Then `publishAutoError` fires with endpoint, status, message, timestamp, and user action
Given the same call fails with 400-class, When the error is caught, Then `publishAutoError` does NOT fire
[must-not] Given an untagged call (e.g. presence heartbeat) fails with 500+, Then `publishAutoError` must NOT fire — background/passive calls never trigger auto-open (Story 4 Rule 1)
Given a subscriber unsubscribes from the bus, When a new error publishes, Then that subscriber's callback is not invoked

All tests PASS. Commit exists with message matching `feat(ticket-intake): add client API methods, user-initiated tagging, and auto-error bus`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Exactly `updateCard`, `createCard`, `moveCard` tagged user-initiated — no more, no fewer
  - `publishAutoError` fires only on `status >= 500 && userInitiated === true`
  - Tests run via `npm run test --workspace=client` (jsdom), not raw vitest from root
  - Tests written BEFORE implementation

Must-not-have:
  - Tagging `heartbeat`, `getPresence`, `getNotifications`, or any SSE-related call as user-initiated
  - Firing the bus on 400-class errors regardless of tagging

Open question risks:
  - None specific to this task

Rollback note:
  - Entry points independently removable from the client without touching server logic, per spec's Rollback Plan.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: none identified
Escalate when: a background/passive call site appears to need tagging to satisfy a test — that would violate Story 4 Rule 1

---

### Task 9: Client — ticket-intake chat state machine hook [depends: T8]

## OBJECTIVE
Build `useTicketIntakeChat`, the hook that owns turn history, draft state, fast/guided path branching, preview-readiness gating, and submit lifecycle (including consuming the new SSE result event).

Files:
- Create: `client/src/hooks/useTicketIntakeChat.ts`
- Modify: `client/src/context/BoardContext.tsx`
- Test: `client/src/hooks/useTicketIntakeChat.test.ts`

Steps:
1. Write failing test for: turn flow and preview gating
   File: `client/src/hooks/useTicketIntakeChat.test.ts`
   Test verifies: Given the hook is initialized for the "global" entry variant, When `sendMessage("detailed bug report...")` resolves with `{ready: false, question: "bug or feature?"}` (mocked `api.ticketIntake.sendMessage`), Then the hook's state exposes that question and `previewReady: false`.
   Also test: Given the next `sendMessage("bug")` resolves with `{ready: true, draft: {title, description, type: "Bug"}}`, Then the hook's state exposes `previewReady: true` and the draft fields, matching Story 1's fast path.
   Also test: Given the hook is initialized for the "auto-error" variant with a prefilled error draft, Then the hook skips the classifier turn entirely and starts already in a state equivalent to `ready: true` with `type: "Bug"` pre-set — Story 4 Rule 3 still requires this to land in the preview state, NOT auto-submit.

   ```typescript
   // @vitest-environment jsdom
   import { renderHook, waitFor } from "@testing-library/react";
   import { beforeEach, describe, expect, it, vi } from "vitest";

   const mockSendMessage = vi.fn();
   vi.mock("../api", () => ({
   	api: {
   		ticketIntake: {
   			sendMessage: (...args: unknown[]) => mockSendMessage(...args),
   		},
   	},
   }));

   describe("useTicketIntakeChat — turn flow and preview gating", () => {
   	beforeEach(() => {
   		mockSendMessage.mockReset();
   	});

   	it("exposes the classifier question and previewReady:false while ready:false", async () => {
   		mockSendMessage.mockResolvedValueOnce({
   			ready: false,
   			question: "bug or feature?",
   		});
   		const { useTicketIntakeChat } = await import("./useTicketIntakeChat");
   		const { result } = renderHook(() =>
   			useTicketIntakeChat({ workspaceId: 1, variant: "global" }),
   		);

   		await result.current.sendMessage("detailed bug report with repro steps");

   		await waitFor(() => {
   			expect(result.current.previewReady).toBe(false);
   		});
   		expect(
   			result.current.messages.some((m) => m.content === "bug or feature?"),
   		).toBe(true);
   	});

   	it("exposes previewReady:true and the draft once the extraction is ready (fast path)", async () => {
   		mockSendMessage
   			.mockResolvedValueOnce({ ready: false, question: "bug or feature?" })
   			.mockResolvedValueOnce({
   				ready: true,
   				draft: { title: "Drag-drop breaks", description: "...", type: "Bug" },
   			});
   		const { useTicketIntakeChat } = await import("./useTicketIntakeChat");
   		const { result } = renderHook(() =>
   			useTicketIntakeChat({ workspaceId: 1, variant: "global" }),
   		);

   		await result.current.sendMessage("detailed bug report with repro steps");
   		await result.current.sendMessage("bug");

   		await waitFor(() => {
   			expect(result.current.previewReady).toBe(true);
   		});
   		expect(result.current.draft?.title).toBe("Drag-drop breaks");
   		expect(result.current.draft?.type).toBe("Bug");
   	});

   	it("skips the classifier turn and pre-sets type:Bug for the autoError variant, without auto-submitting", async () => {
   		const { useTicketIntakeChat } = await import("./useTicketIntakeChat");
   		const { result } = renderHook(() =>
   			useTicketIntakeChat({
   				workspaceId: 1,
   				variant: "autoError",
   				prefill: {
   					errorDetail: {
   						endpoint: "/workspaces/1/cards/5",
   						status: 500,
   						message: "Internal error",
   						timestamp: "2026-07-01T00:00:00Z",
   						userAction: "Save card",
   					},
   				},
   			}),
   		);

   		expect(mockSendMessage).not.toHaveBeenCalled();
   		expect(result.current.previewReady).toBe(true);
   		expect(result.current.draft?.type).toBe("Bug");
   		expect(result.current.submitState.status).not.toBe("success");
   		expect(result.current.submitState.status).not.toBe("submitting");
   	});
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- useTicketIntakeChat.test.ts`
   Expected failure: Cannot find module `../hooks/useTicketIntakeChat`

3. Implement minimal code to satisfy the test:
   File: `client/src/hooks/useTicketIntakeChat.ts`
   Implement: `export function useTicketIntakeChat(config: {workspaceId: number | null; variant: "global" | "card" | "autoError"; prefill?: {title?: string; description?: string; cardId?: number; errorDetail?: AutoErrorDetail}})` returning `{messages, sendMessage, previewReady, draft, submitState, confirm, editDraft, resubmit}`. On `variant === "autoError"`, initializes with `type: "Bug"` and skips the turn-1 classifier call, but `previewReady` still requires an explicit user path through the preview screen (never auto-confirms).

4. Run test — verify PASS:
   `npm run test --workspace=client -- useTicketIntakeChat.test.ts`
   Expected: PASS

5. Write failing test for: SSE-driven submit result consumption
   File: `client/src/hooks/useTicketIntakeChat.test.ts`
   Test verifies: Given `confirm()` was called (mocked `api.ticketIntake.submit` resolving with `202`), When a `ticket_intake.submit_result` event with `{success: true, issueUrl, issueIdentifier}` arrives via the hook's SSE-event input (fed from `BoardContext`'s new event queue, injected as a prop/param for testability), Then `submitState` transitions to `{status: "success", issueUrl, issueIdentifier}`.
   Also test: Given a `ticket_intake.submit_result` event arrives with `{success: false, retryable: true}`, Then `submitState` transitions to `{status: "graceful_failure"}` and `resubmit()` becomes callable.
   Also test: Given `confirm()` is called and the mocked `api.ticketIntake.submit` rejects with an `ApiError(status: 409)`, When the hook catches it, Then `submitState` transitions to `{status: "rate_limited"}` (not `"submitting"` or an unhandled throw) — this is the client-side surface of Story 7 Rule 1's "tombol submit disabled" requirement.

   ```typescript
   // @vitest-environment jsdom
   import { act, renderHook, waitFor } from "@testing-library/react";
   import { beforeEach, describe, expect, it, vi } from "vitest";

   const mockSubmit = vi.fn();
   vi.mock("../api", () => ({
   	ApiError: class ApiError extends Error {
   		status: number;
   		constructor(message: string, status: number) {
   			super(message);
   			this.status = status;
   		}
   	},
   	api: {
   		ticketIntake: {
   			sendMessage: vi.fn(),
   			submit: (...args: unknown[]) => mockSubmit(...args),
   		},
   	},
   }));

   describe("useTicketIntakeChat — SSE submit-result consumption", () => {
   	beforeEach(() => {
   		mockSubmit.mockReset();
   	});

   	it("transitions submitState to success when a matching submit_result event arrives", async () => {
   		mockSubmit.mockResolvedValueOnce({ status: "submitting" });
   		const { useTicketIntakeChat } = await import("./useTicketIntakeChat");
   		const { result, rerender } = renderHook(
   			({ events }: { events: unknown[] }) =>
   				useTicketIntakeChat({
   					workspaceId: 1,
   					variant: "global",
   					ticketIntakeEvents: events,
   				}),
   			{ initialProps: { events: [] as unknown[] } },
   		);

   		await act(async () => {
   			await result.current.confirm();
   		});

   		rerender({
   			events: [
   				{
   					type: "ticket_intake.submit_result",
   					success: true,
   					issueUrl: "https://linear.app/cam/issue/CAM-1",
   					issueIdentifier: "CAM-1",
   				},
   			],
   		});

   		await waitFor(() => {
   			expect(result.current.submitState.status).toBe("success");
   		});
   		expect(result.current.submitState).toMatchObject({
   			status: "success",
   			issueUrl: "https://linear.app/cam/issue/CAM-1",
   		});
   	});

   	it("transitions submitState to graceful_failure and makes resubmit callable", async () => {
   		mockSubmit.mockResolvedValueOnce({ status: "submitting" });
   		const { useTicketIntakeChat } = await import("./useTicketIntakeChat");
   		const { result, rerender } = renderHook(
   			({ events }: { events: unknown[] }) =>
   				useTicketIntakeChat({
   					workspaceId: 1,
   					variant: "global",
   					ticketIntakeEvents: events,
   				}),
   			{ initialProps: { events: [] as unknown[] } },
   		);

   		await act(async () => {
   			await result.current.confirm();
   		});

   		rerender({
   			events: [
   				{
   					type: "ticket_intake.submit_result",
   					success: false,
   					retryable: true,
   				},
   			],
   		});

   		await waitFor(() => {
   			expect(result.current.submitState.status).toBe("graceful_failure");
   		});
   		expect(typeof result.current.resubmit).toBe("function");
   	});

   	it("transitions submitState to rate_limited when confirm() catches a 409 ApiError", async () => {
   		const { ApiError } = await import("../api");
   		mockSubmit.mockRejectedValueOnce(new ApiError("Rate limited", 409));
   		const { useTicketIntakeChat } = await import("./useTicketIntakeChat");
   		const { result } = renderHook(() =>
   			useTicketIntakeChat({ workspaceId: 1, variant: "global" }),
   		);

   		await act(async () => {
   			await result.current.confirm();
   		});

   		expect(result.current.submitState.status).toBe("rate_limited");
   	});
   });
   ```

6. Run test — verify FAIL:
   `npm run test --workspace=client -- useTicketIntakeChat.test.ts`
   Expected failure: `submitState` never transitions (no event-consumption wiring yet); the 409 case throws unhandled instead of setting `rate_limited`

7. Implement minimal code to satisfy the test:
   File: `client/src/hooks/useTicketIntakeChat.ts`
   Implement: Accept a `ticketIntakeEvents: TicketIntakeResultEvent[]` param (or read from context) and a `useEffect` that watches for new events matching the in-flight submission and transitions `submitState` accordingly. In `confirm()`, wrap the `api.ticketIntake.submit` call in try/catch — on `ApiError` with `status === 409`, set `submitState` to `{status: "rate_limited"}` synchronously (no need to wait for an SSE event, since the 409 means the background job never started).
   File: `client/src/context/BoardContext.tsx`
   Implement: In the SSE `stream.onmessage` handler, add a branch mirroring the existing `data.type.startsWith("agent.")` pattern: `if (typeof data.type === "string" && data.type === "ticket_intake.submit_result") { setTicketIntakeEvents((prev) => [...prev, data as TicketIntakeResultEvent]); return; }`. Expose `ticketIntakeEvents` on the context value.

8. Run test — verify PASS:
   `npm run test --workspace=client -- useTicketIntakeChat.test.ts`
   Expected: PASS

9. Commit:
   `git add client/src/hooks/useTicketIntakeChat.ts client/src/context/BoardContext.tsx client/src/hooks/useTicketIntakeChat.test.ts`
   `git commit -m "feat(ticket-intake): add chat state machine hook with SSE submit-result consumption"`

## REFERENCES LOADED
`docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md` — rule: Story 1, 2 (adaptive chat), Story 4 Rule 3 (auto-error still requires preview+confirm), Story 5, Story 6
`client/src/hooks/useAgentChat.ts` — precedent for a chat-owning hook pattern in this codebase (queue/reducer shape), used as a structural reference though ticket-intake's turn model is simpler (no token streaming, single request/response per turn)
`client/src/context/BoardContext.tsx` — existing `agent.*` prefix-dispatch in the SSE handler, copied for the new `ticket_intake.submit_result` type

## WHY THIS APPROACH
Complexity: standard
Justification: This hook is the most stateful piece of client logic in the feature — it must reconcile three entry-point variants, two adaptive paths, and an async SSE-driven submit lifecycle into one coherent state shape. Multi-file coordination (hook + context) with real judgment calls (event correlation, variant-specific initialization).

## SANDWICH CONTEXT
[CRITICAL: Even on the `autoError` variant, the hook MUST land in a state that still requires an explicit user `confirm()` call before submission — auto-open must never auto-submit (Story 4 Rule 3, this is a `[must-not]` acceptance criterion).]
You are implementing the ticket-intake chat state machine hook for the Linear Ticket-Intake Chat feature.
Spec: docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md
Design decision: Option B (extraction/completeness) drives what `sendMessage` returns; this hook consumes that contract.
Files in scope: `client/src/hooks/useTicketIntakeChat.ts`, `client/src/context/BoardContext.tsx` (SSE dispatch branch + exposed event queue only — do not modify unrelated BoardContext logic), and the hook's test file. No other files.
Test framework: Vitest + `@testing-library/react` (`renderHook` or equivalent), run via `npm run test --workspace=client`.
Available after: T8 (api.ts methods + bus).
Architecture rule: bundler resolution imports (no `.js` extensions) on the client.
[RESTATE: Auto-error variant still requires explicit confirm — never auto-submits.]

## DELIVERABLE
Given detailed input and classifier answered, When the hook processes the turn, Then `previewReady: true` with the draft populated (Story 1 fast path)
Given vague input, When the hook processes the turn, Then `previewReady: false` with a specific clarifying question (Story 2 guided path)
Given the auto-error variant, When the hook initializes, Then the classifier turn is skipped and `type: "Bug"` is pre-set
[must-not] Given the auto-error variant, Then the hook must NOT set `submitState` to anything resembling a submitted/confirmed state without an explicit `confirm()` call
Given a `ticket_intake.submit_result` success event arrives, When the hook observes it, Then `submitState` becomes `{status: "success", ...}`
Given a `ticket_intake.submit_result` graceful-failure event arrives, When the hook observes it, Then `submitState` becomes `{status: "graceful_failure"}` and `resubmit` is callable
Given `confirm()` receives a 409 from the submit call, When the hook catches it, Then `submitState` becomes `{status: "rate_limited"}` — the client-side counterpart to Story 7 Rule 1's server-side 409 rejection

All tests PASS. Commit exists with message matching `feat(ticket-intake): add chat state machine hook with SSE submit-result consumption`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Auto-error variant never bypasses the explicit confirm step
  - SSE event consumption correctly correlates the result to the in-flight submission (not a blind "any event = my result")
  - A 409 from `confirm()` is caught and reflected in `submitState`, never left as an unhandled rejection
  - Tests run via `npm run test --workspace=client`

Must-not-have:
  - Auto-submit on any variant
  - Unrelated changes to `BoardContext.tsx` beyond the SSE dispatch branch and event queue exposure

Open question risks:
  - None specific to this task

Rollback note:
  - Entry points independently removable from the client per spec's Rollback Plan.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: none identified
Escalate when: a test appears to require auto-submission on the auto-error path

---

### Task 10: Client — chat + preview UI (floating button, ChatPanel, PreviewScreen) [depends: T9]

## OBJECTIVE
Build the visible chat UI: the global floating button (gated on `activeWorkspaceId`), the turn-based chat panel, and the preview screen with editable title/description, read-only type badge, and confirm-blocked-on-empty-title.

Files:
- Create: `client/src/components/ticketIntake/FloatingChatButton.tsx`
- Create: `client/src/components/ticketIntake/ChatPanel.tsx`
- Create: `client/src/components/ticketIntake/PreviewScreen.tsx`
- Modify: `client/src/layout/AppLayout.tsx`
- Test: `client/src/components/ticketIntake/FloatingChatButton.test.tsx`
- Test: `client/src/components/ticketIntake/ChatPanel.test.tsx`
- Test: `client/src/components/ticketIntake/PreviewScreen.test.tsx`

Steps:

> **TDD-order correction (test-architect pass):** the original draft of this
> task ran a combined "verify PASS: FloatingChatButton + ChatPanel + PreviewScreen"
> step (old step 9) *before* `PreviewScreen.tsx` was implemented (old step 10) —
> an inversion. Steps below are renumbered so PreviewScreen's test is written,
> verified FAIL, THEN implemented, THEN verified PASS, matching every other
> task's order.

1. Write failing test for: floating button workspace gating
   File: `client/src/components/ticketIntake/FloatingChatButton.test.tsx`
   Test verifies: Given `activeWorkspaceId` is `null` (via a mocked `useBoard()`), When `<FloatingChatButton />` renders, Then it renders nothing (or a disabled/hidden state — not a clickable button) (Story 9).
   Also test: Given `activeWorkspaceId` is a number, When it renders, Then a clickable button is present using the Button Primary token (`bg-primary-600`, per `docs/pocket/rule/creative-brief.md`).

   ```tsx
   // @vitest-environment jsdom
   import { render, screen } from "@testing-library/react";
   import { describe, expect, it, vi } from "vitest";

   const mockUseBoard = vi.fn();
   vi.mock("../../context/BoardContext", () => ({
   	useBoard: () => mockUseBoard(),
   }));
   vi.mock("../../hooks/useTicketIntakeChat", () => ({
   	useTicketIntakeChat: () => ({ open: vi.fn() }),
   }));

   import { FloatingChatButton } from "./FloatingChatButton";

   describe("FloatingChatButton", () => {
   	it("renders nothing when activeWorkspaceId is null", () => {
   		mockUseBoard.mockReturnValue({ activeWorkspaceId: null });
   		const { container } = render(<FloatingChatButton />);
   		expect(container).toBeEmptyDOMElement();
   	});

   	it("renders a clickable Button Primary token button when a workspace is active", () => {
   		mockUseBoard.mockReturnValue({ activeWorkspaceId: 1 });
   		render(<FloatingChatButton />);
   		const button = screen.getByRole("button");
   		expect(button).toBeInTheDocument();
   		expect(button.className).toMatch(/bg-primary-600/);
   	});
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- FloatingChatButton.test.tsx`
   Expected failure: Cannot find module `./FloatingChatButton`

3. Implement minimal code to satisfy the test:
   File: `client/src/components/ticketIntake/FloatingChatButton.tsx`
   Implement: Reads `activeWorkspaceId` from `useBoard()`; returns `null` when it's `null`; otherwise renders a fixed-position button with `bg-primary-600 hover:bg-primary-700` classes (Button Primary token from the creative brief) that opens the chat panel via `useTicketIntakeChat`'s "global" variant.

4. Run test — verify PASS:
   `npm run test --workspace=client -- FloatingChatButton.test.tsx`
   Expected: PASS

5. Write failing test for: chat panel turn UI
   File: `client/src/components/ticketIntake/ChatPanel.test.tsx`
   Test verifies: Given the hook returns a classifier question, When `<ChatPanel />` renders, Then the question text is visible and an input is present for the user's reply.
   Also test: Given `previewReady: true` (mocked hook state), When `<ChatPanel />` renders, Then it renders `<PreviewScreen />` instead of the message input.

   ```tsx
   // @vitest-environment jsdom
   import { render, screen } from "@testing-library/react";
   import { describe, expect, it, vi } from "vitest";

   const mockUseTicketIntakeChat = vi.fn();
   vi.mock("../../hooks/useTicketIntakeChat", () => ({
   	useTicketIntakeChat: () => mockUseTicketIntakeChat(),
   }));
   vi.mock("./PreviewScreen", () => ({
   	PreviewScreen: () => <div data-testid="preview-screen" />,
   }));

   import { ChatPanel } from "./ChatPanel";

   describe("ChatPanel", () => {
   	it("shows the classifier question and a reply input while previewReady is false", () => {
   		mockUseTicketIntakeChat.mockReturnValue({
   			messages: [{ role: "assistant", content: "bug or feature?" }],
   			previewReady: false,
   			sendMessage: vi.fn(),
   			draft: null,
   			confirm: vi.fn(),
   			editDraft: vi.fn(),
   			submitState: { status: "idle" },
   			resubmit: vi.fn(),
   		});
   		render(<ChatPanel />);
   		expect(screen.getByText("bug or feature?")).toBeInTheDocument();
   		expect(screen.getByRole("textbox")).toBeInTheDocument();
   	});

   	it("renders PreviewScreen instead of the message input once previewReady is true", () => {
   		mockUseTicketIntakeChat.mockReturnValue({
   			messages: [],
   			previewReady: true,
   			sendMessage: vi.fn(),
   			draft: { title: "t", description: "d", type: "Bug" },
   			confirm: vi.fn(),
   			editDraft: vi.fn(),
   			submitState: { status: "idle" },
   			resubmit: vi.fn(),
   		});
   		render(<ChatPanel />);
   		expect(screen.getByTestId("preview-screen")).toBeInTheDocument();
   		expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
   	});
   });
   ```

6. Run test — verify FAIL:
   `npm run test --workspace=client -- ChatPanel.test.tsx`
   Expected failure: Cannot find module `./ChatPanel`

7. Implement minimal code to satisfy the test:
   File: `client/src/components/ticketIntake/ChatPanel.tsx`
   Implement: Consumes `useTicketIntakeChat`; renders message history + input while `!previewReady`; renders `<PreviewScreen draft={draft} onConfirm={confirm} onEdit={editDraft} />` once `previewReady`. Chat-message input disabled while the Task 4 chat rate limit reports locked (surfaced via the hook/API 429 response).

8. Run test — verify PASS:
   `npm run test --workspace=client -- FloatingChatButton.test.tsx ChatPanel.test.tsx`
   Expected: PASS

9. Write failing test for: preview screen inline edit, confirm-blocked-on-empty-title, read-only type badge
   File: `client/src/components/ticketIntake/PreviewScreen.test.tsx`
   Test verifies: Given a draft with a non-empty title, When the user clears the title input and the confirm button is present, Then the confirm button is `disabled` (Story 5 Rule 2).
   Also test: Given the user edits the description field and clicks confirm, Then `onConfirm` is called with the edited text, not the original AI draft text (Story 5 Rule 1).
   Also test: Given the draft has `type: "Bug"`, Then the type badge renders read-only text "Bug" with no interactive override control (Story 5 Rule 1, negative case).

   ```tsx
   // @vitest-environment jsdom
   import { fireEvent, render, screen } from "@testing-library/react";
   import { describe, expect, it, vi } from "vitest";

   import { PreviewScreen } from "./PreviewScreen";

   describe("PreviewScreen — edit, confirm-blocked, read-only type badge", () => {
   	it("disables the confirm button when the title is cleared", () => {
   		const onConfirm = vi.fn();
   		render(
   			<PreviewScreen
   				draft={{ title: "Drag-drop breaks", description: "desc", type: "Bug" }}
   				onConfirm={onConfirm}
   				submitState={{ status: "idle" }}
   			/>,
   		);
   		fireEvent.change(screen.getByLabelText(/title/i), {
   			target: { value: "" },
   		});
   		expect(screen.getByRole("button", { name: /confirm/i })).toBeDisabled();
   	});

   	it("submits the edited description text, not the original AI draft", () => {
   		const onConfirm = vi.fn();
   		render(
   			<PreviewScreen
   				draft={{ title: "Drag-drop breaks", description: "original", type: "Bug" }}
   				onConfirm={onConfirm}
   				submitState={{ status: "idle" }}
   			/>,
   		);
   		fireEvent.change(screen.getByLabelText(/description/i), {
   			target: { value: "edited description" },
   		});
   		fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
   		expect(onConfirm).toHaveBeenCalledWith(
   			expect.objectContaining({ description: "edited description" }),
   		);
   	});

   	it("renders the type badge as read-only text with no override control", () => {
   		render(
   			<PreviewScreen
   				draft={{ title: "t", description: "d", type: "Bug" }}
   				onConfirm={vi.fn()}
   				submitState={{ status: "idle" }}
   			/>,
   		);
   		expect(screen.getByText("Bug")).toBeInTheDocument();
   		expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
   		expect(
   			screen.queryByRole("button", { name: /bug/i }),
   		).not.toBeInTheDocument();
   	});
   });
   ```

10. Run test — verify FAIL:
    `npm run test --workspace=client -- PreviewScreen.test.tsx`
    Expected failure: Cannot find module `./PreviewScreen`

11. Implement:
    File: `client/src/components/ticketIntake/PreviewScreen.tsx`
    Implement: Editable `title`/`description` text inputs bound to local state initialized from `draft`; a read-only type badge (plain text/span, not a select/button); confirm button `disabled={title.trim() === "" || submitState.status === "submitting"}`; on confirm, calls `onConfirm({title, description})` (the edited values, not the original draft).
    File: `client/src/layout/AppLayout.tsx`
    Implement: Mount `<FloatingChatButton />` inside the layout (position/z-index 9999 as a one-off local value per spec's Implementation Notes — not promoted to a creative-brief token).

12. Run test — verify PASS:
    `npm run test --workspace=client -- FloatingChatButton.test.tsx ChatPanel.test.tsx PreviewScreen.test.tsx`
    Expected: PASS

13. Write failing test for: submit lifecycle rendering (success / graceful failure + resubmit / rate-limited)
    File: `client/src/components/ticketIntake/PreviewScreen.test.tsx`
    Test verifies: Given `submitState: {status: "submitting"}` (mocked hook state), When `<PreviewScreen />` renders, Then a non-interactive "Submitting…" indicator is shown and the confirm button is disabled (prevents double-submit while the background retry loop runs).
    Also test: Given `submitState: {status: "success", issueUrl, issueIdentifier}`, When it renders, Then a success message is shown containing the issue identifier/link — this is Story 5's "issueCreate sukses, commentCreate gagal → user melihat status sukses" surface: the UI only reads `submitState.status`, so a comment-create failure (which Task 6 deliberately never flips to `success: false`) still renders success here.
    Also test: Given `submitState: {status: "graceful_failure"}`, When it renders, Then a graceful error message is shown (NOT a success message) alongside a "Resubmit" button that calls `onResubmit` (wired to the hook's `resubmit()`) — Story 6's "graceful error message, BUKAN pesan sukses… tombol resubmit muncul".
    Also test: Given `submitState: {status: "rate_limited"}`, When it renders, Then the confirm button is disabled and a message indicates the user must wait before submitting again (Story 7 Rule 1's client-side surface).

   ```tsx
   // @vitest-environment jsdom
   import { render, screen } from "@testing-library/react";
   import { describe, expect, it, vi } from "vitest";

   import { PreviewScreen } from "./PreviewScreen";

   const baseDraft = { title: "t", description: "d", type: "Bug" as const };

   describe("PreviewScreen — submit lifecycle rendering", () => {
   	it("disables confirm and shows a submitting indicator while status is submitting", () => {
   		render(
   			<PreviewScreen
   				draft={baseDraft}
   				onConfirm={vi.fn()}
   				submitState={{ status: "submitting" }}
   			/>,
   		);
   		expect(screen.getByRole("button", { name: /confirm/i })).toBeDisabled();
   		expect(screen.getByText(/submitting/i)).toBeInTheDocument();
   	});

   	it("shows a success message with the issue identifier when status is success", () => {
   		render(
   			<PreviewScreen
   				draft={baseDraft}
   				onConfirm={vi.fn()}
   				submitState={{
   					status: "success",
   					issueUrl: "https://linear.app/cam/issue/CAM-1",
   					issueIdentifier: "CAM-1",
   				}}
   			/>,
   		);
   		expect(screen.getByText(/CAM-1/)).toBeInTheDocument();
   	});

   	it("shows a graceful error and a working Resubmit button when status is graceful_failure", () => {
   		const onResubmit = vi.fn();
   		render(
   			<PreviewScreen
   				draft={baseDraft}
   				onConfirm={vi.fn()}
   				onResubmit={onResubmit}
   				submitState={{ status: "graceful_failure" }}
   			/>,
   		);
   		expect(screen.queryByText(/success/i)).not.toBeInTheDocument();
   		const resubmitButton = screen.getByRole("button", { name: /resubmit/i });
   		resubmitButton.click();
   		expect(onResubmit).toHaveBeenCalled();
   	});

   	it("disables confirm and shows a wait message when status is rate_limited", () => {
   		render(
   			<PreviewScreen
   				draft={baseDraft}
   				onConfirm={vi.fn()}
   				submitState={{ status: "rate_limited" }}
   			/>,
   		);
   		expect(screen.getByRole("button", { name: /confirm/i })).toBeDisabled();
   		expect(screen.getByText(/again/i)).toBeInTheDocument();
   	});
   });
   ```

14. Run test — verify FAIL:
    `npm run test --workspace=client -- PreviewScreen.test.tsx`
    Expected failure: No submit-lifecycle rendering branch exists yet — `submitState.status` values other than the default are ignored

15. Implement minimal code to satisfy the test:
    File: `client/src/components/ticketIntake/PreviewScreen.tsx`
    Implement: Branch on `submitState.status`: `"submitting"` → disable confirm + show inline indicator; `"success"` → replace the editable form with a success message (issue link/identifier); `"graceful_failure"` → show an error message plus a "Resubmit" button calling the `onResubmit` prop; `"rate_limited"` → disable confirm + show a "you can submit again shortly" message. Default/`undefined` status renders the normal editable form as before.

16. Run test — verify PASS:
    `npm run test --workspace=client -- ticketIntake`
    Expected: PASS

17. Commit:
    `git add client/src/components/ticketIntake/FloatingChatButton.tsx client/src/components/ticketIntake/ChatPanel.tsx client/src/components/ticketIntake/PreviewScreen.tsx client/src/layout/AppLayout.tsx client/src/components/ticketIntake/FloatingChatButton.test.tsx client/src/components/ticketIntake/ChatPanel.test.tsx client/src/components/ticketIntake/PreviewScreen.test.tsx`
    `git commit -m "feat(ticket-intake): add floating chat button, chat panel, and preview screen"`

## REFERENCES LOADED
`docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md` — rule: Story 1, 2, 5 (all rules), Story 9 Rule 1 (global entry point gating)
`docs/pocket/rule/creative-brief.md` — Button Primary token (`primary-600` default, `primary-700` hover, `0 1px 2px rgba(0,0,0,0.1)` shadow) reused as-is for the floating button; confirmed no new floating/z-index/overlay tokens are being added, per spec's Implementation Notes
`client/src/components/ContextPanel.tsx` — existing `inputClass` Tailwind string and button styling conventions used as the visual baseline for the preview screen's inputs

## WHY THIS APPROACH
Complexity: standard
Justification: Three new components with real UI judgment (workspace gating, adaptive turn rendering, edit-before-confirm state, disabled-when-empty), all needing to match the creative brief's exact token values — not a mechanical scaffold.

## SANDWICH CONTEXT
[CRITICAL: All new UI (button, panel, preview) MUST use only the OKLCH tokens already defined in `docs/pocket/rule/creative-brief.md` (e.g. `primary-600`/`primary-700` for the Button Primary state) — no new colors, spacing, or typography values invented for this feature, per the project's brand-design rule.]
You are implementing the chat and preview UI components for the Linear Ticket-Intake Chat feature.
Spec: docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md
Design decision: N/A directly (this task renders Task 9's hook state), but the type badge's read-only rendering directly encodes the spec's "full-AI classification only" out-of-scope rule.
Files in scope: `client/src/components/ticketIntake/FloatingChatButton.tsx`, `ChatPanel.tsx`, `PreviewScreen.tsx`, `client/src/layout/AppLayout.tsx` (mount line only), and their test files. No other files.
Test framework: Vitest + `@testing-library/react`, run via `npm run test --workspace=client`.
Available after: T9 (chat state machine hook).
Architecture rule: bundler resolution imports (no `.js` extensions); OKLCH tokens from `creative-brief.md` for every new UI element.
[RESTATE: No new design tokens — reuse `primary-600`/`primary-700` and existing spacing/typography scale exactly as documented.]

## DELIVERABLE
Given `activeWorkspaceId` is null, When the app renders, Then the floating chat button does not appear (Story 9)
Given `activeWorkspaceId` is set, When the app renders, Then the floating button appears using the Button Primary token
Given the AI asks a classifier or clarifying question, When the chat panel renders, Then the question and a reply input are visible
Given `previewReady: true`, When the chat panel renders, Then the preview screen replaces the message input
Given the preview title is cleared, When the user attempts confirm, Then the confirm button is disabled and no request is sent (Story 5 Rule 2)
Given the user edits the description in preview, When they confirm, Then the edited text (not the AI's original draft) is what gets submitted (Story 5 Rule 1)
[must-not] Given the preview screen renders, Then the type badge must NOT expose any control to change the type — read-only text only
Given `submitState.status === "submitting"`, When the preview renders, Then the confirm button is disabled and a submitting indicator is shown (prevents double-submit)
Given `submitState.status === "success"`, When the preview renders, Then a success message with the issue link/identifier is shown — this holds even when the underlying `commentCreate` call failed server-side, since the UI only reads `submitState.status` (Story 5's "issueCreate sukses, commentCreate gagal → user melihat status sukses")
[must-not] Given all 10 retries failed (`submitState.status === "graceful_failure"`), Then the preview must NOT show a success message — it shows a graceful error plus a "Resubmit" button that calls the hook's `resubmit()` (Story 6)
Given `submitState.status === "rate_limited"` (the client-side surface of a 409 from Task 9), When the preview renders, Then the confirm button is disabled and a wait message is shown (Story 7 Rule 1)

All tests PASS. Commit exists with message matching `feat(ticket-intake): add floating chat button, chat panel, and preview screen`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Floating button hidden entirely (not just disabled) when `activeWorkspaceId` is null
  - Confirm button disabled exactly when title is empty/whitespace-only, OR `submitState.status` is `"submitting"` or `"rate_limited"`
  - Type badge is read-only, no override affordance anywhere in the DOM
  - Only creative-brief OKLCH tokens used — no new hex/rgb/arbitrary colors
  - `submitState.status === "graceful_failure"` never renders alongside a success message, and always exposes a working "Resubmit" button

Must-not-have:
  - Any manual type-override control (out of scope per spec)
  - New design tokens added to `creative-brief.md` (z-index 9999 stays a local one-off value)
  - Rendering a success message when `submitState.status` is `"graceful_failure"` or vice versa

Open question risks:
  - None specific to this task

Rollback note:
  - Floating button independently removable from the client without touching server logic, per spec's Rollback Plan.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: none identified
Escalate when: a design decision requires a token not already present in `creative-brief.md` — stop and consult the brief/user rather than inventing one

---

### Task 11: Client — ContextPanel integration (Report issue + ticket history) [depends: T9]

## OBJECTIVE
Add the "Report issue" action to `ContextPanel` (prefilled with card title + description + link back to the card) and the per-card ticket history section (snapshot list + empty state).

Files:
- Modify: `client/src/components/ContextPanel.tsx`
- Test: `client/src/components/ContextPanel.test.tsx`

Steps:
1. Write failing test for: Report issue prefill
   File: `client/src/components/ContextPanel.test.tsx`
   Test verifies: Given `ContextPanel` is open for card "Fix login redirect", When the user clicks "Report issue", Then `useTicketIntakeChat` (mocked) is invoked with the "card" variant and a prefill containing the card's title, description, and a link back to the card (e.g. `/board/card/{id}`).

   ```tsx
   // Inserted into the existing client/src/components/ContextPanel.test.tsx,
   // which already declares `mockUseBoard`, `makeCard`, `columnsWith`,
   // `setBoard`, and the mocked `../api` (getWorkspaceMembers/getCardActivity)
   // at the top of the file — reuse those, do not redeclare them here.
   const mockOpen = vi.fn();
   vi.mock("../hooks/useTicketIntakeChat", () => ({
   	useTicketIntakeChat: () => ({ open: mockOpen }),
   }));

   describe("ContextPanel — Report issue prefill", () => {
   	beforeEach(() => {
   		mockOpen.mockReset();
   	});

   	it("opens the card-variant chat prefilled with title, description, and a link back to the card", () => {
   		setBoard(
   			makeCard({
   				id: 1,
   				title: "Fix login redirect",
   				description: "Redirect loops on logout",
   			}),
   		);
   		render(<ContextPanel />);

   		fireEvent.click(screen.getByRole("button", { name: /report issue/i }));

   		expect(mockOpen).toHaveBeenCalledWith(
   			expect.objectContaining({
   				variant: "card",
   				prefill: expect.objectContaining({
   					title: "Fix login redirect",
   					description: "Redirect loops on logout",
   					cardId: 1,
   				}),
   			}),
   		);
   	});
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- ContextPanel.test.tsx`
   Expected failure: No "Report issue" button found in the rendered output

3. Implement minimal code to satisfy the test:
   File: `client/src/components/ContextPanel.tsx`
   Implement: Add a "Report issue" button in the card details section that calls `useTicketIntakeChat`'s open function with `variant: "card"` and `prefill: {title: card.title, description: card.description, cardId: card.id}`, matching the existing button styling conventions already used in `DetailsSection` (e.g. the `inputClass`/button classes already in the file).

4. Run test — verify PASS:
   `npm run test --workspace=client -- ContextPanel.test.tsx`
   Expected: PASS

5. Write failing test for: ticket history section
   File: `client/src/components/ContextPanel.test.tsx`
   Test verifies: Given the mocked `api.ticketIntake.getHistory` resolves with 2 tickets, When `ContextPanel` renders for that card, Then 2 history entries are visible (title + link + relative time, matching the existing `ActivitySection`'s `formatRelativeTime` convention).
   Also test: Given `getHistory` resolves with an empty array, Then a lightweight empty state is shown instead of an empty list.

   ```tsx
   // Extend the file's existing `vi.mock("../api", ...)` factory (near the top
   // of this file) to add `ticketIntake: { getHistory: mockGetHistory }` —
   // do not add a second `vi.mock("../api", ...)` call for the same path.
   const mockGetHistory = vi.fn();

   describe("ContextPanel — ticket history section", () => {
   	beforeEach(() => {
   		mockGetHistory.mockReset();
   	});

   	it("shows 2 history entries with title, link, and relative time", async () => {
   		mockGetHistory.mockResolvedValueOnce([
   			{
   				title: "T1",
   				issueUrl: "https://linear.app/cam/issue/CAM-1",
   				createdAt: "2026-06-30T00:00:00Z",
   			},
   			{
   				title: "T2",
   				issueUrl: "https://linear.app/cam/issue/CAM-2",
   				createdAt: "2026-06-29T00:00:00Z",
   			},
   		]);
   		setBoard(makeCard({ id: 1 }));
   		render(<ContextPanel />);

   		await waitFor(() => {
   			expect(screen.getAllByRole("link", { name: /CAM-/ })).toHaveLength(2);
   		});
   	});

   	it("shows a lightweight empty state when there is no ticket history", async () => {
   		mockGetHistory.mockResolvedValueOnce([]);
   		setBoard(makeCard({ id: 1 }));
   		render(<ContextPanel />);

   		await waitFor(() => {
   			expect(screen.getByText(/no ticket/i)).toBeInTheDocument();
   		});
   	});
   });
   ```

6. Run test — verify FAIL:
   `npm run test --workspace=client -- ContextPanel.test.tsx`
   Expected failure: No history section rendered

7. Implement minimal code to satisfy the test:
   File: `client/src/components/ContextPanel.tsx`
   Implement: Add a `TicketHistorySection({cardId})` component (same file, following the existing `ActivitySection` pattern exactly: `useEffect` fetching on mount via `api.ticketIntake.getHistory(activeWorkspaceId, cardId)`, rendering a list with `formatRelativeTime`, or a muted empty-state paragraph when the array is empty — mirroring `ActivitySection`'s "No activity yet." text).

8. Run test — verify PASS:
   `npm run test --workspace=client -- ContextPanel.test.tsx`
   Expected: PASS

9. Write failing test for: Story 9 gating on the card-context entry point
   File: `client/src/components/ContextPanel.test.tsx`
   Test verifies: Given `activeWorkspaceId` is `null` (mocked `useBoard()`), When `ContextPanel` renders for a card, Then the "Report issue" button is not rendered (or is rendered disabled) — matching the gating already required of the floating button (Task 10) and the auto-error listener (Task 12), per Story 9 Rule 1's "all three entry points."

   ```tsx
   describe("ContextPanel — Report issue gated on active workspace (Story 9)", () => {
   	it("does not render the Report issue button when activeWorkspaceId is null", () => {
   		mockUseBoard.mockReturnValue({
   			activeWorkspaceId: null,
   			columns: columnsWith(makeCard({ id: 1 })),
   			saveCard: vi.fn(),
   			deleteCard: vi.fn(),
   			showToast: vi.fn(),
   			setHasUnsavedCardEdits: vi.fn(),
   		});
   		render(<ContextPanel />);
   		expect(
   			screen.queryByRole("button", { name: /report issue/i }),
   		).not.toBeInTheDocument();
   	});
   });
   ```

10. Run test — verify FAIL:
    `npm run test --workspace=client -- ContextPanel.test.tsx`
    Expected failure: "Report issue" button still renders/is clickable when `activeWorkspaceId` is null

11. Implement minimal code to satisfy the test:
    File: `client/src/components/ContextPanel.tsx`
    Implement: Guard the "Report issue" button's render (or its `onClick`) on `activeWorkspaceId !== null` — reuse the same `activeWorkspaceId` value from `useBoard()` already destructured in `DetailsSection` for the assignee-list fetch.

12. Run test — verify PASS:
    `npm run test --workspace=client -- ContextPanel.test.tsx`
    Expected: PASS

13. Commit:
   `git add client/src/components/ContextPanel.tsx client/src/components/ContextPanel.test.tsx`
   `git commit -m "feat(ticket-intake): add Report issue action and ticket history to ContextPanel"`

## REFERENCES LOADED
`docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md` — rule: Story 3 (all rules), Story 8 (all rules)
`client/src/components/ContextPanel.tsx` — `ActivitySection`'s fetch-on-mount + `formatRelativeTime` + empty-state pattern copied directly for `TicketHistorySection`; existing button styling classes reused for "Report issue"

## WHY THIS APPROACH
Complexity: standard
Justification: Two independent additions to one existing file (a new action button + a new data-fetching section) that must follow the file's established patterns exactly (React Testing Library assertions already exist for this component) — moderate judgment to integrate cleanly without disturbing existing `DetailsSection`/`ActivitySection` behavior.

## SANDWICH CONTEXT
[CRITICAL: History is per-card only — this task MUST NOT introduce a global/cross-card ticket list view (explicitly out of scope per spec).]
You are implementing the ContextPanel integration for the Linear Ticket-Intake Chat feature.
Spec: docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md
Design decision: N/A directly for this task.
Files in scope: `client/src/components/ContextPanel.tsx` and its test file only. Do not modify `DetailsSection` or `ActivitySection`'s existing behavior beyond adding the new button/section alongside them.
Test framework: Vitest + `@testing-library/react`, run via `npm run test --workspace=client`. This file already has an existing test suite — extend it, do not replace it.
Available after: T9 (chat state machine hook).
Architecture rule: OKLCH tokens from `creative-brief.md` for the new button/section.
[RESTATE: Per-card history only — no cross-card list view.]

## DELIVERABLE
Given a user opens ContextPanel for a card and clicks "Report issue", When the chat opens, Then it is prefilled with the card's title, description, and a link back to the card (Story 3 Rule 1)
Given a ticket is created from this entry point, Then (verified in Task 6/13, referenced here as context) the resulting `card_events` row carries this card's id
Given a card has 2 ticket-history events, When ContextPanel opens, Then 2 entries render with title, link, and relative time
Given a card has no ticket history, When ContextPanel opens, Then a lightweight empty state renders instead of an empty list
[must-not] Given ContextPanel renders history, Then it must NOT show tickets from other cards — per-card filter only
[must-not] Given `activeWorkspaceId` is null, Then the "Report issue" action must NOT be available — Story 9 Rule 1 applies to this entry point exactly as it does to the floating button (Task 10) and auto-error listener (Task 12)

All tests PASS. Commit exists with message matching `feat(ticket-intake): add Report issue action and ticket history to ContextPanel`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - "Report issue" prefill includes title, description, and card link
  - History section matches `ActivitySection`'s existing empty-state convention (low-visibility, not alarming)
  - Existing `ContextPanel.test.tsx` suite still passes unmodified alongside the new tests

Must-not-have:
  - A global/cross-card history view
  - Regressions to `DetailsSection` or `ActivitySection`'s existing tested behavior

Open question risks:
  - None specific to this task

Rollback note:
  - Card-context entry point independently removable from the client without touching server logic, per spec's Rollback Plan.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green (including pre-existing ContextPanel tests), commit created
Uncertain when: none identified
Escalate when: satisfying this task appears to require changing `DetailsSection`'s save/conflict logic

---

### Task 12: Client — auto-error entry point wiring [depends: T8, T9]

## OBJECTIVE
Wire the auto-error bus (Task 8) to auto-open the chat with a prefilled error draft, type forced to "Bug", classifier skipped — while still requiring explicit preview + confirm (never auto-submits), and never triggering for background/passive calls.

Files:
- Create: `client/src/components/ticketIntake/AutoErrorListener.tsx`
- Modify: `client/src/layout/AppLayout.tsx`
- Test: `client/src/components/ticketIntake/AutoErrorListener.test.tsx`

Steps:
1. Write failing test for: auto-open on tagged 500+ error
   File: `client/src/components/ticketIntake/AutoErrorListener.test.tsx`
   Test verifies: Given `subscribeAutoError` (mocked) invokes its callback with `{endpoint: "/workspaces/1/cards/5", status: 500, message: "...", timestamp: "...", userAction: "Save card"}`, When `<AutoErrorListener />` is mounted, Then `useTicketIntakeChat`'s (mocked) open function is called with `variant: "autoError"` and a prefill built from those fields.
   Also test: Given `activeWorkspaceId` is `null` (mocked `useBoard()`), When the same bus event fires, Then the open function is NOT called — Story 9's gating extends to this entry point too.

   ```tsx
   // @vitest-environment jsdom
   import { render } from "@testing-library/react";
   import { describe, expect, it, vi } from "vitest";

   let capturedCallback: ((detail: unknown) => void) | null = null;
   const mockSubscribeAutoError = vi.fn((cb: (detail: unknown) => void) => {
   	capturedCallback = cb;
   	return vi.fn();
   });
   vi.mock("../../lib/ticketIntakeBus", () => ({
   	subscribeAutoError: (cb: (detail: unknown) => void) =>
   		mockSubscribeAutoError(cb),
   }));
   const mockUseBoard = vi.fn();
   vi.mock("../../context/BoardContext", () => ({
   	useBoard: () => mockUseBoard(),
   }));
   const mockOpen = vi.fn();
   vi.mock("../../hooks/useTicketIntakeChat", () => ({
   	useTicketIntakeChat: () => ({ open: mockOpen }),
   }));

   import { AutoErrorListener } from "./AutoErrorListener";

   describe("AutoErrorListener", () => {
   	it("opens the autoError-variant chat with a mapped prefill when the bus fires", () => {
   		mockUseBoard.mockReturnValue({ activeWorkspaceId: 1 });
   		render(<AutoErrorListener />);

   		capturedCallback?.({
   			endpoint: "/workspaces/1/cards/5",
   			status: 500,
   			message: "Internal error",
   			timestamp: "2026-07-01T00:00:00Z",
   			userAction: "Save card",
   		});

   		expect(mockOpen).toHaveBeenCalledWith(
   			expect.objectContaining({
   				variant: "autoError",
   				prefill: expect.objectContaining({
   					errorDetail: expect.objectContaining({ status: 500 }),
   				}),
   			}),
   		);
   	});

   	it("does not open the chat when activeWorkspaceId is null", () => {
   		mockUseBoard.mockReturnValue({ activeWorkspaceId: null });
   		render(<AutoErrorListener />);

   		capturedCallback?.({
   			endpoint: "/workspaces/1/cards/5",
   			status: 500,
   			message: "Internal error",
   			timestamp: "2026-07-01T00:00:00Z",
   			userAction: "Save card",
   		});

   		expect(mockOpen).not.toHaveBeenCalled();
   	});
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- AutoErrorListener.test.tsx`
   Expected failure: Cannot find module `./AutoErrorListener`

3. Implement minimal code to satisfy the test:
   File: `client/src/components/ticketIntake/AutoErrorListener.tsx`
   Implement: A component with no visible output that calls `subscribeAutoError` (Task 8) in a `useEffect`; on each event, if `activeWorkspaceId !== null` (from `useBoard()`), calls `useTicketIntakeChat`'s open/prefill function with `variant: "autoError"` and the error detail mapped into the prefill shape; if `activeWorkspaceId === null`, ignores the event entirely.
   File: `client/src/layout/AppLayout.tsx`
   Implement: Mount `<AutoErrorListener />` alongside the already-mounted `<FloatingChatButton />` (from Task 10).

4. Run test — verify PASS:
   `npm run test --workspace=client -- AutoErrorListener.test.tsx`
   Expected: PASS

5. Commit:
   `git add client/src/components/ticketIntake/AutoErrorListener.tsx client/src/layout/AppLayout.tsx client/src/components/ticketIntake/AutoErrorListener.test.tsx`
   `git commit -m "feat(ticket-intake): wire auto-error entry point to the chat bus"`

## REFERENCES LOADED
`docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md` — rule: Story 4 (all rules), Story 9 Rule 1 (auto-error inactive when no active workspace)
`client/src/lib/ticketIntakeBus.ts` (Task 8) — `subscribeAutoError` consumed here exactly as designed, no modification

## WHY THIS APPROACH
Complexity: lightweight
Justification: Thin glue component — subscribes to an existing bus, forwards to an existing hook's open function, gated by an existing context value. No new state machine logic (that lives in Task 9's hook).

## SANDWICH CONTEXT
[CRITICAL: This listener MUST NOT call any `confirm()`/submit action itself — it only opens the chat pre-filled; the explicit preview+confirm step (Task 9/10) remains mandatory even for auto-error, per Story 4 Rule 3's `[must-not]` acceptance criterion.]
You are implementing the auto-error entry point wiring for the Linear Ticket-Intake Chat feature.
Spec: docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md
Design decision: N/A directly for this task.
Files in scope: `client/src/components/ticketIntake/AutoErrorListener.tsx`, `client/src/layout/AppLayout.tsx` (mount line only, alongside Task 10's floating button), and the listener's test file. No other files.
Test framework: Vitest + `@testing-library/react`, run via `npm run test --workspace=client`.
Available after: T8 (bus), T9 (hook).
Architecture rule: `activeWorkspaceId` gating applies to this entry point exactly as it does to the other two (Story 9 Rule 1).
[RESTATE: Never auto-submit — only auto-open the chat pre-filled.]

## DELIVERABLE
Given a tagged user-initiated call fails with 500+, When the bus event fires, Then the chat auto-opens with a draft containing endpoint, status, message, timestamp, and user action; type is "Bug"; classifier is skipped (Story 4 Rule 2, Rule 3)
[must-not] Given the auto-opened chat is showing the draft, Then it must NOT auto-submit — preview and an explicit confirm click remain mandatory
Given `activeWorkspaceId` is null when the bus event fires, When the event arrives, Then the chat does NOT auto-open (Story 9 Rule 1 extended to this entry point)
Given a background/passive call fails with 500+ (never published to this bus per Task 8's tagging), Then no auto-open occurs — verified by Task 8's bus tests, referenced here as the upstream guarantee this task depends on

All tests PASS. Commit exists with message matching `feat(ticket-intake): wire auto-error entry point to the chat bus`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - `activeWorkspaceId === null` fully suppresses auto-open, no partial/flashing UI
  - No auto-submit path anywhere in this component

Must-not-have:
  - Any direct call to `confirm()`/submit logic from this listener
  - Re-implementing bus subscription logic instead of reusing Task 8's `subscribeAutoError`

Open question risks:
  - None specific to this task

Rollback note:
  - Auto-error hook independently removable from the client without touching server logic, per spec's Rollback Plan.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: none identified
Escalate when: a test seems to require auto-submission to pass — that would violate Story 4 Rule 3

---

### Task 13: Integration test — end-to-end ticket-intake flow [depends: T6, T7, T10, T11, T12]

## OBJECTIVE
Verify the full flow across server and data layers together: card-context entry → prefill → confirm → issueCreate (with a transient-failure-then-retry-success path) → `card_events` row written → history reflects it. This is the cross-unit verification that no single task's unit tests can cover alone.

Files:
- Test: `server/src/routes/ticket-intake.integration.test.ts`

Steps:
1. Write failing test for: end-to-end submit-then-history flow
   File: `server/src/routes/ticket-intake.integration.test.ts`
   Test verifies: Given a workspace member, a card, and a mocked Linear API (via mocked `fetch` at the `linear-client.ts` boundary — not mocking `linear-client.ts` itself, so the real retry/backoff/rate-limit/recordActivity code paths all execute) that fails once with a 500 then succeeds, When the full sequence runs — `POST .../ticket-intake/chat` (card-context prefill, classifier skipped is NOT applicable here since this is entry via ContextPanel, so classifier still fires) → `POST .../ticket-intake/submit` → wait for the async retry to resolve → `GET .../ticket-intake/history` — Then the history endpoint returns exactly 1 entry matching the created issue's title and URL, and the underlying `card_events` row has `event_type='linear_ticket_created'`, the correct `card_id`, and `workspace_id` matching the active workspace at creation time (Story 3 Rule 2, Story 9).
   Also test: Given the same flow but Linear fails all 10 retries, When the sequence completes, Then no `card_events` row is written and the history endpoint still returns an empty array (nothing falsely recorded on total failure).

   > **Test-architect note:** the chat-turn endpoint (T5) calls the real
   > `extractTicketFields`, which calls the real Anthropic client via
   > `getClient()`. Mocking only Linear's `fetch` would leave this test hitting
   > a real LLM — nondeterministic and against this plan's own mocking-boundary
   > rule. Mock `@anthropic-ai/sdk` too (same pattern as `agent/llm.test.ts`),
   > and mock `../db/pool.js` with a small in-memory fake so `recordActivity`'s
   > and `getTicketHistory`'s real SQL executes against it — this keeps every
   > module's own business logic real while only the two genuine external
   > boundaries (Linear, Anthropic) and the DB driver are faked.

   ```typescript
   import "dotenv/config";
   import express from "express";
   import request from "supertest";
   import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

   // In-memory card_events table — recordActivity()'s and getTicketHistory()'s
   // real SQL runs against this fake driver; only Linear's fetch and the
   // Anthropic SDK are mocked (see note above).
   interface FakeRow {
   	card_id: number | null;
   	event_type: string;
   	payload: Record<string, unknown>;
   	workspace_id: number;
   	created_at: string;
   }
   let cardEvents: FakeRow[] = [];

   vi.mock("../db/pool.js", () => ({
   	pool: {
   		query: vi.fn(async (sql: string, params: unknown[]) => {
   			if (/INSERT INTO card_events/i.test(sql)) {
   				// Positional coupling: matches recordActivity()'s current INSERT column
   				// order (card_id, from_column_id, to_column_id, actor_id, event_type,
   				// payload, workspace_id) — re-verify if helpers.ts's INSERT changes.
   				const [cardId, , , , eventType, payloadJson, workspaceId] = params as [
   					number | null,
   					unknown,
   					unknown,
   					unknown,
   					string,
   					string,
   					number,
   				];
   				cardEvents.push({
   					card_id: cardId,
   					event_type: eventType,
   					payload: JSON.parse(payloadJson),
   					workspace_id: workspaceId,
   					created_at: new Date().toISOString(),
   				});
   				return { rows: [], rowCount: 1 };
   			}
   			if (/SELECT payload, created_at FROM card_events/i.test(sql)) {
   				const [workspaceId, cardId] = params as [number, number];
   				const rows = cardEvents
   					.filter(
   						(r) =>
   							r.workspace_id === workspaceId &&
   							r.card_id === cardId &&
   							r.event_type === "linear_ticket_created",
   					)
   					.sort((a, b) => b.created_at.localeCompare(a.created_at))
   					.map((r) => ({ payload: r.payload, created_at: r.created_at }));
   				return { rows, rowCount: rows.length };
   			}
   			return { rows: [], rowCount: 0 };
   		}),
   	},
   }));

   vi.mock("./helpers.js", async (importOriginal) => {
   	const actual = await importOriginal<typeof import("./helpers.js")>();
   	return { ...actual, lookupMembership: vi.fn().mockResolvedValue("member") };
   });

   vi.mock("../realtime.js", () => ({
   	publishEvent: vi.fn().mockResolvedValue(undefined),
   }));

   const mockAnthropicCreate = vi.fn();
   vi.mock("@anthropic-ai/sdk", () => ({
   	default: class MockAnthropic {
   		messages = { create: mockAnthropicCreate };
   	},
   }));

   const mockLinearFetch = vi.fn();
   vi.stubGlobal("fetch", mockLinearFetch);

   async function flush() {
   	for (let i = 0; i < 5; i++) {
   		await new Promise((resolve) => setImmediate(resolve));
   	}
   }

   // Fully mocked at the Anthropic/Linear/DB boundaries — deterministic, so it
   // runs ungated in the normal server suite (RUN_LLM_IT stays reserved for
   // live-LLM suites like pipeline.integration.test.ts).
   describe(
   	"ticket-intake end-to-end: card-context submit → history",
   	() => {
   		let app: express.Express;

   		beforeEach(async () => {
   			cardEvents = [];
   			mockAnthropicCreate.mockReset();
   			mockLinearFetch.mockReset();
   			const { ticketIntakeRouter } = await import("./ticket-intake.js");
   			app = express();
   			app.use(express.json());
   			app.use((req, _res, next) => {
   				(req as Record<string, unknown>).user = { id: 7, displayName: "Bob" };
   				next();
   			});
   			app.use("/api", ticketIntakeRouter);
   		});

   		afterEach(() => {
   			vi.resetModules();
   		});

   		it("records exactly 1 card_events row and reflects it in history after a transient-then-success submit", async () => {
   			mockAnthropicCreate.mockResolvedValueOnce({
   				content: [
   					{
   						type: "text",
   						text: JSON.stringify({
   							title: "Fix login redirect",
   							description: "Redirect loops on logout",
   							expected: "user lands on dashboard",
   							actual: "redirect loop",
   							repro: "log out then log back in",
   							type: "Bug",
   						}),
   					},
   				],
   			});

   			await request(app)
   				.post("/api/workspaces/1/ticket-intake/chat")
   				.send({
   					message: "Fix login redirect keeps looping",
   					isFirstTurn: true,
   					autoError: false,
   					cardId: 42,
   				});

   			mockLinearFetch
   				.mockResolvedValueOnce({
   					ok: true,
   					status: 200,
   					json: () =>
   						Promise.resolve({
   							data: {
   								team: { labels: { nodes: [{ id: "label-bug", name: "Bug" }] } },
   							},
   						}),
   				})
   				.mockResolvedValueOnce({
   					ok: false,
   					status: 500,
   					json: () => Promise.resolve({ errors: [{}] }),
   				})
   				.mockResolvedValueOnce({
   					ok: true,
   					status: 200,
   					json: () =>
   						Promise.resolve({
   							data: {
   								issueCreate: {
   									issue: {
   										url: "https://linear.app/cam/issue/CAM-9",
   										identifier: "CAM-9",
   									},
   								},
   							},
   						}),
   				})
   				.mockResolvedValueOnce({
   					ok: true,
   					status: 200,
   					json: () => Promise.resolve({ data: { commentCreate: {} } }),
   				});

   			const submitRes = await request(app)
   				.post("/api/workspaces/1/ticket-intake/submit")
   				.send({
   					title: "Fix login redirect",
   					description: "Redirect loops on logout",
   					type: "Bug",
   					cardId: 42,
   				});
   			expect(submitRes.status).toBe(202);

   			await flush();

   			const historyRes = await request(app).get(
   				"/api/workspaces/1/ticket-intake/history?cardId=42",
   			);

   			expect(historyRes.body.tickets).toHaveLength(1);
   			expect(historyRes.body.tickets[0].issueUrl).toBe(
   				"https://linear.app/cam/issue/CAM-9",
   			);
   			expect(cardEvents).toHaveLength(1);
   			expect(cardEvents[0]).toMatchObject({
   				event_type: "linear_ticket_created",
   				card_id: 42,
   				workspace_id: 1,
   			});
   		});

   		it("writes no card_events row and keeps history empty when all retries fail", async () => {
   			mockLinearFetch
   				.mockResolvedValueOnce({
   					ok: true,
   					status: 200,
   					json: () =>
   						Promise.resolve({
   							data: {
   								team: { labels: { nodes: [{ id: "label-bug", name: "Bug" }] } },
   							},
   						}),
   				})
   				.mockResolvedValue({
   					ok: false,
   					status: 500,
   					json: () => Promise.resolve({ errors: [{}] }),
   				});

   			const submitRes = await request(app)
   				.post("/api/workspaces/1/ticket-intake/submit")
   				.send({
   					title: "Fix login redirect",
   					description: "Redirect loops on logout",
   					type: "Bug",
   					cardId: 43,
   				});
   			expect(submitRes.status).toBe(202);

   			await flush();

   			const historyRes = await request(app).get(
   				"/api/workspaces/1/ticket-intake/history?cardId=43",
   			);
   			expect(historyRes.body.tickets).toEqual([]);
   			expect(cardEvents).toHaveLength(0);
   		});
   	},
   );
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=server -- src/routes/ticket-intake.integration.test.ts`
   Expected failure: Any of the constituent endpoints/modules from Tasks 5–7 not yet wired together end-to-end, or the async retry timing not yet observable in a test harness

3. Implement:
   This task is test-only — no new production code is expected if Tasks 1–7 were implemented correctly. If the test surfaces a genuine integration gap (e.g., the async submit path's completion isn't observable synchronously enough for the test to assert on), add the minimal glue needed — e.g., an injectable "wait for pending ticket-intake jobs to settle" test hook — without changing any task's documented public contract.

4. Run test — verify PASS:
   `npm run test --workspace=server -- src/routes/ticket-intake.integration.test.ts`
   Expected: PASS

5. Commit:
   `git add server/src/routes/ticket-intake.integration.test.ts`
   `git commit -m "test(ticket-intake): add end-to-end submit-to-history integration test"`

## REFERENCES LOADED
`docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md` — rule: Story 3, 5, 6 combined (cross-unit verification)
`server/package.json` — `test:integration` is hardcoded to `src/agent/pipeline.integration.test.ts` (live-LLM suite); appending this file to that script would un-skip the pipeline suite against a real LLM. This test is fully mocked and deterministic, so it runs ungated in the normal `npm run test --workspace=server` suite instead

## WHY THIS APPROACH
Complexity: standard
Justification: Cross-unit verification is explicitly called for whenever a GWT spans multiple units — this flow spans routing (T5–T7), the Linear client + retry (T1), rate limits (T4), and the activity log (T3). The task as written below is fully concrete (exact file, TDD steps, DELIVERABLE); test-architect (Phase 6) may still relocate or split it if it identifies a cleaner boundary.

## SANDWICH CONTEXT
[CRITICAL: This task adds NO new production code contracts — if a gap is found, the fix must be additive test-harness glue only, not a silent change to another task's documented DELIVERABLE.]
You are implementing the end-to-end integration test for the Linear Ticket-Intake Chat feature.
Spec: docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md
Design decision: N/A (verification task, not a design task).
Files in scope: `server/src/routes/ticket-intake.integration.test.ts` only, unless a genuine integration gap is found (see WHY THIS APPROACH).
Test framework: Vitest — fully mocked at the Anthropic/Linear/DB boundaries, deterministic, run ungated via `npm run test --workspace=server` (`RUN_LLM_IT` stays reserved for live-LLM suites like `pipeline.integration.test.ts`).
Available after: T6, T7, T10, T11, T12 (needs the full server flow and enough client-side confirmation of the contract shape to write realistic requests).
Architecture rule: mocks Linear at the `fetch` boundary and the Anthropic SDK at the client boundary only — exercises the real retry/rate-limit/activity-log code paths (the chat-turn endpoint's `extractTicketFields` call is real and would otherwise hit a live LLM).
[RESTATE: No silent contract changes to other tasks — flag any gap found instead of quietly patching around it.]

## DELIVERABLE
Given a card-context submission with a transient Linear failure then success, When the full flow runs, Then history shows exactly 1 entry and `card_events` has the correct `card_id`/`workspace_id`
Given a card-context submission where all retries fail, When the flow completes, Then no `card_events` row exists and history remains empty
[must-not] Given total retry failure, Then rate-limit quota must NOT have been consumed (cross-checked against Task 4's `peekSubmitLimit`)

All tests PASS. Commit exists with message matching `test(ticket-intake): add end-to-end submit-to-history integration test`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Mocks only at the Linear `fetch` boundary — exercises real retry/rate-limit/activity-log logic
  - Both success-after-retry and total-failure paths covered

Must-not-have:
  - Silent changes to any other task's public contract to make this test pass

Open question risks:
  - The async submit design (Task 6) means this test must synchronize on job completion somehow (e.g., awaiting a test-only "settled" signal) rather than a real HTTP response — if the chosen mechanism feels like a contract change rather than test glue, report NEEDS_CONTEXT for test-architect/reviewer input

Rollback note:
  - Test-only; no rollback implications.

## STOP CONDITIONS
Done when: all DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: synchronizing on the async job's completion requires more than minimal test-harness glue
Escalate when: satisfying this test requires changing another task's already-committed public contract

---

### Task 14: Integration test — SSE submit-result → chat hook → preview UI (client, Story 6) [depends: T9, T10]

> **Test-architect addition.** Neither Task 13 nor any of the 13 original
> tasks' unit tests wire the real client-side chain together: T9's own hook
> tests inject `ticketIntakeEvents` directly as a prop specifically to avoid
> depending on `BoardContext` (correct unit-test isolation), and T10-T12's
> component tests mock `useTicketIntakeChat` entirely (also correct isolation).
> That leaves BoardContext's real SSE dispatch branch → the real hook → the
> real `PreviewScreen` rendering never exercised together end-to-end — the
> exact seam Story 6 depends on client-side. This task closes that gap with
> one thin harness test; it is not a reflexive addition.

## OBJECTIVE
Prove that a real `ticket_intake.submit_result` SSE event, dispatched by BoardContext's real `onmessage` branch (added in Task 9), drives the real (unmocked) `useTicketIntakeChat` hook and the real (unmocked) `PreviewScreen` component to render the correct success / graceful-failure UI — with only the browser's `EventSource` and the network layer (`api`) mocked.

Files:
- Test: `client/src/hooks/useTicketIntakeChat.integration.test.tsx`

Steps:
1. Write failing test for: real SSE event → real hook → real UI render
   File: `client/src/hooks/useTicketIntakeChat.integration.test.tsx`
   Test verifies: Given a real `BoardProvider` wrapping a harness component that calls the real `useTicketIntakeChat` and renders the real `<PreviewScreen>`, and a mocked global `EventSource` (the `MockEventSource` pattern already used in `client/src/hooks/useNotifications.test.ts`), When `confirm()` is invoked (mocked `api.ticketIntake.submit` resolving `{status: "submitting"}`) and the mock EventSource then emits a message event `{type: "ticket_intake.submit_result", success: true, issueUrl, issueIdentifier}`, Then BoardContext's real dispatch puts it on `ticketIntakeEvents`, the real hook consumes it, and the real `PreviewScreen` renders the success message with the issue identifier — no mocked hook or dispatch layer anywhere in this path.
   Also test: Given the same real wiring, When the mock EventSource instead emits `{type: "ticket_intake.submit_result", success: false, retryable: true}`, Then the real UI renders the graceful-failure message and a working "Resubmit" button — never a success message.

   ```tsx
   // @vitest-environment jsdom
   import { act, render, screen, waitFor } from "@testing-library/react";
   import { beforeEach, describe, expect, it, vi } from "vitest";
   import { BoardProvider } from "../context/BoardContext";
   import { PreviewScreen } from "../components/ticketIntake/PreviewScreen";
   import { useTicketIntakeChat } from "./useTicketIntakeChat";

   const mockSubmit = vi.fn();
   vi.mock("../api", () => ({
   	api: {
   		// NOTE: initial-workspace auto-selection lives in BoardContext.tsx's own
   		// mount effect (workspaceSwitcher.ts has no chooseInitialWorkspace helper)
   		// — verify the getWorkspaces response shape against BoardProvider at
   		// implementation time, and mock EVERY api method BoardProvider calls on
   		// mount, or the provider crashes before the SSE effect (which requires
   		// activeWorkspaceId !== null) ever connects.
   		getWorkspaces: vi.fn().mockResolvedValue({
   			workspaces: [{ id: 1, name: "Team" }],
   			pendingInvites: [],
   		}),
   		getBoard: vi.fn().mockResolvedValue({ columns: [] }),
   		getMetrics: vi.fn().mockResolvedValue({}),
   		getActivity: vi.fn().mockResolvedValue({ events: [] }),
   		getSettings: vi.fn().mockResolvedValue({}),
   		heartbeat: vi.fn().mockResolvedValue(undefined),
   		getPresence: vi.fn().mockResolvedValue({ users: [] }),
   		ticketIntake: {
   			submit: (...args: unknown[]) => mockSubmit(...args),
   		},
   	},
   	ApiError: class ApiError extends Error {
   		status: number;
   		constructor(message: string, status: number) {
   			super(message);
   			this.status = status;
   		}
   	},
   }));

   // Reuses the MockEventSource pattern from client/src/hooks/useNotifications.test.ts
   // — this codebase's existing precedent for simulating SSE messages in jsdom.
   class MockEventSource {
   	static instances: MockEventSource[] = [];
   	url: string;
   	onopen: (() => void) | null = null;
   	onmessage: ((e: MessageEvent) => void) | null = null;
   	close = vi.fn();
   	constructor(url: string) {
   		this.url = url;
   		MockEventSource.instances.push(this);
   	}
   	emit(data: unknown) {
   		this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
   	}
   	static latest() {
   		return MockEventSource.instances[MockEventSource.instances.length - 1];
   	}
   	static reset() {
   		MockEventSource.instances = [];
   	}
   }
   vi.stubGlobal("EventSource", MockEventSource);

   function Harness() {
   	const chat = useTicketIntakeChat({ workspaceId: 1, variant: "global" });
   	return (
   		<PreviewScreen
   			draft={chat.draft ?? { title: "t", description: "d", type: "Bug" }}
   			onConfirm={chat.confirm}
   			onResubmit={chat.resubmit}
   			submitState={chat.submitState}
   		/>
   	);
   }

   describe("SSE submit-result → real hook → real PreviewScreen (Story 6 client surface)", () => {
   	beforeEach(() => {
   		MockEventSource.reset();
   		mockSubmit.mockReset().mockResolvedValue({ status: "submitting" });
   	});

   	it("renders the success message when a real submit_result success event arrives via SSE", async () => {
   		render(
   			<BoardProvider user={{ id: 1, displayName: "Bob" }} onSignedOut={vi.fn()}>
   				<Harness />
   			</BoardProvider>,
   		);

   		await waitFor(() => expect(MockEventSource.latest()).toBeDefined());

   		await act(async () => {
   			screen.getByRole("button", { name: /confirm/i }).click();
   		});

   		act(() => {
   			MockEventSource.latest()?.emit({
   				type: "ticket_intake.submit_result",
   				success: true,
   				issueUrl: "https://linear.app/cam/issue/CAM-1",
   				issueIdentifier: "CAM-1",
   			});
   		});

   		await waitFor(() => {
   			expect(screen.getByText(/CAM-1/)).toBeInTheDocument();
   		});
   	});

   	it("renders the graceful-failure message and Resubmit button when a real graceful-failure event arrives via SSE", async () => {
   		render(
   			<BoardProvider user={{ id: 1, displayName: "Bob" }} onSignedOut={vi.fn()}>
   				<Harness />
   			</BoardProvider>,
   		);

   		await waitFor(() => expect(MockEventSource.latest()).toBeDefined());

   		await act(async () => {
   			screen.getByRole("button", { name: /confirm/i }).click();
   		});

   		act(() => {
   			MockEventSource.latest()?.emit({
   				type: "ticket_intake.submit_result",
   				success: false,
   				retryable: true,
   			});
   		});

   		await waitFor(() => {
   			expect(screen.queryByText(/success/i)).not.toBeInTheDocument();
   			expect(
   				screen.getByRole("button", { name: /resubmit/i }),
   			).toBeInTheDocument();
   		});
   	});
   });
   ```

2. Run test — verify FAIL:
   `npm run test --workspace=client -- useTicketIntakeChat.integration.test.tsx`
   Expected failure: BoardContext does not yet dispatch `ticket_intake.submit_result` into an exposed `ticketIntakeEvents` queue (if run before Task 9 lands), or the harness never observes the emitted event

3. Implement:
   This task is test-only — no new production code is expected if Task 9's `BoardContext.tsx` dispatch branch and Task 10's `PreviewScreen.tsx` were implemented per their own documented DELIVERABLEs. If a genuine wiring gap surfaces, fix it additively in Task 9's file without altering Task 9's already-committed public contract (same rule as Task 13).

4. Run test — verify PASS:
   `npm run test --workspace=client -- useTicketIntakeChat.integration.test.tsx`
   Expected: PASS

5. Commit:
   `git add client/src/hooks/useTicketIntakeChat.integration.test.tsx`
   `git commit -m "test(ticket-intake): add client integration test for SSE submit-result to UI"`

## REFERENCES LOADED
`docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md` — rule: Story 6 (submission failure & recovery), client-side surface
`client/src/hooks/useNotifications.test.ts` — `MockEventSource` class + `vi.stubGlobal("EventSource", ...)` pattern, this codebase's only existing EventSource-mocking precedent, reused directly
`client/src/context/BoardContext.tsx` — real `BoardProvider` and the real SSE dispatch branch added in Task 9
`client/src/components/ticketIntake/PreviewScreen.tsx` (Task 10) — real component, deliberately not mocked here

## WHY THIS APPROACH
Complexity: lightweight
Justification: Gap-driven, not scope-driven. Task 9's hook tests and Tasks 10-12's component tests both correctly mock away the opposite layer for unit isolation — but that leaves the three-layer real wiring (BoardContext dispatch → real hook → real UI) exercised nowhere. This is one thin harness component and one test file, not new production logic.

## SANDWICH CONTEXT
[CRITICAL: This test MUST NOT mock `useTicketIntakeChat` or `PreviewScreen` — mocking either would just re-run Task 9's or Task 10's own unit tests under a new file name and defeat the purpose of this task. Only `EventSource` (no native jsdom implementation) and the `api` network boundary may be mocked.]
You are adding one client-side integration test proving the real SSE-to-UI wiring for the Linear Ticket-Intake Chat feature.
Spec: docs/pocket/spec/2026-07-01-linear-ticket-chat/ticket-intake-chat-spec.md
Design decision: N/A (verification task, not a design task).
Files in scope: `client/src/hooks/useTicketIntakeChat.integration.test.tsx` only, unless a genuine wiring gap is found in Task 9's `BoardContext.tsx` dispatch branch (see WHY THIS APPROACH).
Test framework: Vitest + `@testing-library/react`, run via `npm run test --workspace=client`.
Available after: T9 (hook + BoardContext dispatch branch), T10 (PreviewScreen).
Architecture rule: real `BoardProvider`, real `useTicketIntakeChat`, real `PreviewScreen` — only `EventSource` and `api` are mocked.
[RESTATE: Do not mock the hook or the UI component under test.]

## DELIVERABLE
Given a real SSE `ticket_intake.submit_result` success event, When it flows through BoardContext's real dispatch → the real hook → the real `PreviewScreen`, Then the success message with the issue identifier renders (Story 6)
Given a real SSE `ticket_intake.submit_result` graceful-failure event, When it flows through the same real wiring, Then the graceful-failure message and a working "Resubmit" button render — never a success message

All tests PASS. Commit exists with message matching `test(ticket-intake): add client integration test for SSE submit-result to UI`.

Format: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED

## QUALITY BAR
Must-have:
  - Uses the real `BoardProvider`, real `useTicketIntakeChat`, real `PreviewScreen` — none of the three mocked
  - Reuses the existing `MockEventSource` pattern from `useNotifications.test.ts` rather than inventing a new one

Must-not-have:
  - Mocking `useTicketIntakeChat` or `PreviewScreen`
  - Duplicating Task 9's or Task 10's already-covered mocked-boundary unit tests

Open question risks:
  - BoardProvider's mount-time api surface (the `getWorkspaces` response shape plus every other `api` call in its mount effects) must be confirmed against `client/src/context/BoardContext.tsx` at implementation time — low risk, mechanical fixup only

Rollback note:
  - Test-only; no rollback implications.

## STOP CONDITIONS
Done when: both DELIVERABLE scenarios pass, tests green, commit created
Uncertain when: BoardContext's real SSE handler requires network-level `EventSource` behavior `MockEventSource` cannot simulate
Escalate when: satisfying this test requires mocking the hook or the UI component under test

---

## Phase Completion Gate

DONE when ALL of the following:
- Every task in this phase: status DONE
- All tests pass
- All commits created with correct format
- No task has status BLOCKED or NEEDS_CONTEXT

Hand off to (none — all phases complete) ONLY after this gate passes.
