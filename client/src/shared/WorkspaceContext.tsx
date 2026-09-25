import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { ApiError, api } from "../api";
import {
	type BoardViewMode,
	readBoardViewMode,
	writeBoardViewMode,
} from "./boardViewPrefs";
import {
	chooseInitialWorkspace,
	clearSavedWorkspaceId,
	persistWorkspaceId,
	readSavedWorkspaceId,
} from "../shared/workspaceSelection";
import {
	applyCreatedWorkspaceSelection,
	FOCUS_BLOCKED_TOAST,
	FOCUS_LOADING_TOAST,
	getSwitchAttemptState,
	persistRemindedInviteIds,
	readRemindedInviteIds,
} from "../shared/workspaceSwitcher";
import type {
	SettingsMap,
	SwitchConfirmState,
	User,
	Workspace,
	WorkspaceInvite,
} from "../types";
import { useShowToast } from "./ToastContext";

interface WorkspaceContextValue {
	user: User;
	activeWorkspaceId: number | null;
	activeWorkspace: Workspace | null;
	workspaces: Workspace[];
	pendingInvites: WorkspaceInvite[];
	pickerRequired: boolean;
	workspacesReady: boolean;
	remindedInviteIds: number[];
	hasUnsavedCardEdits: boolean;
	setHasUnsavedCardEdits: (dirty: boolean) => void;
	switchConfirm: SwitchConfirmState;
	attemptSwitchWorkspace: (workspaceId: number) => void;
	confirmPendingSwitch: () => void;
	cancelPendingSwitch: () => void;
	switchWorkspace: (workspaceId: number) => void;
	reloadWorkspaces: () => Promise<Workspace[]>;
	acceptWorkspaceInvite: (invite: WorkspaceInvite) => Promise<void>;
	declineWorkspaceInvite: (invite: WorkspaceInvite) => Promise<void>;
	remindInviteLater: (invite: WorkspaceInvite) => void;
	openCreateWorkspace: () => void;
	closeCreateWorkspace: () => void;
	createWorkspaceOpen: boolean;
	submitCreateWorkspace: (name: string) => Promise<void>;
	logout: () => Promise<void>;
	/** Immediate local sign-out (no POST /logout). Use for already-rejected sessions (401). */
	signOutLocally: () => void;
	settings: SettingsMap;
	settingsVersion: number;
	refreshSettings: () => Promise<void>;
	ticketIntakeEnabled: boolean;
	focusModeEnabled: boolean;
	boardViewMode: BoardViewMode;
	setBoardViewMode: (mode: BoardViewMode) => void;
	hasActiveFocusSession: boolean;
	setHasActiveFocusSession: (active: boolean) => void;
	focusSessionHydrated: boolean;
	setFocusSessionHydrated: (hydrated: boolean) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
	const ctx = useContext(WorkspaceContext);
	if (!ctx) {
		throw new Error("useWorkspace must be used within WorkspaceProvider");
	}
	return ctx;
}

interface Props {
	user: User;
	onSignedOut: () => void;
	children: ReactNode;
}

export function WorkspaceProvider({ user, onSignedOut, children }: Props) {
	const showToast = useShowToast();
	const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(
		null,
	);
	const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
	const [pendingInvites, setPendingInvites] = useState<WorkspaceInvite[]>([]);
	const [pickerRequired, setPickerRequired] = useState(false);
	const [workspacesReady, setWorkspacesReady] = useState(false);
	const [remindedInviteIds, setRemindedInviteIds] = useState<number[]>(() =>
		readRemindedInviteIds(),
	);
	const [hasUnsavedCardEdits, setHasUnsavedCardEdits] = useState(false);
	const [switchConfirm, setSwitchConfirm] = useState<SwitchConfirmState>({
		open: false,
	});
	const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
	const [settings, setSettings] = useState<SettingsMap>({
		boardName: "Camel",
		logoPath: "/logo.png",
		version: 0,
	});
	const [settingsVersion, setSettingsVersion] = useState(0);
	const [ticketIntakeEnabled, setTicketIntakeEnabled] = useState(false);
	const [focusModeEnabled, setFocusModeEnabled] = useState(false);
	const [hasActiveFocusSession, setHasActiveFocusSession] = useState(false);
	const [focusSessionHydrated, setFocusSessionHydrated] = useState(false);
	const [boardViewMode, setBoardViewModeState] = useState<BoardViewMode>(() =>
		readBoardViewMode(activeWorkspaceId ?? 0),
	);

	const workspacesRef = useRef(workspaces);
	workspacesRef.current = workspaces;
	const activeWorkspaceIdRef = useRef(activeWorkspaceId);
	activeWorkspaceIdRef.current = activeWorkspaceId;
	const hasUnsavedRef = useRef(hasUnsavedCardEdits);
	hasUnsavedRef.current = hasUnsavedCardEdits;
	const hasActiveFocusRef = useRef(hasActiveFocusSession);
	hasActiveFocusRef.current = hasActiveFocusSession;
	const focusSessionHydratedRef = useRef(focusSessionHydrated);
	focusSessionHydratedRef.current = focusSessionHydrated;

	const activeWorkspace =
		activeWorkspaceId === null
			? null
			: (workspaces.find((w) => w.id === activeWorkspaceId) ?? null);

	useEffect(() => {
		let active = true;
		api.ticketIntake
			.getConfig()
			.then(({ enabled }) => {
				if (active) setTicketIntakeEnabled(enabled);
			})
			.catch(() => {
				if (active) setTicketIntakeEnabled(false);
			});
		return () => {
			active = false;
		};
	}, []);

	useEffect(() => {
		let active = true;
		api.focus
			.getConfig()
			.then(({ enabled }) => {
				if (active) setFocusModeEnabled(enabled);
			})
			.catch(() => {
				if (active) setFocusModeEnabled(false);
			});
		return () => {
			active = false;
		};
	}, []);

	useEffect(() => {
		if (activeWorkspaceId === null) return;
		setBoardViewModeState(readBoardViewMode(activeWorkspaceId));
	}, [activeWorkspaceId]);

	const setBoardViewMode = useCallback(
		(mode: BoardViewMode) => {
			if (activeWorkspaceId === null) return;
			setBoardViewModeState(mode);
			writeBoardViewMode(activeWorkspaceId, mode);
		},
		[activeWorkspaceId],
	);

	const signOutLocally = useCallback(() => {
		onSignedOut();
	}, [onSignedOut]);

	const refreshSettings = useCallback(async () => {
		const workspaceId = activeWorkspaceId;
		if (workspaceId === null) return;
		try {
			const s = await api.getSettings(workspaceId);
			// Drop responses that belong to a workspace we already left.
			if (activeWorkspaceIdRef.current !== workspaceId) return;
			setSettings(s);
			setSettingsVersion(s.version);
		} catch (err) {
			if (activeWorkspaceIdRef.current !== workspaceId) return;
			if (err instanceof ApiError && err.status === 401) {
				signOutLocally();
				return;
			}
			console.debug("settings fetch failed", err);
		}
	}, [activeWorkspaceId, signOutLocally]);

	// Enter-load: hydrate settings whenever the active workspace changes.
	useEffect(() => {
		if (activeWorkspaceId === null) return;
		void refreshSettings();
	}, [activeWorkspaceId, refreshSettings]);

	const reloadWorkspaces = useCallback(async () => {
		const { workspaces: list, pendingInvites: invites } =
			await api.getWorkspaces();
		setWorkspaces(list);
		setPendingInvites(invites);
		return list;
	}, []);

	/** Flip active workspace id only — board/presence clear via render-phase reset. */
	const switchWorkspace = useCallback((workspaceId: number) => {
		setHasUnsavedCardEdits(false);
		setSwitchConfirm({ open: false });
		setActiveWorkspaceId(workspaceId);
		persistWorkspaceId(workspaceId);
		setPickerRequired(false);
	}, []);

	const guardFocusBeforeSwitch = useCallback((): boolean => {
		if (!focusSessionHydratedRef.current) {
			showToast(FOCUS_LOADING_TOAST, "warning");
			return false;
		}
		if (hasActiveFocusRef.current) {
			showToast(FOCUS_BLOCKED_TOAST, "warning");
			return false;
		}
		return true;
	}, [showToast]);

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
		[activeWorkspaceId, showToast, switchWorkspace],
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

	const remindInviteLater = useCallback((invite: WorkspaceInvite) => {
		setRemindedInviteIds((prev) => {
			if (prev.includes(invite.id)) return prev;
			const next = [...prev, invite.id];
			persistRemindedInviteIds(next);
			return next;
		});
	}, []);

	const openCreateWorkspace = useCallback(() => {
		setCreateWorkspaceOpen(true);
	}, []);

	const closeCreateWorkspace = useCallback(() => {
		setCreateWorkspaceOpen(false);
	}, []);

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
		[reloadWorkspaces, showToast, switchWorkspace, guardFocusBeforeSwitch],
	);

	useEffect(() => {
		let active = true;
		void (async () => {
			try {
				const { workspaces: list, pendingInvites: invites } =
					await api.getWorkspaces();
				if (!active) return;
				const selection = chooseInitialWorkspace({
					workspaces: list,
					savedWorkspaceId: readSavedWorkspaceId(),
				});
				if (selection.clearSavedWorkspace) clearSavedWorkspaceId();
				setWorkspaces(list);
				setPendingInvites(invites);
				setPickerRequired(selection.pickerRequired);
				if (selection.activeWorkspaceId !== null) {
					setActiveWorkspaceId(selection.activeWorkspaceId);
					persistWorkspaceId(selection.activeWorkspaceId);
				}
			} catch (err) {
				if (err instanceof ApiError && err.status === 401) {
					onSignedOut();
					return;
				}
			} finally {
				if (active) setWorkspacesReady(true);
			}
		})();
		return () => {
			active = false;
		};
	}, [onSignedOut]);

	const logout = useCallback(async () => {
		try {
			await api.logout();
		} catch {
			// session cookie is gone either way
		}
		onSignedOut();
	}, [onSignedOut]);

	return (
		<WorkspaceContext.Provider
			value={{
				user,
				activeWorkspaceId,
				activeWorkspace,
				workspaces,
				pendingInvites,
				pickerRequired,
				workspacesReady,
				remindedInviteIds,
				hasUnsavedCardEdits,
				setHasUnsavedCardEdits,
				switchConfirm,
				attemptSwitchWorkspace,
				confirmPendingSwitch,
				cancelPendingSwitch,
				switchWorkspace,
				reloadWorkspaces,
				acceptWorkspaceInvite,
				declineWorkspaceInvite,
				remindInviteLater,
				openCreateWorkspace,
				closeCreateWorkspace,
				createWorkspaceOpen,
				submitCreateWorkspace,
				logout,
				signOutLocally,
				settings,
				settingsVersion,
				refreshSettings,
				ticketIntakeEnabled,
				focusModeEnabled,
				boardViewMode,
				setBoardViewMode,
				hasActiveFocusSession,
				setHasActiveFocusSession,
				focusSessionHydrated,
				setFocusSessionHydrated,
			}}
		>
			{children}
		</WorkspaceContext.Provider>
	);
}
