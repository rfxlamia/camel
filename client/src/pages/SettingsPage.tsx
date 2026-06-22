import { useEffect, useState } from "react";
import { ApiError, api } from "../api";
import LogoCropper from "../components/LogoCropper";
import { useBoard } from "../context/BoardContext";
import {
	canEditWorkspaceSettings,
	getWorkspaceDangerZoneState,
	validateBoardName,
	validateUnsavedChanges,
} from "../lib/settingsValidation";

/** Collapsible section following creative-brief design tokens */
function SettingsSection({
	title,
	titleClassName = "text-neutral-800",
	defaultOpen = true,
	children,
}: {
	title: string;
	titleClassName?: string;
	defaultOpen?: boolean;
	children: React.ReactNode;
}) {
	const [isOpen, setIsOpen] = useState(defaultOpen);

	return (
		<div className="mb-6 overflow-hidden rounded-lg border border-neutral-200 bg-white">
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				className="flex w-full items-center justify-between px-4 py-3 text-base font-medium text-left hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				aria-expanded={isOpen}
			>
				<span className={titleClassName}>{title}</span>
				<svg
					className={`h-4 w-4 text-neutral-500 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					strokeWidth={2}
					aria-hidden="true"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						d="M19 9l-7 7-7-7"
					/>
				</svg>
			</button>
			{isOpen && (
				<div className="border-t border-neutral-200 p-4 space-y-6">
					{children}
				</div>
			)}
		</div>
	);
}

export default function SettingsPage() {
	const {
		user,
		activeWorkspaceId,
		activeWorkspace,
		settings,
		settingsVersion,
		refreshSettings,
		showToast,
		reloadWorkspaces,
		switchWorkspace,
	} = useBoard();

	const [boardNameInput, setBoardNameInput] = useState(settings.boardName);
	const [nameError, setNameError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);

	const [cropImage, setCropImage] = useState<string | null>(null);
	const [logoError, setLogoError] = useState<string | null>(null);

	const [showResetConfirm, setShowResetConfirm] = useState(false);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);

	// Set password state
	const [newPassword, setNewPassword] = useState("");
	const [passwordError, setPasswordError] = useState<string | null>(null);
	const [isSettingPassword, setIsSettingPassword] = useState(false);

	// Invite member state
	const [inviteUsername, setInviteUsername] = useState("");
	const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
	const [inviteError, setInviteError] = useState<string | null>(null);
	const [isInviting, setIsInviting] = useState(false);

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

	useEffect(() => {
		setBoardNameInput(settings.boardName);
	}, [settings.boardName]);

	useEffect(() => {
		const onBeforeUnload = (ev: BeforeUnloadEvent) => {
			if (
				canEdit &&
				validateUnsavedChanges(settings.boardName, boardNameInput)
			) {
				ev.preventDefault();
				ev.returnValue = "";
			}
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => window.removeEventListener("beforeunload", onBeforeUnload);
	}, [settings.boardName, boardNameInput, canEdit]);

	const nameVal = validateBoardName(boardNameInput);
	const hasNameChange = validateUnsavedChanges(
		settings.boardName,
		boardNameInput,
	);
	const canSaveName = canEdit && nameVal.valid && hasNameChange && !isSaving;

	async function handleSaveName() {
		if (!canEdit || activeWorkspaceId === null || !nameVal.valid) {
			if (!nameVal.valid) setNameError(nameVal.error);
			return;
		}
		setNameError(null);
		setIsSaving(true);
		try {
			await api.updateSettings(activeWorkspaceId, [
				{
					key: "board_name",
					textValue: nameVal.trimmed,
					version: settingsVersion,
				},
			]);
			await refreshSettings();
			showToast("Settings saved", "success");
		} catch (err: unknown) {
			if (err instanceof ApiError && err.code === "version_conflict") {
				showToast("Someone else updated settings first", "warning");
				await refreshSettings();
			} else if (err instanceof ApiError && err.status === 403) {
				showToast("You don't have permission to edit workspace settings", "error");
			} else {
				showToast(
					"Couldn't save the settings. Check your connection and try again.",
					"error",
				);
			}
		} finally {
			setIsSaving(false);
		}
	}

	function handleLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
		if (!canEdit) return;
		setLogoError(null);
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) return;

		if (!/^image\/(png|jpeg)$/.test(file.type)) {
			setLogoError("Only .png and .jpg files are accepted");
			return;
		}
		if (file.size > 10 * 1024 * 1024) {
			setLogoError("File size must be under 10MB");
			return;
		}

		const url = URL.createObjectURL(file);
		setCropImage(url);
	}

	async function handleCroppedLogo(blob: Blob) {
		if (activeWorkspaceId === null) return;
		const urlToRevoke = cropImage;
		setCropImage(null);

		const file = new File([blob], "logo.png", { type: "image/png" });
		try {
			await api.uploadLogo(activeWorkspaceId, file);
			await refreshSettings();
			showToast("Settings saved", "success");
		} catch (err: unknown) {
			const msg =
				err instanceof ApiError
					? err.message
					: "Upload failed. Please try again.";
			setLogoError(msg);
			showToast(msg, "error");
		} finally {
			if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);
		}
	}

	function handleCancelCrop() {
		if (cropImage) URL.revokeObjectURL(cropImage);
		setCropImage(null);
	}

	async function handleResetSettings() {
		if (!canEdit || activeWorkspaceId === null) return;
		setShowResetConfirm(false);
		try {
			await api.resetSettings(activeWorkspaceId);
			await refreshSettings();
			showToast("Settings reset to defaults", "success");
		} catch (err: unknown) {
			if (err instanceof ApiError && err.status === 403) {
				showToast("You don't have permission to edit workspace settings", "error");
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

	async function handleSetPassword() {
		if (newPassword.length < 8) {
			setPasswordError("Password must be at least 8 characters");
			return;
		}
		setPasswordError(null);
		setIsSettingPassword(true);
		try {
			await api.setPassword(newPassword);
			showToast("Password set", "success");
			setNewPassword("");
		} catch (err: unknown) {
			const msg =
				err instanceof ApiError
					? err.message
					: "Couldn't set password. Try again.";
			setPasswordError(msg);
			showToast(msg, "error");
		} finally {
			setIsSettingPassword(false);
		}
	}

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

			{/* Invite Member */}
			{canEdit && (
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
			)}

			{/* Board Name */}
			<SettingsSection title="Identity">
				<div>
					<label
						htmlFor="boardName"
						className="block text-sm font-medium text-neutral-700"
					>
						Board name
					</label>
					<div className="mt-1 flex gap-2">
						<input
							id="boardName"
							type="text"
							value={boardNameInput}
							onChange={(e) => {
								setBoardNameInput(e.target.value);
								if (nameError) setNameError(null);
							}}
							maxLength={15}
							disabled={!canEdit}
							className={`flex-1 rounded-md border px-3 py-2 text-base focus:outline-none disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 ${
								nameVal.valid
									? "border-neutral-300 focus:border-primary-600"
									: "border-error-500 focus:border-error-500"
							}`}
						/>
						<button
							onClick={handleSaveName}
							disabled={!canSaveName}
							className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
						>
							{isSaving ? "Saving..." : "Save"}
						</button>
					</div>
					{nameError && (
						<p className="mt-1 text-sm text-error-600">{nameError}</p>
					)}
					{!nameVal.valid && !nameError && boardNameInput.trim() !== "" && (
						<p className="mt-1 text-sm text-error-600">{nameVal.error}</p>
					)}
					<p className="mt-1 text-xs text-neutral-500">
						1–15 characters. Saved changes appear in the sidebar and browser
						tab.
					</p>

					<div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 text-sm">
						<span className="text-neutral-500">Sidebar preview: </span>
						<span className="font-semibold text-primary-900">
							{nameVal.valid ? nameVal.trimmed : settings.boardName}
						</span>
					</div>
				</div>

				<div>
					<div className="text-sm font-medium text-neutral-700">Logo</div>
					<div className="mt-2 flex items-start gap-4">
						<img
							src={settings.logoPath}
							alt={`${settings.boardName} logo`}
							className="h-16 w-16 shrink-0 rounded border border-neutral-200 bg-white object-contain"
							onError={(e) => {
								(e.currentTarget as HTMLImageElement).src = "/logo.png";
							}}
						/>
						<div className="min-w-0">
							<label
								className={`inline-flex items-center rounded-md border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-700 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-600 ${
									canEdit
										? "cursor-pointer hover:bg-neutral-200"
										: "cursor-not-allowed opacity-60"
								}`}
							>
								Upload new logo
								<input
									type="file"
									accept="image/png,image/jpeg"
									className="sr-only"
									disabled={!canEdit}
									onChange={handleLogoSelect}
								/>
							</label>
							<p className="mt-1 text-xs text-neutral-500">
								PNG or JPG, max 10 MB. Cropped to 1:1 square.
							</p>
							{logoError && (
								<p className="mt-1 text-sm text-error-600">{logoError}</p>
							)}
						</div>
					</div>
				</div>
			</SettingsSection>

			{/* Set Password */}
			{user?.emailVerified && (
				<SettingsSection title="Set a recovery password">
					<p className="text-sm text-neutral-600 mb-4">
						Set a password so you can sign in even if your social provider is
						unavailable.
					</p>
					<div className="flex flex-col sm:flex-row gap-3">
						<div className="flex-1">
							<input
								type="password"
								value={newPassword}
								onChange={(e) => {
									setNewPassword(e.target.value);
									if (passwordError) setPasswordError(null);
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter") handleSetPassword();
								}}
								placeholder="At least 8 characters"
								disabled={isSettingPassword}
								className={`w-full rounded-md border px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
									passwordError
										? "border-error-500"
										: "border-neutral-300 hover:border-neutral-400"
								}`}
							/>
							{passwordError && (
								<p className="mt-1 text-xs text-error-600">{passwordError}</p>
							)}
						</div>
						<button
							type="button"
							onClick={handleSetPassword}
							disabled={isSettingPassword || newPassword.length < 8}
							className="inline-flex items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							{isSettingPassword ? "Setting..." : "Set Password"}
						</button>
					</div>
				</SettingsSection>
			)}

			{canEdit && (
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
			)}

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

			{cropImage && (
				<LogoCropper
					image={cropImage}
					onCropComplete={handleCroppedLogo}
					onCancel={handleCancelCrop}
				/>
			)}
		</div>
	);
}
