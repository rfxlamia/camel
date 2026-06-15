export interface MigrationUser {
	id: number;
	username: string;
	displayName: string;
}

export interface LegacyWorkspaceMigrationInput {
	workspaceCount: number;
	users: MigrationUser[];
	legacyColumnIds: number[];
	legacyCardIds: number[];
	legacySettingKeys: string[];
}

export interface PlannedWorkspace {
	name: string;
	ownerUserId: number;
	isPersonal: boolean;
}

export interface PlannedMember {
	userId: number;
	role: "owner" | "admin" | "member";
}

export interface LegacyWorkspaceMigrationPlan {
	defaultWorkspace?: PlannedWorkspace;
	defaultMembers?: PlannedMember[];
	personalWorkspaces?: PlannedWorkspace[];
	assignments?: {
		columns: number[];
		cards: number[];
		settings: string[];
	};
	operations: string[];
}

export function planLegacyWorkspaceMigration(
	input: LegacyWorkspaceMigrationInput,
): LegacyWorkspaceMigrationPlan {
	if (input.workspaceCount > 0) {
		return { operations: [] };
	}

	const users = [...input.users].sort((a, b) => a.id - b.id);
	const ownerUserId = users[0]?.id ?? 1;

	return {
		defaultWorkspace: {
			name: "Default Workspace",
			ownerUserId,
			isPersonal: false,
		},
		defaultMembers: users.map((user, index) => ({
			userId: user.id,
			role: index === 0 ? "owner" : "member",
		})),
		personalWorkspaces: users.map((user) => ({
			name: `${user.displayName}'s Workspace`,
			ownerUserId: user.id,
			isPersonal: true,
		})),
		assignments: {
			columns: input.legacyColumnIds,
			cards: input.legacyCardIds,
			settings: input.legacySettingKeys,
		},
		operations: [
			"create_default_workspace",
			"create_personal_workspaces",
			"assign_legacy_data",
		],
	};
}
