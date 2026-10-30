import { useState } from "react";
import { ApiError, api } from "../../api";
import { useShowToast } from "../../shared/ToastContext";
import { useWorkspace } from "../../shared/WorkspaceContext";
import { SettingsSection } from "./SettingsSection";

export function RecoveryPasswordSection() {
	const { user } = useWorkspace();
	const showToast = useShowToast();

	const [newPassword, setNewPassword] = useState("");
	const [passwordError, setPasswordError] = useState<string | null>(null);
	const [isSettingPassword, setIsSettingPassword] = useState(false);

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

	if (!user?.emailVerified) return null;

	return (
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
	);
}
