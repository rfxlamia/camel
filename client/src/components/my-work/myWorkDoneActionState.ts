import {
	beginMyWorkMutation,
	getMyWorkMutationSnapshot,
	type MyWorkMutationSnapshot,
	mergeMyWorkMutationResult,
	settleMyWorkMutation,
} from "../../lib/workItemMutations";
import type { MyWorkItem } from "../../types/myWork";

export type MyWorkDoneMutation = (
	workspaceId: number,
	item: MyWorkItem,
	version: number,
) => Promise<MyWorkItem>;

type ActionState =
	| { status: "idle" }
	| { status: "pending" }
	| { status: "success"; item: MyWorkItem }
	| { status: "failure"; unavailable: boolean; error: unknown };

export type MyWorkDoneFeedback = {
	kind: "success" | "warning" | "error";
	message: string;
};

type ErrorField = "status" | "code" | "message";
type ErrorFieldValue = number | string | undefined;

function errorField(error: unknown, field: ErrorField): ErrorFieldValue {
	if (typeof error !== "object" || error === null) return undefined;
	const value = (error as Record<string, unknown>)[field];
	return typeof value === "number" || typeof value === "string"
		? value
		: undefined;
}

function errorStatus(error: unknown): number | null {
	const status = errorField(error, "status");
	return typeof status === "number" && Number.isInteger(status) ? status : null;
}

function errorCode(error: unknown): string | null {
	const code = errorField(error, "code");
	return typeof code === "string" ? code.toLowerCase() : null;
}

function errorMessage(error: unknown): string | null {
	const message = errorField(error, "message");
	return typeof message === "string" && message.trim() ? message : null;
}

export function isUnavailableError(error: unknown): boolean {
	return errorStatus(error) === 404 || errorCode(error) === "not_found";
}

export function isVersionConflict(error: unknown): boolean {
	const code = errorCode(error);
	return (
		errorStatus(error) === 409 &&
		(code === "version_conflict" || code === "conflict")
	);
}

export function unavailableReason(item: MyWorkItem): string | null {
	if (item.canMarkDone === true && item.markDoneReason === null) return null;
	switch (item.markDoneReason) {
		case "missing_done_mapping":
			return "Mark done is unavailable because no done mapping or done status is configured for this workspace.";
		case "terminal":
			return "Mark done is unavailable because this item is already in a terminal state.";
		case "pending":
			return "Mark done is unavailable because another Mark done request is pending/in progress.";
		default:
			return "Mark done is unavailable for this item.";
	}
}

function invokeCallback<T extends unknown[]>(
	callback: ((...args: T) => void | Promise<void>) | undefined,
	...args: T
): void {
	if (!callback) return;
	try {
		void Promise.resolve(callback(...args)).catch(() => {
			// Presentation callbacks cannot change the mutation outcome.
		});
	} catch {
		// Presentation callbacks cannot change the mutation outcome.
	}
}

async function refreshSafely(
	onRefresh: (() => void | Promise<void>) | undefined,
): Promise<void> {
	if (!onRefresh) return;
	try {
		await onRefresh();
	} catch {
		// Keep the mutation error visible when refresh itself fails.
	}
}

type MutationRun = {
	item: MyWorkItem;
	sequence: number;
	execute: MyWorkDoneMutation;
	setState: (state: ActionState) => void;
	onSuccess?: (item: MyWorkItem) => void | Promise<void>;
	onRollback?: (item: MyWorkItem, error: unknown) => void | Promise<void>;
	onRefresh?: () => void | Promise<void>;
	onUnavailable?: (item: MyWorkItem, error: unknown) => void | Promise<void>;
};

async function runMutation({
	item,
	sequence,
	execute,
	setState,
	onSuccess,
	onRollback,
	onRefresh,
	onUnavailable,
}: MutationRun): Promise<void> {
	try {
		const response = await execute(item.workspaceId, item, item.version);
		const updated = mergeMyWorkMutationResult(item, response);
		if (!settleMyWorkMutation(item, sequence, "success", updated)) return;
		setState({ status: "success", item: updated });
		invokeCallback(onSuccess, updated);
	} catch (error: unknown) {
		const unavailable = isUnavailableError(error);
		if (
			!settleMyWorkMutation(
				item,
				sequence,
				unavailable ? "unavailable" : "failure",
				item,
				error,
			)
		)
			return;
		setState({ status: "failure", unavailable, error });
		if (unavailable) invokeCallback(onUnavailable, item, error);
		else invokeCallback(onRollback, item, error);
		await refreshSafely(onRefresh);
	}
}

function feedback(state: ActionState): MyWorkDoneFeedback | null {
	if (state.status === "success")
		return { kind: "success", message: "Marked done." };
	if (state.status !== "failure") return null;
	if (state.unavailable)
		return {
			kind: "warning",
			message: "This work item is no longer assigned to you.",
		};
	if (isVersionConflict(state.error)) {
		return {
			kind: "warning",
			message: "Someone else updated this item first — refreshed.",
		};
	}
	return {
		kind: "error",
		message:
			errorMessage(state.error) ??
			"Couldn't mark this work done. Check your connection and try again.",
	};
}

function visibleActionState(
	state: ActionState,
	snapshot: MyWorkMutationSnapshot | undefined,
): ActionState {
	return state.status === "idle" && snapshot?.status === "failure"
		? { status: "failure", unavailable: false, error: snapshot.error }
		: state;
}

function disabledReason(
	item: MyWorkItem,
	state: ActionState,
	inFlight: boolean,
	completed: boolean,
): string | null {
	if (state.status === "failure" && state.unavailable) {
		return "Mark done is unavailable because this item is no longer assigned to you.";
	}
	if (completed)
		return "Mark done is unavailable because this item is already done.";
	return (
		unavailableReason(item) ??
		(inFlight
			? "Mark done is unavailable because another Mark done request is in progress."
			: null)
	);
}

type MutationClickOptions = {
	item: MyWorkItem;
	identity: string;
	pending: boolean;
	state: ActionState;
	setState: (state: ActionState) => void;
	execute: MyWorkDoneMutation;
	onOptimisticRemove?: (item: MyWorkItem) => void;
	onSuccess?: (item: MyWorkItem) => void | Promise<void>;
	onRollback?: (item: MyWorkItem, error: unknown) => void | Promise<void>;
	onRefresh?: () => void | Promise<void>;
	onUnavailable?: (item: MyWorkItem, error: unknown) => void | Promise<void>;
};

export function createMutationClickHandler({
	item,
	identity,
	pending,
	state,
	setState,
	execute,
	onOptimisticRemove,
	onSuccess,
	onRollback,
	onRefresh,
	onUnavailable,
}: MutationClickOptions): () => void {
	return () => {
		const current = getMyWorkMutationSnapshot(identity);
		if (
			pending ||
			state.status === "pending" ||
			state.status === "success" ||
			current?.status === "pending" ||
			unavailableReason(item) !== null
		)
			return;
		const sequence = beginMyWorkMutation(item);
		setState({ status: "pending" });
		invokeCallback(onOptimisticRemove, item);
		void runMutation({
			item,
			sequence,
			execute,
			setState,
			onSuccess,
			onRollback,
			onRefresh,
			onUnavailable,
		});
	};
}

type ControllerStateOptions = {
	item: MyWorkItem;
	state: ActionState;
	snapshot: MyWorkMutationSnapshot | undefined;
	pending: boolean;
	identity: string;
	reasonId: string;
	handleClick: () => void;
};

export function buildActionController({
	item,
	state,
	snapshot,
	pending,
	identity,
	reasonId,
	handleClick,
}: ControllerStateOptions) {
	const visibleState = visibleActionState(state, snapshot);
	const inFlight =
		pending ||
		visibleState.status === "pending" ||
		snapshot?.status === "pending";
	const completed = visibleState.status === "success";
	return {
		identity,
		reasonId,
		handleClick,
		inFlight,
		completed,
		hideButton: completed || item.markDoneReason === "terminal",
		disabledReason: disabledReason(item, visibleState, inFlight, completed),
		message: feedback(visibleState),
	};
}

export type { ActionState };
