import {
	getListLatencySnapshot,
	recordListDuration,
	resetListLatencySamplesForTests,
	type WorkItemListLatencySnapshot,
} from "./work-item-latency.js";

const MAX_EVENTS = 200;

export const MY_WORK_ROLLUP_EVENT = "my_work_rollup" as const;

export type MyWorkErrorClass =
	| "none"
	| "unauthorized"
	| "client"
	| "server"
	| "unknown";

export type MyWorkObservabilityEvent = {
	event: typeof MY_WORK_ROLLUP_EVENT;
	latencyMs: number;
	count: number;
	errorClass: MyWorkErrorClass;
};

export type MyWorkObservabilityInput = {
	/** The number of authorized items returned by the rollup. */
	count?: unknown;
	/** An HTTP status used to classify a known route outcome. */
	statusCode?: unknown;
	/** An error is classified; its contents are never retained or logged. */
	error?: unknown;
	/** Explicit duration for callers that already measured the request. */
	latencyMs?: unknown;
	/** Monotonic start time returned by start(). */
	startedAt?: number;
};

export type MyWorkObservabilityOptions = {
	logger?: (event: MyWorkObservabilityEvent) => void;
	now?: () => number;
};

export type MyWorkObservabilityMeasurement = {
	finish: (input?: Omit<MyWorkObservabilityInput, "startedAt">) =>
		MyWorkObservabilityEvent;
};

export type MyWorkObservability = {
	start: () => MyWorkObservabilityMeasurement;
	record: (input?: MyWorkObservabilityInput) => MyWorkObservabilityEvent;
	getEvents: () => readonly MyWorkObservabilityEvent[];
	getLatencySnapshot: () => WorkItemListLatencySnapshot;
	reset: () => void;
};

function defaultLogger(event: MyWorkObservabilityEvent): void {
	console.info(JSON.stringify(event));
}

function monotonicNow(): number {
	return performance.now();
}

function finiteNonNegative(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: fallback;
}

function nonNegativeCount(value: unknown): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: 0;
}

function statusCodeFrom(input: MyWorkObservabilityInput): number | null {
	if (
		typeof input.statusCode === "number" &&
		Number.isInteger(input.statusCode)
	) {
		return input.statusCode;
	}
	if (typeof input.error !== "object" || input.error === null) return null;
	const candidate = input.error as {
		status?: unknown;
		statusCode?: unknown;
	};
	if (typeof candidate.status === "number" && Number.isInteger(candidate.status)) {
		return candidate.status;
	}
	if (
		typeof candidate.statusCode === "number" &&
		Number.isInteger(candidate.statusCode)
	) {
		return candidate.statusCode;
	}
	return null;
}

function errorCodeFrom(error: unknown): string | null {
	if (typeof error !== "object" || error === null) return null;
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" ? code.toLowerCase() : null;
}

export function classifyMyWorkError(
	input: Pick<MyWorkObservabilityInput, "statusCode" | "error"> = {},
): MyWorkErrorClass {
	const statusCode = statusCodeFrom(input);
	const code = errorCodeFrom(input.error);
	if (
		statusCode === 401 ||
		statusCode === 403 ||
		code === "unauthorized" ||
		code === "auth_required" ||
		code === "session_expired" ||
		code === "not_authenticated"
	) {
		return "unauthorized";
	}
	if (statusCode !== null && statusCode >= 400 && statusCode < 500) {
		return "client";
	}
	if (statusCode !== null && statusCode >= 500) return "server";
	if (input.error != null) {
		return input.error instanceof Error ? "server" : "unknown";
	}
	return "none";
}

/**
 * Creates the safe telemetry boundary for the authenticated My Work rollup.
 * Only aggregate values are passed to the logger; request, response, and error
 * objects are intentionally not accepted as log payloads.
 */
export function createMyWorkObservability(
	options: MyWorkObservabilityOptions = {},
): MyWorkObservability {
	const logger = options.logger ?? defaultLogger;
	const now = options.now ?? monotonicNow;
	const events: MyWorkObservabilityEvent[] = [];

	const record = (
		input: MyWorkObservabilityInput = {},
	): MyWorkObservabilityEvent => {
		const endedAt = now();
		const measuredLatency =
			input.latencyMs ??
			(input.startedAt === undefined ? 0 : endedAt - input.startedAt);
		const latencyMs = finiteNonNegative(measuredLatency, 0);
		const event: MyWorkObservabilityEvent = {
			event: MY_WORK_ROLLUP_EVENT,
			latencyMs,
			count: nonNegativeCount(input.count),
			errorClass: classifyMyWorkError(input),
		};

		// Reuse the shared bounded sample buffer and nearest-rank percentile
		// implementation used by the existing work-item list health endpoint.
		recordListDuration(latencyMs);
		events.push(event);
		if (events.length > MAX_EVENTS) events.shift();
		try {
			logger(event);
		} catch {
			// Observability must never change the route's response semantics.
		}
		return event;
	};

	return {
		start: () => {
			const startedAt = now();
			return {
				finish: (input = {}) => record({ ...input, startedAt }),
			};
		},
		record,
		getEvents: () => events.slice(),
		getLatencySnapshot: () => getListLatencySnapshot(),
		reset: () => {
			events.length = 0;
			resetListLatencySamplesForTests();
		},
	};
}

export const myWorkObservability = createMyWorkObservability();

export function getMyWorkObservabilityEvents(): readonly MyWorkObservabilityEvent[] {
	return myWorkObservability.getEvents();
}

/** Test-only reset for the process-local telemetry and shared latency samples. */
export function resetMyWorkObservabilityForTests(): void {
	myWorkObservability.reset();
}

export function getMyWorkLatencySnapshot(): WorkItemListLatencySnapshot {
	return myWorkObservability.getLatencySnapshot();
}
