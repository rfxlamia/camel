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

	it("merges attachments from getMessages after stream done", async () => {
		mockSendMessage.mockResolvedValue(
			ndjsonStream([
				'{"type":"token","text":"Here is your file"}',
				'{"type":"done","messageId":99}',
			]),
		);
		mockGetMessages
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{
					id: 10,
					role: "user",
					content: "create a file",
				},
				{
					id: 99,
					role: "assistant",
					content: "Here is your file",
					attachments: [
						{
							id: 1,
							messageId: 99,
							filename: "report.md",
							format: "md",
						},
					],
				},
			]);

		const { useChatStream } = await import("./useChatStream");
		const { result } = renderHook(() => useChatStream({ threadId: 1 }));

		await act(async () => {
			await result.current.send("create a file");
		});

		await waitFor(() => {
			const assistant = result.current.messages.find(
				(m) => m.role === "assistant" && m.id === 99,
			);
			expect(assistant?.attachments).toEqual([
				{
					id: 1,
					messageId: 99,
					filename: "report.md",
					format: "md",
				},
			]);
		});
		expect(mockGetMessages).toHaveBeenCalledTimes(2);
	});

	it("removes partial assistant immediately on stream error", async () => {
		mockSendMessage.mockResolvedValue(
			ndjsonStream([
				'{"type":"token","text":"Partial"}',
				'{"type":"error","message":"Model failed","retryable":true}',
			]),
		);
		mockGetMessages
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{ id: 5, role: "user", content: "hello" },
			]);

		const { useChatStream } = await import("./useChatStream");
		const { result } = renderHook(() => useChatStream({ threadId: 1 }));

		await act(async () => {
			void result.current.send("hello");
		});

		await waitFor(() => {
			expect(
				result.current.messages.some(
					(m) => m.role === "assistant" && m.id === undefined,
				),
			).toBe(false);
		});

		await waitFor(() => {
			const errorMsg = result.current.messages.find((m) => m.role === "error");
			expect(errorMsg).toMatchObject({
				content: "Model failed",
				retryMessageId: 5,
			});
		});
	});
});
