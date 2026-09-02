const MAX_SAMPLES = 200;
export const WORK_ITEMS_LIST_THRESHOLD_MS = 100;

const samples: number[] = [];

/** Test-only: clears the in-memory sample buffer. */
export function resetListLatencySamplesForTests(): void {
	samples.length = 0;
}

export function recordListDuration(ms: number): void {
	samples.push(ms);
	if (samples.length > MAX_SAMPLES) {
		samples.shift();
	}
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const index = Math.ceil((p / 100) * sorted.length) - 1;
	return sorted[Math.max(0, index)] ?? 0;
}

export type WorkItemListLatencySnapshot = {
	count: number;
	p50: number;
	p95: number;
	max: number;
	thresholdMs: number;
};

export function getListLatencySnapshot(): WorkItemListLatencySnapshot {
	const sorted = [...samples].sort((a, b) => a - b);
	return {
		count: samples.length,
		p50: percentile(sorted, 50),
		p95: percentile(sorted, 95),
		max: sorted[sorted.length - 1] ?? 0,
		thresholdMs: WORK_ITEMS_LIST_THRESHOLD_MS,
	};
}

export function isOverThreshold(): boolean {
	const { p95, thresholdMs, count } = getListLatencySnapshot();
	return count > 0 && p95 > thresholdMs;
}

export function startWorkItemLatencyReporter(): ReturnType<typeof setInterval> {
	return setInterval(() => {
		if (!isOverThreshold()) return;
		const snapshot = getListLatencySnapshot();
		console.warn(
			JSON.stringify({
				event: "work_items_list_latency_threshold",
				...snapshot,
			}),
		);
	}, 15 * 60 * 1000);
}
