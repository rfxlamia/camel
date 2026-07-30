import {
	AssistantRuntimeProvider,
	useLocalRuntime,
	useRemoteThreadListRuntime,
} from "@assistant-ui/core/react";
import type { ReactNode } from "react";
import { modelAdapter } from "./modelAdapter";
import { threadListAdapter } from "./threadListAdapter";

function useChatThreadRuntime() {
	return useLocalRuntime(modelAdapter);
}

type ChatRuntimeProviderProps = {
	children: ReactNode;
	threadId?: string;
};

export function ChatRuntimeProvider({
	children,
	threadId,
}: ChatRuntimeProviderProps) {
	const runtime = useRemoteThreadListRuntime({
		runtimeHook: useChatThreadRuntime,
		adapter: threadListAdapter,
		threadId,
	});

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			{children}
		</AssistantRuntimeProvider>
	);
}
