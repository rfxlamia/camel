import type {
	MyWorkCandidate,
	MyWorkSerializedItem,
	MyWorkWorkspace,
} from "./my-work-types.js";

export type MyWorkHydrate = (
	candidates: readonly MyWorkCandidate[],
	workspaces: ReadonlyMap<number, MyWorkWorkspace>,
) => Promise<MyWorkSerializedItem[]>;

export class MyWorkUnavailableError extends Error {
	readonly statusCode = 503;
	readonly code = "my_work_unavailable";
	readonly retryable = true;

	constructor(cause?: unknown) {
		super("Unable to load My Work", { cause });
		this.name = "MyWorkUnavailableError";
	}
}

export function asUnavailable(error: unknown): MyWorkUnavailableError {
	if (error instanceof MyWorkUnavailableError) return error;
	return new MyWorkUnavailableError(error);
}
