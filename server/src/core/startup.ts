export async function listenAfterRecovery<T>(
	recover: () => Promise<unknown>,
	listen: () => T,
): Promise<T> {
	await recover();
	return listen();
}
