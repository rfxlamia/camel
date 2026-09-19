export interface AutoErrorDetail {
	endpoint: string;
	status: number;
	message: string;
	timestamp: string;
	userAction?: string;
}

const listeners = new Set<(detail: AutoErrorDetail) => void>();

export function publishAutoError(detail: AutoErrorDetail): void {
	for (const listener of listeners) {
		listener(detail);
	}
}

export function subscribeAutoError(
	listener: (detail: AutoErrorDetail) => void,
): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
