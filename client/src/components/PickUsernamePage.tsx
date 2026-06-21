import { type FormEvent, useState } from "react";
import { ApiError, api } from "../api";
import type { User } from "../types";

interface Props {
	onComplete: (user: User) => void;
}

const inputClass =
	"mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 placeholder:text-neutral-500 hover:border-neutral-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)] focus:outline-none";

export default function PickUsernamePage({ onComplete }: Props) {
	const [username, setUsername] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (busy) return;
		const trimmed = username.trim();
		if (!trimmed) {
			setError("Username is required");
			return;
		}
		setError(null);
		setBusy(true);
		try {
			await api.setUsername(trimmed);
			const { user } = await api.me();
			onComplete(user);
		} catch (err) {
			setError(
				err instanceof ApiError
					? err.message
					: "Couldn't set username. Check your connection and try again.",
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="flex min-h-screen items-center justify-center bg-neutral-100 p-4">
			<div className="w-full max-w-sm">
				<div className="mb-6 flex items-baseline justify-center gap-2">
					<img src="/logo.png" alt="Camel" className="inline-block h-6 w-6" />
					<h1 className="text-lg font-semibold text-primary-900">Camel</h1>
				</div>

				<form
					onSubmit={(e) => void submit(e)}
					className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
				>
					<h2 className="text-md font-semibold text-neutral-900">
						Choose your username
					</h2>
					<p className="mt-1 text-sm text-neutral-600">
						Pick a username for your account. This is how teammates will see you
						on the board.
					</p>

					<div className="mt-5 space-y-3">
						<label className="block">
							<span className="text-sm font-medium text-neutral-700">
								Username
							</span>
							<input
								className={inputClass}
								value={username}
								onChange={(e) => {
									setUsername(e.target.value);
									if (error) setError(null);
								}}
								placeholder="Username"
								autoFocus
								required
							/>
						</label>
						{error && (
							<p role="alert" className="text-xs font-medium text-error-900">
								{error}
							</p>
						)}
					</div>

					<button
						type="submit"
						disabled={busy}
						className="mt-5 w-full rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
					>
						{busy ? "Setting..." : "Continue"}
					</button>
				</form>
			</div>
		</div>
	);
}
