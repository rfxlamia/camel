import { Check, LoaderCircle } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import {
	beginMyWorkMutation,
	getMyWorkMutationSnapshot,
	type MyWorkMutationSnapshot,
	markWorkItemDone,
	mergeMyWorkMutationResult,
	myWorkMutationIdentity,
	settleMyWorkMutation,
	subscribeToMyWorkMutations,
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

export interface MyWorkDoneActionProps {
	item: MyWorkItem;
	mutation?: MyWorkDoneMutation;
	onMarkDone?: MyWorkDoneMutation;
	markDone?: MyWorkDoneMutation;
	onMutate?: MyWorkDoneMutation;
	pending?: boolean;
	onOptimisticRemove?: (item: MyWorkItem) => void;
	onSuccess?: (item: MyWorkItem) => void | Promise<void>;
	onRollback?: (item: MyWorkItem, error: unknown) => void | Promise<void>;
	onRefresh?: () => void | Promise<void>;
	onUnavailable?: (item: MyWorkItem, error: unknown) => void | Promise<void>;
	className?: string;
}

const ACTION_BUTTON =
	"inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-primary-300 bg-white px-2.5 font-medium text-primary-700 text-xs shadow-sm transition-colors hover:bg-primary-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 motion-reduce:transition-none disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-200 disabled:text-neutral-400";
const IDENTITY_SEPARATOR = /[^a-zA-Z0-9_-]+/g;

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
		(code === null || code === "version_conflict" || code === "conflict")
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
function useMutationSnapshot(
	item: MyWorkItem,
): MyWorkMutationSnapshot | undefined {
	const identity = myWorkMutationIdentity(item);
	return useSyncExternalStore(
		subscribeToMyWorkMutations,
		() => getMyWorkMutationSnapshot(identity),
		() => undefined,
	);
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
function feedback(
	state: ActionState,
): { kind: "success" | "warning" | "error"; message: string } | null {
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

/** The single My Work write affordance; all source writes go through the router. */
export default function MyWorkDoneAction({
	item,
	mutation,
	onMarkDone,
	markDone,
	onMutate,
	pending = false,
	onOptimisticRemove,
	onSuccess,
	onRollback,
	onRefresh,
	onUnavailable,
	className = "",
}: MyWorkDoneActionProps) {
	const snapshot = useMutationSnapshot(item);
	const [state, setState] = useState<ActionState>({ status: "idle" });
	const identity = myWorkMutationIdentity(item);
	const reasonId = `my-work-done-${identity.replace(IDENTITY_SEPARATOR, "-")}`;
	const handleClick = () => {
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
			execute:
				mutation ?? onMarkDone ?? markDone ?? onMutate ?? markWorkItemDone,
			setState,
			onSuccess,
			onRollback,
			onRefresh,
			onUnavailable,
		});
	};
	const visibleState: ActionState =
		state.status === "idle" && snapshot?.status === "failure"
			? { status: "failure", unavailable: false, error: snapshot.error }
			: state;
	const inFlight =
		pending ||
		visibleState.status === "pending" ||
		snapshot?.status === "pending";
	const completed = visibleState.status === "success";
	const disabledReason =
		visibleState.status === "failure" && visibleState.unavailable
			? "Mark done is unavailable because this item is no longer assigned to you."
			: completed
				? "Mark done is unavailable because this item is already done."
				: (unavailableReason(item) ??
					(inFlight
						? "Mark done is unavailable because another Mark done request is in progress."
						: null));
	const message = feedback(visibleState);
	return (
		<span
			className={`inline-flex min-w-0 flex-col items-end gap-1 ${className}`}
		>
			<button
				type="button"
				onClick={handleClick}
				disabled={disabledReason !== null}
				aria-label="Mark done"
				aria-describedby={reasonId}
				data-testid={`my-work-done-action-${identity.replace(IDENTITY_SEPARATOR, "-")}`}
				className={ACTION_BUTTON}
			>
				{inFlight ? (
					<LoaderCircle
						size={14}
						className="animate-spin motion-reduce:animate-none"
						aria-hidden
					/>
				) : (
					<Check size={14} aria-hidden />
				)}
				{completed ? "Done" : "Mark done"}
			</button>
			<span
				id={reasonId}
				role={disabledReason ? "note" : undefined}
				className={`max-w-56 text-right text-[11px] leading-snug ${disabledReason ? "text-neutral-600" : "sr-only"}`}
			>
				{disabledReason ?? "Marks this work item done."}
			</span>
			{message && (
				<span
					role={message.kind === "success" ? "status" : "alert"}
					className={`text-[11px] ${message.kind === "success" ? "text-success-900" : message.kind === "warning" ? "text-warning-900" : "text-error-900"}`}
				>
					{message.message}
				</span>
			)}
		</span>
	);
}
