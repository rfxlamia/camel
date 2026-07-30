import type { ChatModelAdapter } from "@assistant-ui/core";
import type { useChatStream } from "../hooks/useChatStream";

type ChatStreamApi = Pick<ReturnType<typeof useChatStream>, "runModelTurn">;

export function createModelAdapter(
	stream: ChatStreamApi,
): ChatModelAdapter {
	return {
		async *run({ messages, abortSignal }) {
			const lastUser = [...messages].reverse().find((m) => m.role === "user");
			const textPart = lastUser?.content.find((p) => p.type === "text");
			const text = textPart?.type === "text" ? textPart.text : "";
			if (!text) {
				yield { content: [{ type: "text", text: "" }] };
				return;
			}

			yield* stream.runModelTurn(text, abortSignal);
		},
	};
}

/** @deprecated Use createModelAdapter with useChatStream — kept for tests. */
export const modelAdapter: ChatModelAdapter = {
	async *run({ messages, abortSignal }) {
		const lastUser = [...messages].reverse().find((m) => m.role === "user");
		const textPart = lastUser?.content.find((p) => p.type === "text");
		const text = textPart?.type === "text" ? textPart.text : "";
		if (!text) {
			yield { content: [{ type: "text", text: "" }] };
			return;
		}

		yield { content: [{ type: "text", text: "" }] };
		if (abortSignal.aborted) return;
	},
};
