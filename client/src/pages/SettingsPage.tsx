import { useState } from "react";
import {
	canEditWorkspaceSettings,
	DangerZoneSection,
	InviteMemberSection,
	LeaveWorkspaceSection,
	ManageMembersSection,
	RecoveryPasswordSection,
	SettingsSection,
	WorkspaceIdentitySection,
} from "../features/settings";
import { useShowToast } from "../shared/ToastContext";
import { useWorkspace } from "../shared/WorkspaceContext";

export default function SettingsPage() {
	const { user, activeWorkspaceId, activeWorkspace, reloadWorkspaces } =
		useWorkspace();
	const showToast = useShowToast();

	const [membersRefreshKey, setMembersRefreshKey] = useState(0);

	const canEdit = activeWorkspace
		? canEditWorkspaceSettings(activeWorkspace.role)
		: false;

	if (activeWorkspaceId === null || !activeWorkspace) {
		return (
			<div className="p-6">
				<p className="text-neutral-600">Select a workspace to view settings.</p>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-2xl p-6">
			<h1 className="mb-6 text-2xl font-semibold text-neutral-900">Settings</h1>

			{!canEdit && (
				<p className="mb-4 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
					Only workspace owners and admins can edit settings.
				</p>
			)}

			<InviteMemberSection
				onInvited={() => setMembersRefreshKey((k) => k + 1)}
			/>

			{user && (
				<SettingsSection title="Manage Members">
					<ManageMembersSection
						workspaceId={activeWorkspaceId}
						currentUserId={user.id}
						currentUserRole={activeWorkspace.role}
						refreshKey={membersRefreshKey}
						onMembersChanged={() => void reloadWorkspaces()}
						showToast={showToast}
					/>
				</SettingsSection>
			)}

			<LeaveWorkspaceSection />

			<WorkspaceIdentitySection />

			<RecoveryPasswordSection />

			<DangerZoneSection />
		</div>
	);
}
