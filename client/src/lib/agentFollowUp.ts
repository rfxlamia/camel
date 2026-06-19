/** Follow-up message in the agent chat conversation. */
export type FollowUpMessage = {
	role: "user" | "assistant";
	content: string;
	intent?: string;
};

/**
 * Convert the raw `conversations` array from the server into follow-up
 * messages for the chat UI.  The first two entries (system prompt +
 * initial assistant reply) are skipped.
 */
export function conversationsToFollowUpMessages(
	conversations: Array<{ role: string; content: string }> | undefined,
): FollowUpMessage[] {
	if (!conversations || conversations.length <= 2) return [];
	return conversations.slice(2).map((m) => ({
		role: m.role as "user" | "assistant",
		content: m.content,
	}));
}
