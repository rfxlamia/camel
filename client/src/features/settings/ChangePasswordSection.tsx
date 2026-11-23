import { useState } from "react";
import { ApiError, api } from "../../api";
import { useShowToast } from "../../shared/ToastContext";

export default function ChangePasswordSection() {
	const showToast = useShowToast();
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isChanging, setIsChanging] = useState(false);

	async function handleChangePassword() {
		if (newPassword.length < 8) {
			const msg = "Password must be at least 8 characters";
			setError(msg);
			showToast(msg, "error");
			return;
		}
		if (confirmPassword !== newPassword) {
			const msg = "Passwords don't match";
			setError(msg);
			showToast(msg, "error");
			return;
		}
		setError(null);
		setIsChanging(true);
		try {
			await api.changePassword(currentPassword, newPassword);
			showToast("Password changed", "success");
			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
		} catch (err: unknown) {
			const msg =
				err instanceof ApiError
					? err.message
					: "Couldn't change password. Try again.";
			setError(msg);
			showToast(msg, "error");
		} finally {
			setIsChanging(false);
		}
	}

	const inputClass = (hasError: boolean) =>
		`w-full rounded-md border px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
			hasError
				? "border-error-500"
				: "border-neutral-300 hover:border-neutral-400"
		}`;

	return (
		<form
			className="space-y-3"
			onSubmit={(e) => {
				e.preventDefault();
				void handleChangePassword();
			}}
		>
			<div>
				<label
					htmlFor="current-password"
					className="block text-sm font-medium text-neutral-700"
				>
					Current password
				</label>
				<input
					id="current-password"
					type="password"
					autoComplete="current-password"
					value={currentPassword}
					onChange={(e) => {
						setCurrentPassword(e.target.value);
						if (error) setError(null);
					}}
					placeholder="Your current password"
					disabled={isChanging}
					className={`mt-1 ${inputClass(false)}`}
				/>
			</div>
			<div>
				<label
					htmlFor="new-password"
					className="block text-sm font-medium text-neutral-700"
				>
					New password
				</label>
				<input
					id="new-password"
					type="password"
					autoComplete="new-password"
					value={newPassword}
					onChange={(e) => {
						setNewPassword(e.target.value);
						if (error) setError(null);
					}}
					placeholder="At least 8 characters"
					disabled={isChanging}
					className={`mt-1 ${inputClass(false)}`}
				/>
			</div>
			<div>
				<label
					htmlFor="confirm-password"
					className="block text-sm font-medium text-neutral-700"
				>
					Confirm new password
				</label>
				<input
					id="confirm-password"
					type="password"
					autoComplete="new-password"
					value={confirmPassword}
					onChange={(e) => {
						setConfirmPassword(e.target.value);
						if (error) setError(null);
					}}
					placeholder="Repeat the new password"
					disabled={isChanging}
					className={`mt-1 ${inputClass(!!error)}`}
				/>
			</div>
			{error && <p className="text-xs text-error-600">{error}</p>}
			<button
				type="submit"
				disabled={
					isChanging || currentPassword.length === 0 || newPassword.length < 8
				}
				className="inline-flex items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
			>
				{isChanging ? "Changing..." : "Change Password"}
			</button>
		</form>
	);
}
