export function createItemMutationQueue() {
	const chains = new Map<string, Promise<unknown>>();
	function enqueue<R>(itemKey: string, task: () => Promise<R>): Promise<R> {
		const prior = chains.get(itemKey) ?? Promise.resolve();
		const next = prior.then(task, task);
		const settled = next.then(
			() => undefined,
			() => undefined,
		);
		chains.set(itemKey, settled);
		void settled.then(() => {
			if (chains.get(itemKey) === settled) chains.delete(itemKey);
		});
		return next;
	}
	function hasPending(itemKey: string): boolean {
		return chains.has(itemKey);
	}
	return { enqueue, hasPending };
}
