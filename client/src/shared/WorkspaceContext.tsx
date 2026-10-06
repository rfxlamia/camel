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
	chooseInitialWorkspace,
	clearSavedWorkspaceId,
	persistWorkspaceId,
	readSavedWorkspaceId,
} from "../shared/workspaceSelection";
import { readRemindedInviteIds } from "../shared/workspaceSwitcher";
import type { SettingsMap, User, Workspace, WorkspaceInvite } from "../types";
import {
	type BoardViewMode,
	readBoardViewMode,
	writeBoardViewMode,
} from "./boardViewPrefs";
import { useShowToast } from "./ToastContext";
import { useWorkspaceSwitching } from "./useWorkspaceSwitching";
import type { WorkspaceContextValue } from "./workspaceContextTypes";

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

	const {
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
	} = useWorkspaceSwitching({
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
	});

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
