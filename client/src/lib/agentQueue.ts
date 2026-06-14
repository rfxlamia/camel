export interface QueueState {
	isGenerating: boolean;
	queue: string[];
}

export const initialQueue: QueueState = { isGenerating: false, queue: [] };

/**
 * Submit a message to the queue.
 * If idle, fires immediately. If generating, queues it.
 */
export function submit(
	state: QueueState,
	message: string,
): { state: QueueState; fire: string | null } {
	if (state.isGenerating) {
		return {
			state: { ...state, queue: [...state.queue, message] },
			fire: null,
		};
	}
	return { state: { ...state, isGenerating: true }, fire: message };
}

/**
 * Settle the in-flight job (called on both done AND fail).
 * If queued items remain, auto-fires the next one.
 */
export function settle(state: QueueState): {
	state: QueueState;
	fire: string | null;
} {
	if (state.queue.length === 0) {
		return { state: { ...state, isGenerating: false }, fire: null };
	}
	const [next, ...rest] = state.queue;
	return { state: { isGenerating: true, queue: rest }, fire: next };
}

/**
 * Decide how the orchestrator should route a settle result's next item.
 *
 * When a board-create FAILS, no board exists yet, so the next queued item is
 * itself an intent that must go through createBoard (not sendMessage, which
 * would early-return without a board and strand the queue). When a board does
 * exist, the next item is a refine message handled by sendMessage.
 */
export function routeNext(
	fire: string | null,
	boardExists: boolean,
): "createBoard" | "sendMessage" | "none" {
	if (fire === null) return "none";
	if (!boardExists) return "createBoard";
	return "sendMessage";
}
