import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { MyWorkItem } from "../shared/myWorkTypes";
import { useWorkspace } from "../shared/WorkspaceContext";
import {
	getSwitchAttemptState,
	type SwitchAttemptInput,
	type SwitchAttemptState,
} from "../shared/workspaceSwitcher";

export interface MyWorkSourceNavigation {
	to: string;
	workspaceId: number;
	guardState: SwitchAttemptState;
}

/** Plan an explicit source transition using the existing workspace guard state. */
export function planMyWorkSourceNavigation(
	item: Pick<MyWorkItem, "id" | "key" | "source" | "workspaceId">,
	context: SwitchAttemptInput,
): MyWorkSourceNavigation {
	return {
		to: getMyWorkSourcePath(item),
		workspaceId: item.workspaceId,
		guardState: getSwitchAttemptState(context),
	};
}

export function getMyWorkSourcePath(
	item: Pick<MyWorkItem, "id" | "key" | "source">,
): string {
	return item.source === "board"
		? `/board/card/${item.id}`
		: `/tracker/${encodeURIComponent(item.key)}`;
}

interface PendingSourceNavigation {
	to: string;
	workspaceId: number;
	confirmationRequired: boolean;
}

function usePendingSourceTransition(
	pending: PendingSourceNavigation | null,
	setPending: (value: PendingSourceNavigation | null) => void,
	activeWorkspaceId: number | null,
	switchConfirm: { open: boolean },
	navigate: (to: string) => void,
) {
	const confirmationObservedRef = useRef(false);
	useEffect(() => {
		if (!pending) return;
		if (activeWorkspaceId === pending.workspaceId) {
			setPending(null);
			confirmationObservedRef.current = false;
			navigate(pending.to);
			return;
		}
		if (pending.confirmationRequired && switchConfirm.open) {
			confirmationObservedRef.current = true;
		} else if (
			pending.confirmationRequired &&
			confirmationObservedRef.current
		) {
			setPending(null);
			confirmationObservedRef.current = false;
		}
	}, [activeWorkspaceId, navigate, pending, setPending, switchConfirm.open]);
}

interface SourceNavigationRuntime {
	item: MyWorkItem | null;
	activeWorkspaceId: number | null;
	attemptSwitchWorkspace: (workspaceId: number) => void;
	hasUnsavedCardEdits: boolean;
	hasActiveFocusSession: boolean;
	focusSessionHydrated: boolean;
	navigate: (to: string) => void;
	setPending: (value: PendingSourceNavigation | null) => void;
}

function executeMyWorkSourceNavigation({
	item,
	activeWorkspaceId,
	attemptSwitchWorkspace,
	hasUnsavedCardEdits,
	hasActiveFocusSession,
	focusSessionHydrated,
	navigate,
	setPending,
}: SourceNavigationRuntime) {
	if (!item) return;
	const plan = planMyWorkSourceNavigation(item, {
		activeWorkspaceId,
		targetWorkspaceId: item.workspaceId,
		hasUnsavedCardEdits,
		hasActiveFocusSession,
		focusSessionHydrated,
	});
	if (plan.guardState.status === "noop") {
		navigate(plan.to);
		return;
	}
	attemptSwitchWorkspace(item.workspaceId);
	if (
		plan.guardState.status === "switch" ||
		plan.guardState.status === "confirm-required"
	) {
		setPending({
			to: plan.to,
			workspaceId: item.workspaceId,
			confirmationRequired: plan.guardState.status === "confirm-required",
		});
	}
}

/** Execute explicit source navigation only after the existing workspace guard. */
export function useMyWorkSourceNavigation(item: MyWorkItem | null) {
	const navigate = useNavigate();
	const {
		activeWorkspaceId,
		attemptSwitchWorkspace,
		hasUnsavedCardEdits,
		hasActiveFocusSession,
		focusSessionHydrated,
		switchConfirm = { open: false },
	} = useWorkspace();
	const [pending, setPending] = useState<PendingSourceNavigation | null>(null);
	usePendingSourceTransition(
		pending,
		setPending,
		activeWorkspaceId,
		switchConfirm,
		navigate,
	);
	const handleSourceNavigation = useCallback(
		() =>
			executeMyWorkSourceNavigation({
				item,
				activeWorkspaceId,
				attemptSwitchWorkspace,
				hasUnsavedCardEdits,
				hasActiveFocusSession,
				focusSessionHydrated,
				navigate,
				setPending,
			}),
		[
			activeWorkspaceId,
			attemptSwitchWorkspace,
			focusSessionHydrated,
			hasActiveFocusSession,
			hasUnsavedCardEdits,
			item,
			navigate,
		],
	);
	return { handleSourceNavigation, pending: pending !== null };
}
