// ---------------------------------------------------------------------------
// Message payload detection — exported for unit tests
// ---------------------------------------------------------------------------

export type MessageAction =
	| { kind: "send"; message: string }
	| { kind: "confirm" }
	| { kind: "cancel" }
	| { kind: "invalid" };

export function resolveMessageAction(body: unknown): MessageAction {
	if (body && typeof body === "object") {
		const record = body as Record<string, unknown>;
		if (record.action === "confirm_regenerate") return { kind: "confirm" };
		if (record.action === "cancel_regenerate") return { kind: "cancel" };
		if (typeof record.message === "string") {
			const trimmed = record.message.trim();
			if (trimmed) return { kind: "send", message: trimmed };
		}
	}
	return { kind: "invalid" };
}
