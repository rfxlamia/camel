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
		return Math.max(0, accumulatedSeconds + elapsed);
	}
	return accumulatedSeconds;
}

export type DurationParts = {
	/** Hours and minutes — the part the eye should land on. */
	major: string;
	/** Seconds, colon included. Concatenating major + seconds equals
	    formatDuration() exactly, so both can render the same value. */
	seconds: string;
};

/**
 * Same value as formatDuration(), split so the display can set minutes large
 * and seconds small. A focus session counts up with no target, so the seconds
 * are precision, not pressure — they read quieter than the minutes.
 */
export function formatDurationParts(totalSeconds: number): DurationParts {
	const seconds = Math.floor(totalSeconds);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;

	const major =
		hours > 0
			? `${hours}:${String(minutes).padStart(2, "0")}`
			: String(minutes).padStart(2, "0");

	return { major, seconds: `:${String(secs).padStart(2, "0")}` };
}
