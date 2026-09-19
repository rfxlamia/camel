import { useState, useSyncExternalStore } from "react";
import type { MyWorkItem } from "../../shared/myWorkTypes";
import {
	getMyWorkMutationSnapshot,
	type MyWorkMutationSnapshot,
	markWorkItemDone,
	myWorkMutationIdentity,
	subscribeToMyWorkMutations,
} from "../../shared/workItemMutations";
import {
	type ActionState,
	buildActionController,
	createMutationClickHandler,
	type MyWorkDoneFeedback,
	type MyWorkDoneMutation,
} from "./myWorkDoneActionState";

export type {
	MyWorkDoneFeedback,
	MyWorkDoneMutation,
} from "./myWorkDoneActionState";
export {
	isUnavailableError,
	isVersionConflict,
	unavailableReason,
} from "./myWorkDoneActionState";

export interface MyWorkDoneActionControllerOptions {
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
}

export interface MyWorkDoneActionController {
	identity: string;
	reasonId: string;
	handleClick: () => void;
	inFlight: boolean;
	completed: boolean;
	hideButton: boolean;
	disabledReason: string | null;
	message: MyWorkDoneFeedback | null;
}

const IDENTITY_SEPARATOR = /[^a-zA-Z0-9_-]+/g;

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

export function useMyWorkDoneAction({
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
}: MyWorkDoneActionControllerOptions): MyWorkDoneActionController {
	const snapshot = useMutationSnapshot(item);
	const [state, setState] = useState<ActionState>({ status: "idle" });
	const identity = myWorkMutationIdentity(item);
	const reasonId = `my-work-done-${identity.replace(IDENTITY_SEPARATOR, "-")}`;
	const execute =
		mutation ?? onMarkDone ?? markDone ?? onMutate ?? markWorkItemDone;
	const handleClick = createMutationClickHandler({
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
	});
	return buildActionController({
		item,
		state,
		snapshot,
		pending,
		identity,
		reasonId,
		handleClick,
	});
}
