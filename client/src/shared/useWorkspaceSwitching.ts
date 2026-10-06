import {
	type Dispatch,
	type MutableRefObject,
	type SetStateAction,
	useCallback,
	useState,
} from "react";
import { ApiError, api } from "../api";
import { persistWorkspaceId } from "../shared/workspaceSelection";
import {
	applyCreatedWorkspaceSelection,
	FOCUS_BLOCKED_TOAST,
	FOCUS_LOADING_TOAST,
	getSwitchAttemptState,
	persistRemindedInviteIds,
} from "../shared/workspaceSwitcher";
import type { SwitchConfirmState, Workspace, WorkspaceInvite } from "../types";
import type { ShowToast } from "./ToastContext";

interface Options {
	showToast: ShowToast;
	activeWorkspaceId: number | null;
	activeWorkspaceIdRef: MutableRefObject<number | null>;
	workspacesRef: MutableRefObject<Workspace[]>;
	hasUnsavedRef: MutableRefObject<boolean>;
	hasActiveFocusRef: MutableRefObject<boolean>;
	focusSessionHydratedRef: MutableRefObject<boolean>;
	reloadWorkspaces: () => Promise<Workspace[]>;
	setHasUnsavedCardEdits: (dirty: boolean) => void;
	setActiveWorkspaceId: (id: number) => void;
	setPickerRequired: (required: boolean) => void;
	setRemindedInviteIds: Dispatch<SetStateAction<number[]>>;
	setCreateWorkspaceOpen: (open: boolean) => void;
}

/** Workspace switching, invite handling and workspace creation. */
export function useWorkspaceSwitching({
	showToast,
	activeWorkspaceId,
	activeWorkspaceIdRef,
	workspacesRef,
	hasUnsavedRef,
	hasActiveFocusRef,
	focusSessionHydratedRef,
	reloadWorkspaces,
	setHasUnsavedCardEdits,
	setActiveWorkspaceId,
	setPickerRequired,
	setRemindedInviteIds,
	setCreateWorkspaceOpen,
}: Options) {
	const [switchConfirm, setSwitchConfirm] = useState<SwitchConfirmState>({
		open: false,
	});

	/** Flip active workspace id only — board/presence clear via render-phase reset. */
	const switchWorkspace = useCallback(
		(workspaceId: number) => {
			setHasUnsavedCardEdits(false);
			setSwitchConfirm({ open: false });
			setActiveWorkspaceId(workspaceId);
			persistWorkspaceId(workspaceId);
			setPickerRequired(false);
		},
		[setHasUnsavedCardEdits, setActiveWorkspaceId, setPickerRequired],
	);

	const guardFocusBeforeSwitch = useCallback((): boolean => {
		// No active workspace (picker) means no focus session to protect.
		if (activeWorkspaceIdRef.current === null) return true;
		if (!focusSessionHydratedRef.current) {
			showToast(FOCUS_LOADING_TOAST, "warning");
			return false;
		}
		if (hasActiveFocusRef.current) {
			showToast(FOCUS_BLOCKED_TOAST, "warning");
			return false;
		}
		return true;
	}, [
		showToast,
		activeWorkspaceIdRef,
		focusSessionHydratedRef,
		hasActiveFocusRef,
	]);

	const attemptSwitchWorkspace = useCallback(
		(workspaceId: number) => {
			const state = getSwitchAttemptState({
				activeWorkspaceId,
				targetWorkspaceId: workspaceId,
				hasUnsavedCardEdits: hasUnsavedRef.current,
				hasActiveFocusSession: hasActiveFocusRef.current,
				focusSessionHydrated: focusSessionHydratedRef.current,
			});
			if (state.status === "noop") return;
			if (state.status === "focus-loading") {
				showToast(FOCUS_LOADING_TOAST, "warning");
				return;
			}
			if (state.status === "focus-blocked") {
				showToast(FOCUS_BLOCKED_TOAST, "warning");
				return;
			}
			if (state.status === "confirm-required") {
				setSwitchConfirm({
					open: true,
					pendingWorkspaceId: state.pendingWorkspaceId,
				});
				return;
			}
			switchWorkspace(state.workspaceId);
		},
		[
			activeWorkspaceId,
			showToast,
			switchWorkspace,
			hasUnsavedRef,
			hasActiveFocusRef,
			focusSessionHydratedRef,
		],
	);

	const confirmPendingSwitch = useCallback(() => {
		if (!switchConfirm.open) return;
		const pendingWorkspaceId = switchConfirm.pendingWorkspaceId;
		setSwitchConfirm({ open: false });
		if (!guardFocusBeforeSwitch()) return;
		switchWorkspace(pendingWorkspaceId);
	}, [switchConfirm, switchWorkspace, guardFocusBeforeSwitch]);

	const cancelPendingSwitch = useCallback(() => {
		setSwitchConfirm({ open: false });
	}, []);

	const acceptWorkspaceInvite = useCallback(
		async (invite: WorkspaceInvite) => {
			try {
				await api.acceptInvite(invite.workspaceId, invite.id);
				const list = await reloadWorkspaces();
				if (!guardFocusBeforeSwitch()) return;
				switchWorkspace(
					list.find((w) => w.id === invite.workspaceId)?.id ??
						invite.workspaceId,
				);
			} catch (err) {
				if (err instanceof ApiError && err.status === 409) {
					showToast(
						err.message || "Couldn't accept the invite. Try again.",
						"error",
					);
					return;
				}
				showToast("Couldn't accept the invite. Try again.", "error");
			}
		},
		[reloadWorkspaces, showToast, switchWorkspace, guardFocusBeforeSwitch],
	);

	const declineWorkspaceInvite = useCallback(
		async (invite: WorkspaceInvite) => {
			try {
				await api.declineInvite(invite.workspaceId, invite.id);
				await reloadWorkspaces();
			} catch {
				showToast("Couldn't decline the invite. Try again.", "error");
			}
		},
		[reloadWorkspaces, showToast],
	);

	const remindInviteLater = useCallback(
		(invite: WorkspaceInvite) => {
			setRemindedInviteIds((prev) => {
				if (prev.includes(invite.id)) return prev;
				const next = [...prev, invite.id];
				persistRemindedInviteIds(next);
				return next;
			});
		},
		[setRemindedInviteIds],
	);

	const openCreateWorkspace = useCallback(() => {
		setCreateWorkspaceOpen(true);
	}, [setCreateWorkspaceOpen]);

	const closeCreateWorkspace = useCallback(() => {
		setCreateWorkspaceOpen(false);
	}, [setCreateWorkspaceOpen]);

	const submitCreateWorkspace = useCallback(
		async (name: string) => {
			const trimmed = name.trim();
			if (!trimmed) return;
			try {
				const prevIds = workspacesRef.current.map((w) => w.id);
				const created = await api.createWorkspace({ name: trimmed });
				await reloadWorkspaces();
				const selection = applyCreatedWorkspaceSelection({
					currentWorkspaceIds: prevIds,
					createdWorkspace: created,
				});
				setCreateWorkspaceOpen(false);
				if (!guardFocusBeforeSwitch()) return;
				switchWorkspace(selection.activeWorkspaceId);
				showToast(selection.toast, "success");
			} catch {
				showToast("Couldn't create the workspace. Try again.", "error");
			}
		},
		[
			reloadWorkspaces,
			showToast,
			switchWorkspace,
			guardFocusBeforeSwitch,
			workspacesRef,
			setCreateWorkspaceOpen,
		],
	);

	return {
		switchConfirm,
		switchWorkspace,
		attemptSwitchWorkspace,
		confirmPendingSwitch,
		cancelPendingSwitch,
		acceptWorkspaceInvite,
		declineWorkspaceInvite,
		remindInviteLater,
		openCreateWorkspace,
		closeCreateWorkspace,
		submitCreateWorkspace,
	};
}
