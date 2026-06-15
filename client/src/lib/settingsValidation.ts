import type { WorkspaceRole } from "../types";

export function validateBoardName(
	name: string,
): { valid: false; error: string } | { valid: true; trimmed: string } {
	const trimmed = name.trim();
	if (trimmed === "") return { valid: false, error: "Name is required" };
	if (trimmed.length > 15) return { valid: false, error: "Max 15 characters" };
	return { valid: true, trimmed };
}

export function validateUnsavedChanges(
	original: string,
	current: string,
): boolean {
	return original.trim() !== current.trim();
}

export function canEditWorkspaceSettings(role: WorkspaceRole): boolean {
	return role === "owner" || role === "admin";
}

export function getWorkspaceDangerZoneState(input: {
	role: WorkspaceRole;
	memberCount: number;
	isPersonal: boolean;
}): { canDelete: boolean; reason: string | null; resetAppVisible: false } {
	if (input.isPersonal) {
		return {
			canDelete: false,
			reason: "Personal workspaces cannot be deleted",
			resetAppVisible: false,
		};
	}
	if (input.role !== "owner") {
		return { canDelete: false, reason: null, resetAppVisible: false };
	}
	if (input.memberCount > 1) {
		return {
			canDelete: false,
			reason: "Remove all other members before deleting this workspace",
			resetAppVisible: false,
		};
	}
	return { canDelete: true, reason: null, resetAppVisible: false };
}
