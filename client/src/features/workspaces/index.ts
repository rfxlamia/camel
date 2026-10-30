import { createWorkspacesApi } from "./workspacesApi";

export type {
	SwitchConfirmState,
	Workspace,
	WorkspaceCreateState,
	WorkspaceInvite,
	WorkspaceListResponse,
	WorkspaceMember,
	WorkspacePendingInvite,
	WorkspaceRole,
	WorkspaceSelectionState,
} from "./workspaceTypes";
// Load transport factories before UI re-exports, which can import the facade.
export { createWorkspacesApi };
