import { useState } from "react";
import { ApiError, api } from "../../api";
import { useShowToast } from "../../shared/ToastContext";
import { useWorkspace } from "../../shared/WorkspaceContext";
import { SettingsSection } from "./SettingsSection";
import { canEditWorkspaceSettings } from "./settingsValidation";

export function InviteMemberSection({
	onInvited,
}: {
	onInvited?: () => void;
}) {
	const { activeWorkspaceId, activeWorkspace, reloadWorkspaces } =
		useWorkspace();
	const showToast = useShowToast();
	const canEdit = activeWorkspace
		? canEditWorkspaceSettings(activeWorkspace.role)
		: false;

	const [inviteUsername, setInviteUsername] = useState("");
	const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
	const [inviteError, setInviteError] = useState<string | null>(null);
	const [isInviting, setIsInviting] = useState(false);

	async function handleInviteMember() {
		if (!canEdit || activeWorkspaceId === null) return;
		const trimmed = inviteUsername.trim();
		if (!trimmed) {
			setInviteError("Username is required");
			return;
		}
		setInviteError(null);
		setIsInviting(true);
		try {
			await api.addWorkspaceMember(activeWorkspaceId, {
				username: trimmed,
				role: inviteRole,
			});
			showToast("Invite sent", "success");
			setInviteUsername("");
			onInvited?.();
			void reloadWorkspaces();
		} catch (err: unknown) {
			if (err instanceof ApiError) {
				setInviteError(err.message);
				showToast(err.message, "error");
			} else {
				const msg = "Couldn't send the invite. Try again.";
				setInviteError(msg);
				showToast(msg, "error");
			}
		} finally {
			setIsInviting(false);
		}
	}

	if (!canEdit) return null;

	return (
		<SettingsSection title="Invite Member">
			<p className="text-sm text-neutral-600 mb-4">
				Add a teammate to this workspace by their username.
			</p>
			<div className="flex flex-col sm:flex-row gap-3">
				<div className="flex-1">
					<input
						type="text"
						value={inviteUsername}
						onChange={(e) => {
							setInviteUsername(e.target.value);
							setInviteError(null);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") handleInviteMember();
						}}
						placeholder="Username"
						disabled={isInviting}
						className={`w-full rounded-md border px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
							inviteError
								? "border-error-500"
								: "border-neutral-300 hover:border-neutral-400"
						}`}
					/>
					{inviteError && (
						<p className="mt-1 text-xs text-error-600">{inviteError}</p>
					)}
				</div>
				<div className="relative">
					<select
						value={inviteRole}
						onChange={(e) =>
							setInviteRole(e.target.value as "member" | "admin")
						}
						disabled={isInviting}
						className="w-full appearance-none rounded-md border border-neutral-300 bg-white pl-3 pr-10 py-2 text-sm text-neutral-900 shadow-sm hover:border-neutral-400 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-600/15 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 sm:w-auto"
					>
						<option value="member">Member</option>
						<option value="admin">Admin</option>
					</select>
					<div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
						<svg
							className="h-5 w-5 text-neutral-400"
							viewBox="0 0 20 20"
							fill="currentColor"
							aria-hidden="true"
						>
							<path
								fillRule="evenodd"
								d="M10 3a.75.75 0 01.55.24l3.25 3.5a.75.75 0 11-1.1 1.02L10 4.852 7.3 7.76a.75.75 0 01-1.1-1.02l3.25-3.5A.75.75 0 0110 3zm-3.76 9.2a.75.75 0 011.06.04l2.7 2.908 2.7-2.908a.75.75 0 111.1 1.02l-3.25 3.5a.75.75 0 01-1.1 0l-3.25-3.5a.75.75 0 01.04-1.06z"
								clipRule="evenodd"
							/>
						</svg>
					</div>
				</div>
				<button
					type="button"
					onClick={handleInviteMember}
					disabled={isInviting || !inviteUsername.trim()}
					className="inline-flex items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					{isInviting ? "Sending..." : "Invite"}
				</button>
			</div>
		</SettingsSection>
	);
}
