import { useState } from "react";
import { ApiError, api } from "../../api";
import { useShowToast } from "../../shared/ToastContext";
import { useWorkspace } from "../../shared/WorkspaceContext";
import { SettingsSection } from "./SettingsSection";
import { canEditWorkspaceSettings, getWorkspaceDangerZoneState } from "./settingsValidation";

export function DangerZoneSection() {
	const {
		activeWorkspace,
		activeWorkspaceId,
		refreshSettings,
		reloadWorkspaces,
		switchWorkspace,
	} = useWorkspace();
	const showToast = useShowToast();
	const canEdit = activeWorkspace
		? canEditWorkspaceSettings(activeWorkspace.role)
		: false;
	const dangerZone = activeWorkspace
		? getWorkspaceDangerZoneState({
				role: activeWorkspace.role,
				memberCount: activeWorkspace.memberCount,
				isPersonal: activeWorkspace.isPersonal,
			})
		: { canDelete: false, reason: null, resetAppVisible: false };

	const [showResetConfirm, setShowResetConfirm] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);

	async function handleResetSettings() {
		if (!canEdit || activeWorkspaceId === null) return;
		setShowResetConfirm(false);
		try {
			await api.resetSettings(activeWorkspaceId);
			await refreshSettings();
			showToast("Settings reset to defaults", "success");
		} catch (err: unknown) {
			if (err instanceof ApiError && err.status === 403) {
				showToast(
					"You don't have permission to edit workspace settings",
					"error",
				);
			} else {
				showToast("Failed to reset settings. Try again.", "error");
			}
		}
	}

	async function handleDeleteWorkspace() {
		if (!dangerZone.canDelete || activeWorkspaceId === null) return;
		setIsDeleting(true);
		try {
			await api.deleteWorkspace(activeWorkspaceId);
			const list = await reloadWorkspaces();
			const fallback = list.find((w) => w.isPersonal) ?? list[0];
			if (fallback) switchWorkspace(fallback.id);
			showToast("Workspace deleted", "success");
		} catch (err: unknown) {
			const msg =
				err instanceof ApiError
					? err.message
					: "Failed to delete workspace. Try again.";
			showToast(msg, "error");
		} finally {
			setIsDeleting(false);
			setShowDeleteConfirm(false);
		}
	}

	if (!canEdit || !activeWorkspace) return null;

	return (
		<>
			<SettingsSection title="Danger Zone" titleClassName="text-error-700">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="min-w-0">
						<div className="font-medium text-neutral-800">Reset Settings</div>
						<div className="text-sm text-neutral-500">
							Revert board name and logo to defaults. Cards and columns are
							not affected.
						</div>
					</div>
					<button
						onClick={() => setShowResetConfirm(true)}
						className="shrink-0 rounded-md border border-error-500 px-3 py-1.5 text-sm font-medium text-error-700 hover:bg-error-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error-500"
					>
						Reset Settings
					</button>
				</div>

				{activeWorkspace.role === "owner" && (
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="min-w-0">
							<div className="font-medium text-neutral-800">
								Delete Workspace
							</div>
							<div className="text-sm text-neutral-500">
								{dangerZone.reason ??
									"Permanently delete this workspace and all its cards, columns, and settings. Cannot be undone."}
							</div>
						</div>
						<button
							onClick={() => setShowDeleteConfirm(true)}
							disabled={!dangerZone.canDelete || isDeleting}
							className="shrink-0 rounded-md bg-error-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-error-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error-500 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
						>
							Delete Workspace
						</button>
					</div>
				)}
			</SettingsSection>

			{showResetConfirm && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
					role="dialog"
					aria-modal="true"
					aria-label="Confirm reset settings"
				>
					<div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
						<p className="font-medium text-neutral-800">
							Reset all settings to defaults?
						</p>
						<p className="mt-1 text-sm text-neutral-500">
							Board name reverts to “Camel”, logo to default. Your cards and
							columns stay intact.
						</p>
						<div className="mt-4 flex gap-2">
							<button
								onClick={() => setShowResetConfirm(false)}
								className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
							>
								Cancel
							</button>
							<button
								onClick={handleResetSettings}
								className="flex-1 rounded-md bg-error-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-error-600"
							>
								Confirm
							</button>
						</div>
					</div>
				</div>
			)}

			{showDeleteConfirm && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
					role="dialog"
					aria-modal="true"
					aria-label="Confirm delete workspace"
				>
					<div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
						<p className="font-medium text-error-700">Delete this workspace?</p>
						<p className="mt-1 text-sm text-neutral-500">
							This permanently deletes {activeWorkspace.name} and all cards,
							columns, and settings in it.
						</p>
						<div className="mt-4 flex gap-2">
							<button
								onClick={() => setShowDeleteConfirm(false)}
								className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
							>
								Cancel
							</button>
							<button
								onClick={handleDeleteWorkspace}
								disabled={isDeleting}
								className="flex-1 rounded-md bg-error-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-error-600 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
							>
								{isDeleting ? "Deleting..." : "Delete"}
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
