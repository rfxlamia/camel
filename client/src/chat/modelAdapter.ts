import type { ChatModelAdapter } from "@assistant-ui/core";
import { api } from "../api";

/** Stub adapter — full streaming polish in T8. */
export const modelAdapter: ChatModelAdapter = {
	async *run({ messages, abortSignal, unstable_threadId }) {
		const lastUser = [...messages].reverse().find((m) => m.role === "user");
		const textPart = lastUser?.content.find((p) => p.type === "text");
		const text = textPart?.type === "text" ? textPart.text : "";
		const threadId = Number(unstable_threadId);
		if (!threadId || !text) {
			yield { content: [{ type: "text", text: "" }] };
			return;
		}

		const stream = await api.chat.sendMessage(threadId, text);
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		let fullText = "";

		try {
			while (true) {
				if (abortSignal.aborted) break;
				const { done, value } = await reader.read();
				if (done) break;
				fullText += decoder.decode(value, { stream: true });
				yield { content: [{ type: "text", text: fullText }] };
			}
		} finally {
			reader.releaseLock();
		}
	},
};
