// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSendMessage = vi.fn();
const mockRetryMessage = vi.fn();
const mockGetMessages = vi.fn();

vi.mock("../api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../api")>();
	return {
		...actual,
		api: {
			...actual.api,
			chat: {
				...actual.api.chat,
				sendMessage: (...a: unknown[]) => mockSendMessage(...a),
				retryMessage: (...a: unknown[]) => mockRetryMessage(...a),
				getMessages: (...a: unknown[]) => mockGetMessages(...a),
			},
		},
	};
});

function ndjsonStream(lines: string[]) {
	return new ReadableStream({
		start(controller) {
			const enc = new TextEncoder();
			for (const line of lines) controller.enqueue(enc.encode(`${line}\n`));
			controller.close();
		},
	});
}

describe("useChatStream", () => {
	beforeEach(() => {
		mockSendMessage.mockReset();
		mockRetryMessage.mockReset();
		mockGetMessages.mockReset();
		mockGetMessages.mockResolvedValue([]);
	});

	afterEach(() => vi.clearAllMocks());

	it("queues message while streaming and drains on done", async () => {
		mockSendMessage
			.mockResolvedValueOnce(
				ndjsonStream(['{"type":"token","text":"Hi"}', '{"type":"done"}']),
			)
			.mockResolvedValueOnce(
				ndjsonStream(['{"type":"token","text":"Queued"}', '{"type":"done"}']),
			);
		const { useChatStream } = await import("./useChatStream");
		const { result } = renderHook(() =>
			useChatStream({ threadId: 1, workspaceId: 7 }),
		);

		await act(async () => {
			await result.current.send("first");
			await result.current.send("second");
		});

		await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(2));
		expect(mockSendMessage).toHaveBeenCalledWith(1, "first", {
			workspaceId: 7,
		});
	});

	it("retry calls api.chat.retryMessage without duplicating user bubble", async () => {
		mockRetryMessage.mockResolvedValue(
			ndjsonStream(['{"type":"token","text":"Retry"}', '{"type":"done"}']),
		);
		const { useChatStream } = await import("./useChatStream");
		const { result } = renderHook(() => useChatStream({ threadId: 1 }));
		await act(async () => {
			await result.current.retry(42);
		});
		expect(mockRetryMessage).toHaveBeenCalledWith(1, 42);
		expect(result.current.messages.filter((m) => m.role === "user")).toHaveLength(
			0,
		);
	});

	it("context overflow shows message without retry", async () => {
		mockSendMessage.mockRejectedValue(
			Object.assign(new Error("overflow"), { status: 413 }),
		);
		const { useChatStream } = await import("./useChatStream");
		const { result } = renderHook(() => useChatStream({ threadId: 1 }));
		await act(async () => {
			await result.current.send("too long");
		});
		expect(result.current.overflowError).toContain("Thread too long");
		expect(result.current.canRetry).toBe(false);
	});
});
