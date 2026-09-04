export type FocusSessionState = "ready" | "running" | "paused" | "finished";

export type FocusAction = "start" | "pause" | "resume" | "finish";

export type FocusSnapshot = {
	state: FocusSessionState;
	accumulatedSeconds: number;
	runningSince: Date | null;
};

export class InvalidFocusTransitionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidFocusTransitionError";
	}
}

function accrualSeconds(runningSince: Date, now: Date): number {
	return Math.round((now.getTime() - runningSince.getTime()) / 1000);
}

export function elapsedSeconds(snapshot: FocusSnapshot, now: Date): number {
	if (snapshot.state === "ready") {
		return 0;
	}
	if (snapshot.state === "running" && snapshot.runningSince !== null) {
		return snapshot.accumulatedSeconds + accrualSeconds(snapshot.runningSince, now);
	}
	return snapshot.accumulatedSeconds;
}

function assertTransition(
	snapshot: FocusSnapshot,
	action: FocusAction,
	allowed: FocusSessionState[],
): void {
	if (!allowed.includes(snapshot.state)) {
		throw new InvalidFocusTransitionError(
			`Cannot ${action} from state "${snapshot.state}"`,
		);
	}
}

export function applyAction(
	snapshot: FocusSnapshot,
	action: FocusAction,
	now: Date,
): FocusSnapshot {
	switch (action) {
		case "start":
			assertTransition(snapshot, action, ["ready"]);
			return {
				state: "running",
				accumulatedSeconds: snapshot.accumulatedSeconds,
				runningSince: now,
			};
		case "pause":
			assertTransition(snapshot, action, ["running"]);
			if (snapshot.runningSince === null) {
				throw new InvalidFocusTransitionError(
					`Cannot ${action} from state "${snapshot.state}"`,
				);
			}
			return {
				state: "paused",
				accumulatedSeconds:
					snapshot.accumulatedSeconds +
					accrualSeconds(snapshot.runningSince, now),
				runningSince: null,
			};
		case "resume":
			assertTransition(snapshot, action, ["paused"]);
			return {
				state: "running",
				accumulatedSeconds: snapshot.accumulatedSeconds,
				runningSince: now,
			};
		case "finish":
			if (snapshot.state === "finished") {
				throw new InvalidFocusTransitionError(
					`Cannot ${action} from state "${snapshot.state}"`,
				);
			}
			if (snapshot.state === "running") {
				if (snapshot.runningSince === null) {
					throw new InvalidFocusTransitionError(
						`Cannot ${action} from state "${snapshot.state}"`,
					);
				}
				return {
					state: "finished",
					accumulatedSeconds:
						snapshot.accumulatedSeconds +
						accrualSeconds(snapshot.runningSince, now),
					runningSince: null,
				};
			}
			return {
				state: "finished",
				accumulatedSeconds: snapshot.accumulatedSeconds,
				runningSince: null,
			};
	}
}
