import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { deriveChatToolTrace } from "../lib/chatToolTrace";
import {
	initialQueue,
	type QueueState,
	submit as queueSubmit,
	settle,
} from "../lib/agentQueue";
import type {
	ChatAttachment,
	ChatMessage as ApiChatMessage,
	ChatMessageRole,
	ChatToolEvent,
	StreamEvent,
	ToolTraceItem,
} from "../types";

export interface ChatStreamMessage {
	id?: number;
	role: ChatMessageRole;
	content: string;
	thinking?: string | null;
	toolTrace?: ToolTraceItem[];
	attachments?: ChatAttachment[];
	retryMessageId?: number;
}

export interface UseChatStreamOptions {
	threadId: number;
	workspaceId?: number;
}

type QueueAction =
	| { type: "submit"; message: string }
	| { type: "settle" }
	| { type: "reset" };

function queueReducer(state: QueueState, action: QueueAction): QueueState {
	switch (action.type) {
		case "submit":
			return queueSubmit(state, action.message).state;
		case "settle":
			return settle(state).state;
		case "reset":
			return initialQueue;
	}
}

const OVERFLOW_MESSAGE = "Thread too long, start a new chat";

function mapApiMessage(message: ApiChatMessage): ChatStreamMessage {
	return {
		id: message.id,
		role: message.role,
		content: message.content,
		thinking: message.thinking ?? null,
		toolTrace: message.toolTrace ?? [],
		attachments: message.attachments ?? [],
	};
}

type TurnWaiter = {
	message: string;
	resolve: () => void;
};

async function consumeNdjsonStream(
	stream: ReadableStream<Uint8Array>,
	handlers: {
		onEvent: (event: StreamEvent) => void;
	},
	abortSignal?: AbortSignal,
): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			if (abortSignal?.aborted) return;
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				const event = JSON.parse(line) as StreamEvent;
				handlers.onEvent(event);
				if (event.type === "done" || event.type === "error") return;
			}
		}
	} finally {
		reader.releaseLock();
	}
}

function updateStreamingAssistant(
	messages: ChatStreamMessage[],
	patch: Partial<ChatStreamMessage>,
): ChatStreamMessage[] {
	const next = [...messages];
	for (let i = next.length - 1; i >= 0; i--) {
		if (next[i].role === "assistant" && next[i].id === undefined) {
			next[i] = { ...next[i], ...patch };
			return next;
		}
	}
	return [...next, { role: "assistant", content: "", ...patch }];
}

function removeStreamingAssistant(
	messages: ChatStreamMessage[],
): ChatStreamMessage[] {
	const next = [...messages];
	for (let i = next.length - 1; i >= 0; i--) {
		if (next[i].role === "assistant" && next[i].id === undefined) {
			next.splice(i, 1);
			return next;
		}
	}
	return next;
}

function removeUnsavedUserMessage(
	messages: ChatStreamMessage[],
	content: string,
): ChatStreamMessage[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (
			message.role === "user" &&
			message.id === undefined &&
			message.content === content
		) {
			return [...messages.slice(0, i), ...messages.slice(i + 1)];
		}
	}
	return messages;
}

export function useChatStream({ threadId, workspaceId }: UseChatStreamOptions) {
	const [messages, setMessages] = useState<ChatStreamMessage[]>([]);
	const [overflowError, setOverflowError] = useState<string | null>(null);
	const [overflowMessage, setOverflowMessage] = useState<string | null>(null);
	const [canRetry, setCanRetry] = useState(true);
	const [queueState, dispatch] = useReducer(queueReducer, initialQueue);
	const queueStateRef = useRef(queueState);
	queueStateRef.current = queueState;
	const turnWaitersRef = useRef<TurnWaiter[]>([]);

	const executeTurnRef = useRef<
		(opts: {
			message?: string;
			retryMessageId?: number;
			abortSignal?: AbortSignal;
			onToken?: (text: string) => void;
			addUserMessage?: boolean;
		}) => Promise<void>
	>(async () => undefined);

	useEffect(() => {
		if (!threadId) return;

		let cancelled = false;
		queueStateRef.current = initialQueue;
		dispatch({ type: "reset" });
		setOverflowError(null);
		setOverflowMessage(null);
		setCanRetry(true);
		setMessages([]);

		void api.chat.getMessages(threadId).then((apiMessages) => {
			if (cancelled) return;
			setMessages(apiMessages.map(mapApiMessage));
		});

		return () => {
			cancelled = true;
		};
	}, [threadId]);

	const drainQueue = useCallback(() => {
		const settleResult = settle(queueStateRef.current);
		queueStateRef.current = settleResult.state;
		dispatch({ type: "settle" });
		if (!settleResult.fire) return;

		const waiterIndex = turnWaitersRef.current.findIndex(
			(w) => w.message === settleResult.fire,
		);
		if (waiterIndex >= 0) {
			const [waiter] = turnWaitersRef.current.splice(waiterIndex, 1);
			waiter.resolve();
			return;
		}

		void executeTurnRef.current({ message: settleResult.fire });
	}, []);

	const acquireTurn = useCallback((message: string): Promise<void> => {
		const result = queueSubmit(queueStateRef.current, message);
		queueStateRef.current = result.state;
		dispatch({ type: "submit", message });
		if (result.fire) return Promise.resolve();
		return new Promise((resolve) => {
			turnWaitersRef.current.push({ message, resolve });
		});
	}, []);

	const executeTurn = useCallback(
		async ({
			message,
			retryMessageId,
			abortSignal,
			onToken,
			addUserMessage = true,
		}: {
			message?: string;
			retryMessageId?: number;
			abortSignal?: AbortSignal;
			onToken?: (text: string) => void;
			addUserMessage?: boolean;
		}) => {
			const isRetry = retryMessageId !== undefined;
			setOverflowError(null);
			setOverflowMessage(null);
			setCanRetry(true);

			if (!isRetry && message && addUserMessage) {
				setMessages((prev) => [
					...prev,
					{ role: "user", content: message },
				]);
			}

			setMessages((prev) => [
				...prev,
				{
					role: "assistant",
					content: "",
					thinking: null,
					toolTrace: [],
				},
			]);

			const toolEvents: ChatToolEvent[] = [];
			let content = "";
			let thinking: string | null = null;

			try {
				const stream = isRetry
					? await api.chat.retryMessage(threadId, retryMessageId!)
					: await api.chat.sendMessage(threadId, message!, {
							workspaceId,
						});

				await consumeNdjsonStream(
					stream,
					{
						onEvent: (event) => {
							switch (event.type) {
								case "token":
									content += event.text;
									onToken?.(content);
									setMessages((prev) =>
										updateStreamingAssistant(prev, { content }),
									);
									break;
								case "thinking":
									thinking = (thinking ?? "") + event.text;
									setMessages((prev) =>
										updateStreamingAssistant(prev, { thinking }),
									);
									break;
								case "tool_event":
									toolEvents.push(event.event);
									setMessages((prev) =>
										updateStreamingAssistant(prev, {
											toolTrace: deriveChatToolTrace(toolEvents),
										}),
									);
									break;
								case "done": {
									const messageId = event.messageId;
									setMessages((prev) =>
										updateStreamingAssistant(prev, {
											id: messageId,
											content,
											thinking,
											toolTrace: deriveChatToolTrace(toolEvents),
										}),
									);
									void api.chat.getMessages(threadId).then((apiMessages) => {
										const assistant = apiMessages.find(
											(m) => m.id === messageId,
										);
										if (!assistant?.attachments?.length) return;
										setMessages((prev) => {
											const next = [...prev];
											const idx = next.findIndex((m) => m.id === messageId);
											if (idx < 0) return prev;
											next[idx] = {
												...next[idx],
												attachments: assistant.attachments,
											};
											return next;
										});
									});
									break;
								}
								case "error": {
									const errorMessage = event.message;
									const retryable = event.retryable !== false;
									setCanRetry(retryable);
									setMessages((prev) => removeStreamingAssistant(prev));
									void api.chat.getMessages(threadId).then((apiMessages) => {
										const lastUser = [...apiMessages]
											.reverse()
											.find((m) => m.role === "user");
										setMessages([
											...apiMessages.map(mapApiMessage),
											{
												role: "error",
												content: errorMessage,
												retryMessageId: lastUser?.id,
											},
										]);
									});
									break;
								}
							}
						},
					},
					abortSignal,
				);
			} catch (err) {
				const status =
					err instanceof ApiError
						? err.status
						: (err as { status?: number }).status;
				const messageText =
					err instanceof ApiError
						? err.message
						: err instanceof Error
							? err.message
							: "Request failed";

				if (status === 413) {
					setOverflowError(OVERFLOW_MESSAGE);
					setOverflowMessage(message ?? "");
					setCanRetry(false);
					setMessages((prev) => {
						let next = removeStreamingAssistant(prev);
						if (message && addUserMessage) {
							next = removeUnsavedUserMessage(next, message);
						}
						return next;
					});
				} else {
					setMessages((prev) => {
						const withoutPartial = removeStreamingAssistant(prev);
						return [
							...withoutPartial,
							{
								role: "error",
								content: messageText,
								retryMessageId: isRetry ? retryMessageId : undefined,
							},
						];
					});
					setCanRetry(true);
				}
			} finally {
				drainQueue();
			}
		},
		[drainQueue, threadId, workspaceId],
	);

	executeTurnRef.current = executeTurn;

	const send = useCallback(
		async (message: string) => {
			const trimmed = message.trim();
			if (!trimmed) return;

			const result = queueSubmit(queueStateRef.current, trimmed);
			queueStateRef.current = result.state;
			dispatch({ type: "submit", message: trimmed });
			if (result.fire) {
				void executeTurnRef.current({ message: result.fire });
			}
		},
		[],
	);

	const retry = useCallback(async (messageId: number) => {
		setMessages((prev) => prev.filter((m) => m.role !== "error"));
		void executeTurnRef.current({
			retryMessageId: messageId,
			addUserMessage: false,
		});
	}, []);

	const runModelTurn = useCallback(
		async function* (
			message: string,
			abortSignal: AbortSignal,
		): AsyncGenerator<{ content: [{ type: "text"; text: string }] }> {
			const trimmed = message.trim();
			if (!trimmed) {
				yield { content: [{ type: "text", text: "" }] };
				return;
			}

			await acquireTurn(trimmed);

			let latest = "";
			let lastYielded = "";
			const updates: string[] = [];
			let resolveWait: (() => void) | null = null;
			let turnFinished = false;

			const notify = () => {
				resolveWait?.();
				resolveWait = null;
			};

			const onToken = (text: string) => {
				latest = text;
				updates.push(text);
				notify();
			};

			const turnPromise = executeTurnRef
				.current({
					message: trimmed,
					abortSignal,
					addUserMessage: true,
					onToken,
				})
				.finally(() => {
					turnFinished = true;
					notify();
				});

			while (!turnFinished || updates.length > 0) {
				while (updates.length > 0) {
					const text = updates.shift()!;
					if (text !== lastYielded) {
						lastYielded = text;
						yield { content: [{ type: "text", text }] };
					}
				}
				if (turnFinished) break;
				await new Promise<void>((resolve) => {
					resolveWait = resolve;
				});
			}

			await turnPromise;

			if (latest !== lastYielded) {
				yield { content: [{ type: "text", text: latest }] };
			}
		},
		[acquireTurn],
	);

	return {
		messages,
		send,
		retry,
		overflowError,
		overflowMessage,
		canRetry,
		isStreaming: queueState.isGenerating,
		runModelTurn,
	};
}
