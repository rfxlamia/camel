export type WorkspaceRole = "owner" | "admin" | "member";

export interface Workspace {
	id: number;
	name: string;
	role: WorkspaceRole;
	isPersonal: boolean;
	memberCount: number;
}

export interface WorkspaceMember {
	userId: number;
	username: string;
	displayName: string;
	role: WorkspaceRole;
}

export interface WorkspaceInvite {
	id: number;
	workspaceId: number;
	workspaceName: string;
	role: WorkspaceRole;
}

export interface WorkspaceListResponse {
	workspaces: Workspace[];
	pendingInvites: WorkspaceInvite[];
}

export interface WorkspaceSelectionState {
	activeWorkspaceId: number | null;
	pickerRequired: boolean;
	workspacesReady: boolean;
}

export type SwitchConfirmState =
	| { open: false }
	| { open: true; pendingWorkspaceId: number };

export interface WorkspaceCreateState {
	open: boolean;
	name: string;
	busy: boolean;
	error: string | null;
}
