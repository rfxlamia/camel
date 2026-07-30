import type { RemoteThreadListAdapter } from "@assistant-ui/core";
import { createAssistantStream } from "assistant-stream";
import { api } from "../api";

export const threadListAdapter: RemoteThreadListAdapter = {
	async list() {
		const threads = await api.chat.listThreads();
		return {
			threads: threads.map((t) => ({
				remoteId: String(t.id),
				status: "regular" as const,
				title: t.title,
			})),
		};
	},

	async initialize() {
		const thread = await api.chat.createThread();
		return { remoteId: String(thread.id) };
	},

	async rename(remoteId, newTitle) {
		await api.chat.renameThread(Number(remoteId), newTitle);
	},

	async archive() {
		// Chat threads are hard-deleted; archive is a no-op.
	},

	async unarchive() {
		// Chat threads are hard-deleted; unarchive is a no-op.
	},

	async delete(remoteId) {
		await api.chat.deleteThread(Number(remoteId));
	},

	async fetch(threadId) {
		const threads = await api.chat.listThreads();
		const thread = threads.find((t) => String(t.id) === threadId);
		return {
			remoteId: threadId,
			status: "regular" as const,
			title: thread?.title ?? "Untitled",
		};
	},

	async generateTitle(remoteId, _messages) {
		return createAssistantStream(async (controller) => {
			const threads = await api.chat.listThreads();
			const thread = threads.find((t) => String(t.id) === remoteId);
			controller.appendText(thread?.title ?? "Untitled");
		});
	},
};
