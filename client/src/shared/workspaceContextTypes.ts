import type {
	SettingsMap,
	SwitchConfirmState,
	User,
	Workspace,
	WorkspaceInvite,
} from "../types";
import type { BoardViewMode } from "./boardViewPrefs";

export interface WorkspaceContextValue {
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
