import { useState } from "react";
import { ApiError, api } from "../../api";
import { useShowToast } from "../../shared/ToastContext";
import { useWorkspace } from "../../shared/WorkspaceContext";
import LogoCropperComponent from "./LogoCropper";
import { canEditWorkspaceSettings } from "./settingsValidation";

export function WorkspaceLogoField() {
	const { activeWorkspaceId, activeWorkspace, settings, refreshSettings } =
		useWorkspace();
	const showToast = useShowToast();
	const canEdit = activeWorkspace
		? canEditWorkspaceSettings(activeWorkspace.role)
		: false;

	const [cropImage, setCropImage] = useState<string | null>(null);
	const [logoError, setLogoError] = useState<string | null>(null);

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

	return (
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

			{cropImage && (
				<LogoCropperComponent
					image={cropImage}
					onCropComplete={handleCroppedLogo}
					onCancel={handleCancelCrop}
				/>
			)}
		</div>
	);
}
