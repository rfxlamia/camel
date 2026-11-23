import { useState } from "react";
import { ApiError, api } from "../../api";
import type { User } from "../../types";
import { useShowToast } from "../../shared/ToastContext";
import { useWorkspace } from "../../shared/WorkspaceContext";
import ChangePasswordSection from "./ChangePasswordSection";
import { SettingsSection } from "./SettingsSection";

/** The server adds `hasPassword` on /auth/me; the shared User type doesn't
 * declare it yet, so narrow locally instead of editing the oversized
 * types.ts (FM-RULE-3 300-on-touch). */
type UserWithPasswordFlag = User & { hasPassword?: boolean };

/**
 * Password area of the settings page. Owns both password sections and their
 * gating so SettingsPage stays wiring-only: "Set a recovery password" for
 * email-verified accounts without a local password, "Change password" for
 * accounts that already have one.
 */
export function PasswordSettings() {
	const { user } = useWorkspace();
	const showToast = useShowToast();

	const [newPassword, setNewPassword] = useState("");
	const [passwordError, setPasswordError] = useState<string | null>(null);
	const [isSettingPassword, setIsSettingPassword] = useState(false);

	const userWithPassword = user as UserWithPasswordFlag | undefined;
	const showSet = !!userWithPassword?.emailVerified && !userWithPassword?.hasPassword;
	const showChange = !!userWithPassword?.hasPassword;

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

	if (!user || (!showSet && !showChange)) return null;

	return (
		<>
			{showSet && (
				<SettingsSection title="Set a recovery password">
					<p className="text-sm text-neutral-600 mb-4">
						Set a password so you can sign in even if your social provider is
						unavailable.
					</p>
					<div className="flex flex-col sm:flex-row gap-3">
						<div className="flex-1">
							<input
								type="password"
								autoComplete="new-password"
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
			{showChange && (
				<SettingsSection title="Change password">
					<ChangePasswordSection />
				</SettingsSection>
			)}
		</>
	);
}
