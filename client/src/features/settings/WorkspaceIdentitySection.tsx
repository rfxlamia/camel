import { useEffect, useState } from "react";
import { ApiError, api } from "../../api";
import { useShowToast } from "../../shared/ToastContext";
import { useWorkspace } from "../../shared/WorkspaceContext";
import { SettingsSection } from "./SettingsSection";
import {
	canEditWorkspaceSettings,
	validateBoardName,
	validateUnsavedChanges,
	validateWorkspaceName,
} from "./settingsValidation";
import { WorkspaceLogoField } from "./WorkspaceLogoField";

export function WorkspaceIdentitySection() {
	const {
		activeWorkspace,
		activeWorkspaceId,
		settings,
		settingsVersion,
		refreshSettings,
		reloadWorkspaces,
	} = useWorkspace();
	const showToast = useShowToast();
	const canEdit = activeWorkspace
		? canEditWorkspaceSettings(activeWorkspace.role)
		: false;

	const [boardNameInput, setBoardNameInput] = useState(settings.boardName);
	const [nameError, setNameError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);

	const [workspaceNameInput, setWorkspaceNameInput] = useState(
		activeWorkspace?.name ?? "",
	);
	const [workspaceNameError, setWorkspaceNameError] = useState<string | null>(
		null,
	);
	const [isSavingWorkspaceName, setIsSavingWorkspaceName] = useState(false);

	useEffect(() => {
		setBoardNameInput(settings.boardName);
	}, [settings.boardName]);

	useEffect(() => {
		setWorkspaceNameInput(activeWorkspace?.name ?? "");
	}, [activeWorkspace?.name]);

	useEffect(() => {
		const onBeforeUnload = (ev: BeforeUnloadEvent) => {
			if (!canEdit) return;
			const hasBoardChange = validateUnsavedChanges(
				settings.boardName,
				boardNameInput,
			);
			const hasWorkspaceChange =
				activeWorkspace != null &&
				validateUnsavedChanges(activeWorkspace.name, workspaceNameInput);
			if (hasBoardChange || hasWorkspaceChange) {
				ev.preventDefault();
				ev.returnValue = "";
			}
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => window.removeEventListener("beforeunload", onBeforeUnload);
	}, [
		settings.boardName,
		boardNameInput,
		activeWorkspace,
		workspaceNameInput,
		canEdit,
	]);

	const nameVal = validateBoardName(boardNameInput);
	const hasNameChange = validateUnsavedChanges(
		settings.boardName,
		boardNameInput,
	);
	const canSaveName = canEdit && nameVal.valid && hasNameChange && !isSaving;

	const workspaceNameVal = validateWorkspaceName(workspaceNameInput);
	const hasWorkspaceNameChange =
		activeWorkspace != null &&
		validateUnsavedChanges(activeWorkspace.name, workspaceNameInput);
	const canSaveWorkspaceName =
		canEdit &&
		workspaceNameVal.valid &&
		hasWorkspaceNameChange &&
		!isSavingWorkspaceName;

	async function handleSaveWorkspaceName() {
		if (
			!canEdit ||
			activeWorkspaceId === null ||
			!workspaceNameVal.valid ||
			!hasWorkspaceNameChange
		) {
			if (!workspaceNameVal.valid) {
				setWorkspaceNameError(workspaceNameVal.error);
			}
			return;
		}
		setWorkspaceNameError(null);
		setIsSavingWorkspaceName(true);
		try {
			await api.updateWorkspace(activeWorkspaceId, {
				name: workspaceNameVal.trimmed,
			});
			await reloadWorkspaces();
			showToast("Workspace name saved", "success");
		} catch (err: unknown) {
			if (err instanceof ApiError && err.status === 403) {
				showToast(
					"You don't have permission to edit workspace settings",
					"error",
				);
			} else if (err instanceof ApiError && err.status === 400) {
				setWorkspaceNameError(err.message);
				showToast(err.message, "error");
			} else {
				showToast(
					"Couldn't save the workspace name. Check your connection and try again.",
					"error",
				);
			}
		} finally {
			setIsSavingWorkspaceName(false);
		}
	}

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
				showToast(
					"You don't have permission to edit workspace settings",
					"error",
				);
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

	return (
		<SettingsSection title="Identity">
			<div>
				<label
					htmlFor="workspaceName"
					className="block text-sm font-medium text-neutral-700"
				>
					Workspace name
				</label>
				<div className="mt-1 flex gap-2">
					<input
						id="workspaceName"
						type="text"
						value={workspaceNameInput}
						onChange={(e) => {
							setWorkspaceNameInput(e.target.value);
							if (workspaceNameError) setWorkspaceNameError(null);
						}}
						maxLength={100}
						disabled={!canEdit}
						className={`flex-1 rounded-md border px-3 py-2 text-base focus:outline-none disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 ${
							workspaceNameVal.valid
								? "border-neutral-300 focus:border-primary-600"
								: "border-error-500 focus:border-error-500"
						}`}
					/>
					<button
						type="button"
						onClick={handleSaveWorkspaceName}
						disabled={!canSaveWorkspaceName}
						className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
					>
						{isSavingWorkspaceName ? "Saving..." : "Save"}
					</button>
				</div>
				{workspaceNameError && (
					<p className="mt-1 text-sm text-error-600">{workspaceNameError}</p>
				)}
				{!workspaceNameVal.valid &&
					!workspaceNameError &&
					workspaceNameInput.trim() !== "" && (
						<p className="mt-1 text-sm text-error-600">
							{workspaceNameVal.error}
						</p>
					)}
				<p className="mt-1 text-xs text-neutral-500">
					1–100 characters. Shown in the workspace switcher.
				</p>
			</div>

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
					1–15 characters. Saved changes appear in the sidebar and browser tab.
				</p>

				<div className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 text-sm">
					<span className="text-neutral-500">Sidebar preview: </span>
					<span className="font-semibold text-primary-900">
						{nameVal.valid ? nameVal.trimmed : settings.boardName}
					</span>
				</div>
			</div>

			<WorkspaceLogoField />
		</SettingsSection>
	);
}
