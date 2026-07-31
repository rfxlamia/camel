import {
	ComposerPrimitive,
	ThreadPrimitive,
	unstable_useComposerInput,
} from "@assistant-ui/react";
import { useEffect } from "react";
import { ChatMessage } from "../components/chat/ChatMessage";
import { useChatStreamContext } from "./ChatRuntimeProvider";

function ChatMessageList() {
	const { messages, retry, canRetry } = useChatStreamContext();

	return (
		<div className="space-y-4">
			{messages.map((message, index) => (
				<ChatMessage
					key={message.id ?? `msg-${index}`}
					role={message.role}
					content={message.content}
					thinking={message.thinking ?? null}
					toolTrace={message.toolTrace ?? []}
					attachments={message.attachments ?? []}
					canRetry={message.role === "error" ? canRetry : undefined}
					onRetry={
						message.role === "error" && message.retryMessageId != null
							? () => void retry(message.retryMessageId!)
							: undefined
					}
				/>
			))}
		</div>
	);
}

function ChatComposer() {
	const { overflowError, overflowMessage } = useChatStreamContext();
	const { setText } = unstable_useComposerInput();

	useEffect(() => {
		if (overflowMessage) {
			setText(overflowMessage);
		}
	}, [overflowMessage, setText]);

	return (
		<ComposerPrimitive.Root className="shrink-0 border-t border-neutral-200 bg-white px-4 py-3">
			{overflowError && (
				<div
					role="alert"
					className="mb-2 rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-sm text-error-900"
				>
					{overflowError}
				</div>
			)}
			<div className="flex items-end gap-2">
				<ComposerPrimitive.Input
					rows={1}
					placeholder="Message Camel…"
					className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
				/>
				<ComposerPrimitive.Send className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
					Send
				</ComposerPrimitive.Send>
			</div>
		</ComposerPrimitive.Root>
	);
}

/** Full-height chat column: scrollable messages + composer pinned to bottom. */
export function ChatPanel() {
	return (
		<ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
			<ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
				<ChatMessageList />
			</ThreadPrimitive.Viewport>
			<ChatComposer />
		</ThreadPrimitive.Root>
	);
}

/** @deprecated Use ChatPanel — kept for tests. */
export function LocalThread() {
	return (
		<ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
			<ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
				<ChatMessageList />
			</ThreadPrimitive.Viewport>
		</ThreadPrimitive.Root>
	);
}

/** @deprecated Use ChatPanel — kept for tests. */
export function LocalComposer() {
	return <ChatComposer />;
}
