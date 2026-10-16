import type { WorkItemSource } from "../tracker";

export type FocusSessionState = "ready" | "running" | "paused" | "finished";

export interface FocusSession {
	id: number;
	state: FocusSessionState;
	accumulatedSeconds: number;
	runningSince: string | null;
	version: number;
	source: WorkItemSource;
	taskId: number;
	taskKey: string | null;
	returnPath: string;
	finishedAt: string | null;
}

export interface FocusSessionGetResponse {
	session: FocusSession | null;
	autoFinished?: {
		reason: "task_missing";
		taskKey: string | null;
	};
}
