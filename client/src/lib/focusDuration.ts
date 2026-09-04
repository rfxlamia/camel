export function formatDuration(totalSeconds: number): string {
	const seconds = Math.floor(totalSeconds);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;

	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
	}

	return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function computeDisplaySeconds(
	accumulatedSeconds: number,
	state: "ready" | "running" | "paused" | "finished",
	runningSince: string | null,
	nowMs: number = Date.now(),
): number {
	if (state === "running" && runningSince !== null) {
		const elapsed = (nowMs - Date.parse(runningSince)) / 1000;
		return accumulatedSeconds + elapsed;
	}
	return accumulatedSeconds;
}
