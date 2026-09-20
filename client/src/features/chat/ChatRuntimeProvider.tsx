import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { createModelAdapter } from "./modelAdapter";
import { type UseChatStreamOptions, useChatStream } from "./useChatStream";

type ChatStreamContextValue = ReturnType<typeof useChatStream>;

const ChatStreamContext = createContext<ChatStreamContextValue | null>(null);

export function useChatStreamContext(): ChatStreamContextValue {
	const ctx = useContext(ChatStreamContext);
	if (!ctx) {
		throw new Error(
			"useChatStreamContext must be used within ChatRuntimeProvider",
		);
	}
	return ctx;
}

type ChatRuntimeProviderProps = {
	children: ReactNode;
	threadId?: string;
	workspaceId?: number;
};

function ChatThreadRuntime({
	threadId,
	workspaceId,
	children,
}: UseChatStreamOptions & { children: ReactNode }) {
	const chatStream = useChatStream({ threadId, workspaceId });
	const adapter = useMemo(() => createModelAdapter(chatStream), [chatStream]);
	const runtime = useLocalRuntime(adapter);

	return (
		<ChatStreamContext.Provider value={chatStream}>
			<AssistantRuntimeProvider runtime={runtime}>
				<div className="flex min-h-0 flex-1 flex-col">{children}</div>
			</AssistantRuntimeProvider>
		</ChatStreamContext.Provider>
	);
}

export function ChatRuntimeProvider({
	children,
	threadId,
	workspaceId,
}: ChatRuntimeProviderProps) {
	const parsedThreadId = Number(threadId) || 0;

	if (!parsedThreadId) {
		return <>{children}</>;
	}

	return (
		<ChatThreadRuntime threadId={parsedThreadId} workspaceId={workspaceId}>
			{children}
		</ChatThreadRuntime>
	);
}
