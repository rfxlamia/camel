import {
	AssistantRuntimeProvider,
	useLocalRuntime,
	useRemoteThreadListRuntime,
} from "@assistant-ui/core/react";
import {
	createContext,
	useContext,
	useMemo,
	type ReactNode,
} from "react";
import { useChatStream } from "../hooks/useChatStream";
import { createModelAdapter } from "./modelAdapter";
import { threadListAdapter } from "./threadListAdapter";

type ChatStreamConfig = {
	threadId: number;
	workspaceId?: number;
};

const ChatStreamConfigContext = createContext<ChatStreamConfig>({
	threadId: 0,
});

function useChatThreadRuntime() {
	const { threadId, workspaceId } = useContext(ChatStreamConfigContext);
	const chatStream = useChatStream({ threadId, workspaceId });
	const adapter = useMemo(
		() => createModelAdapter(chatStream),
		[chatStream],
	);
	return useLocalRuntime(adapter);
}

type ChatRuntimeProviderProps = {
	children: ReactNode;
	threadId?: string;
	workspaceId?: number;
};

export function ChatRuntimeProvider({
	children,
	threadId,
	workspaceId,
}: ChatRuntimeProviderProps) {
	const config = useMemo(
		() => ({
			threadId: Number(threadId) || 0,
			workspaceId,
		}),
		[threadId, workspaceId],
	);

	const runtime = useRemoteThreadListRuntime({
		runtimeHook: useChatThreadRuntime,
		adapter: threadListAdapter,
		threadId,
	});

	return (
		<ChatStreamConfigContext.Provider value={config}>
			<AssistantRuntimeProvider runtime={runtime}>
				{children}
			</AssistantRuntimeProvider>
		</ChatStreamConfigContext.Provider>
	);
}
