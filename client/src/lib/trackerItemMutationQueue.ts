export function createItemMutationQueue() {
	const chains = new Map<number, Promise<unknown>>();
	function enqueue<R>(itemId: number, task: () => Promise<R>): Promise<R> {
		const prior = chains.get(itemId) ?? Promise.resolve();
		const next = prior.then(task, task);
		const settled = next.then(
			() => undefined,
			() => undefined,
		);
		chains.set(itemId, settled);
		void settled.then(() => {
			if (chains.get(itemId) === settled) chains.delete(itemId);
		});
		return next;
	}
	return { enqueue };
}
