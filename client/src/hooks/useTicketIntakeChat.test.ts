// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TicketIntakeDraft } from "../api";
import { ApiError } from "../api";
import type { TicketIntakeResultEvent } from "./useTicketIntakeChat";

const mockSendMessage = vi.fn();
const mockSubmit = vi.fn();
const mockResubmit = vi.fn();

vi.mock("../api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../api")>();
	return {
		...actual,
		api: {
			...actual.api,
			ticketIntake: {
				sendMessage: (...args: unknown[]) => mockSendMessage(...args),
				submit: (...args: unknown[]) => mockSubmit(...args),
				resubmit: (...args: unknown[]) => mockResubmit(...args),
				getHistory: vi.fn(),
			},
		},
	};
});

const readyDraft: TicketIntakeDraft = {
	title: "Kanban drag broken",
	description: "Cards snap back after drop",
	expected: "Card stays in new column",
	actual: "Card returns to original column",
	repro: "Drag card between columns",
	type: "Bug",
};

describe("useTicketIntakeChat — turn flow and preview gating", () => {
	beforeEach(() => {
		mockSendMessage.mockReset();
		mockSubmit.mockReset();
		mockResubmit.mockReset();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("asks classifier on first turn and keeps preview gated", async () => {
		mockSendMessage.mockResolvedValueOnce({
			ready: false,
			question: "Is this a bug, feature, or improvement?",
		});
		const { useTicketIntakeChat } = await import("./useTicketIntakeChat");
		const { result } = renderHook(() =>
			useTicketIntakeChat({ workspaceId: 1, variant: "global" }),
		);

		await act(async () => {
			await result.current.sendMessage("kanban-nya aneh");
		});

		expect(mockSendMessage).toHaveBeenCalledWith(1, {
			message: "kanban-nya aneh",
			isFirstTurn: true,
			conversationHistory: undefined,
		});
		expect(result.current.messages).toEqual([
			{ role: "user", content: "kanban-nya aneh" },
			{
				role: "assistant",
				content: "Is this a bug, feature, or improvement?",
			},
		]);
		expect(result.current.previewReady).toBe(false);
		expect(result.current.draft).toBeNull();
		expect(mockSubmit).not.toHaveBeenCalled();
	});

	it("opens preview after a ready chat response on follow-up turn", async () => {
		mockSendMessage
			.mockResolvedValueOnce({
				ready: false,
				question: "Is this a bug, feature, or improvement?",
			})
			.mockResolvedValueOnce({ ready: true, draft: readyDraft });
		const { useTicketIntakeChat } = await import("./useTicketIntakeChat");
		const { result } = renderHook(() =>
			useTicketIntakeChat({ workspaceId: 1, variant: "global" }),
		);

		await act(async () => {
			await result.current.sendMessage("kanban-nya aneh");
		});
		await act(async () => {
			await result.current.sendMessage("bug");
		});

		expect(mockSendMessage).toHaveBeenLastCalledWith(1, {
			message: "bug",
			isFirstTurn: false,
			conversationHistory: [
				{ role: "user", content: "kanban-nya aneh" },
				{
					role: "assistant",
					content: "Is this a bug, feature, or improvement?",
				},
				{ role: "user", content: "bug" },
			],
		});
		expect(result.current.previewReady).toBe(true);
		expect(result.current.draft).toEqual(readyDraft);
		expect(mockSubmit).not.toHaveBeenCalled();
	});

	it("autoError variant skips classifier, sets Bug draft, preview ready, never auto-submits", async () => {
		mockSendMessage.mockResolvedValueOnce({ ready: true, draft: readyDraft });
		const { useTicketIntakeChat } = await import("./useTicketIntakeChat");
		const { result } = renderHook(() =>
			useTicketIntakeChat({
				workspaceId: 1,
				variant: "autoError",
				prefill: {
					endpoint: "/api/workspaces/1/cards/5",
					status: 500,
					errorMessage: "Internal Server Error",
					timestamp: "2026-07-01T12:00:00Z",
					userAction: "Save card",
				},
			}),
		);

		await waitFor(() => {
			expect(result.current.previewReady).toBe(true);
		});

		expect(mockSendMessage).toHaveBeenCalledTimes(1);
		expect(mockSendMessage).toHaveBeenCalledWith(
			1,
			expect.objectContaining({
				isFirstTurn: true,
				autoError: true,
				message: expect.stringContaining("Save card"),
			}),
		);
		expect(result.current.draft?.type).toBe("Bug");
		expect(result.current.submitState).toBe("idle");
		expect(mockSubmit).not.toHaveBeenCalled();
		expect(result.current.open).toBe(true);
	});

	it("editDraft updates the in-memory draft while preview is ready", async () => {
		mockSendMessage.mockResolvedValueOnce({ ready: true, draft: readyDraft });
		const { useTicketIntakeChat } = await import("./useTicketIntakeChat");
		const { result } = renderHook(() =>
			useTicketIntakeChat({ workspaceId: 1, variant: "global" }),
		);

		await act(async () => {
			await result.current.sendMessage("detailed bug report");
		});

		act(() => {
			result.current.editDraft({ title: "Updated title" });
		});

		expect(result.current.draft?.title).toBe("Updated title");
		expect(result.current.draft?.description).toBe(readyDraft.description);
	});
});

describe("useTicketIntakeChat — submit lifecycle and SSE consumption", () => {
	beforeEach(() => {
		mockSendMessage.mockReset();
		mockSubmit.mockReset();
		mockResubmit.mockReset();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("confirm submits draft and enters submitting state", async () => {
		mockSendMessage.mockResolvedValueOnce({ ready: true, draft: readyDraft });
		mockSubmit.mockResolvedValueOnce({ status: "submitting" });
		const { useTicketIntakeChat } = await import("./useTicketIntakeChat");
		const { result } = renderHook(() =>
			useTicketIntakeChat({ workspaceId: 1, variant: "global" }),
		);

		await act(async () => {
			await result.current.sendMessage("detailed bug report");
		});
		await act(async () => {
			await result.current.confirm();
		});

		expect(mockSubmit).toHaveBeenCalledWith(1, {
			title: readyDraft.title,
			description: readyDraft.description,
			type: "Bug",
			source: "global",
		});
		expect(result.current.submitState).toBe("submitting");
	});

	it("maps ApiError 409 on confirm to rate_limited submitState", async () => {
		mockSendMessage.mockResolvedValueOnce({ ready: true, draft: readyDraft });
		mockSubmit.mockRejectedValueOnce(
			new ApiError("Submit rate limit exceeded", 409),
		);
		const { useTicketIntakeChat } = await import("./useTicketIntakeChat");
		const { result } = renderHook(() =>
			useTicketIntakeChat({ workspaceId: 1, variant: "global" }),
		);

		await act(async () => {
			await result.current.sendMessage("detailed bug report");
		});
		await act(async () => {
			await result.current.confirm();
		});

		expect(result.current.submitState).toBe("rate_limited");
	});

	it("consumes ticket_intake.submit_result success from ticketIntakeEvents", async () => {
		mockSendMessage.mockResolvedValueOnce({ ready: true, draft: readyDraft });
		mockSubmit.mockResolvedValueOnce({ status: "submitting" });
		const events: TicketIntakeResultEvent[] = [];
		const { useTicketIntakeChat } = await import("./useTicketIntakeChat");
		const { result, rerender } = renderHook(
			({ ticketIntakeEvents }) =>
				useTicketIntakeChat({
					workspaceId: 1,
					variant: "global",
					ticketIntakeEvents,
				}),
			{ initialProps: { ticketIntakeEvents: events } },
		);

		await act(async () => {
			await result.current.sendMessage("detailed bug report");
		});
		await act(async () => {
			await result.current.confirm();
		});

		const successEvent: TicketIntakeResultEvent = {
			type: "ticket_intake.submit_result",
			success: true,
			issueUrl: "https://linear.app/cam/issue/CAM-1",
			issueIdentifier: "CAM-1",
		};
		rerender({ ticketIntakeEvents: [successEvent] });

		await waitFor(() => {
			expect(result.current.submitState).toBe("success");
		});
	});

	it("consumes ticket_intake.submit_result failure as graceful_failure", async () => {
		mockSendMessage.mockResolvedValueOnce({ ready: true, draft: readyDraft });
		mockSubmit.mockResolvedValueOnce({ status: "submitting" });
		const events: TicketIntakeResultEvent[] = [];
		const { useTicketIntakeChat } = await import("./useTicketIntakeChat");
		const { result, rerender } = renderHook(
			({ ticketIntakeEvents }) =>
				useTicketIntakeChat({
					workspaceId: 1,
					variant: "global",
					ticketIntakeEvents,
				}),
			{ initialProps: { ticketIntakeEvents: events } },
		);

		await act(async () => {
			await result.current.sendMessage("detailed bug report");
		});
		await act(async () => {
			await result.current.confirm();
		});

		rerender({
			ticketIntakeEvents: [
				{
					type: "ticket_intake.submit_result",
					success: false,
					retryable: true,
					errorMessage: "Linear unavailable",
				},
			],
		});

		await waitFor(() => {
			expect(result.current.submitState).toBe("graceful_failure");
		});
	});

	it("resubmit calls resubmit endpoint and returns to submitting", async () => {
		mockSendMessage.mockResolvedValueOnce({ ready: true, draft: readyDraft });
		mockSubmit.mockResolvedValueOnce({ status: "submitting" });
		mockResubmit.mockResolvedValueOnce({ status: "submitting" });
		const { useTicketIntakeChat } = await import("./useTicketIntakeChat");
		const { result, rerender } = renderHook(
			({ ticketIntakeEvents }) =>
				useTicketIntakeChat({
					workspaceId: 1,
					variant: "global",
					ticketIntakeEvents,
				}),
			{ initialProps: { ticketIntakeEvents: [] as TicketIntakeResultEvent[] } },
		);

		await act(async () => {
			await result.current.sendMessage("detailed bug report");
		});
		await act(async () => {
			await result.current.confirm();
		});
		rerender({
			ticketIntakeEvents: [
				{
					type: "ticket_intake.submit_result",
					success: false,
					retryable: true,
					errorMessage: "Linear unavailable",
				},
			],
		});
		await waitFor(() => {
			expect(result.current.submitState).toBe("graceful_failure");
		});

		await act(async () => {
			await result.current.resubmit();
		});

		expect(mockResubmit).toHaveBeenCalledWith(1, {
			title: readyDraft.title,
			description: readyDraft.description,
			type: "Bug",
			source: "global",
		});
		expect(result.current.submitState).toBe("submitting");
	});
});
