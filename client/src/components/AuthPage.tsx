import { type FormEvent, useState } from "react";
import { ApiError, api } from "../api";
import type { User } from "../types";

interface Props {
	onAuth: (user: User) => void;
	oauthError?: string | null;
}

const inputClass =
	"mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 placeholder:text-neutral-500 hover:border-neutral-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)] focus:outline-none";

const errorInputClass =
	"mt-1 w-full rounded-md border border-error-500 bg-white px-3 py-2 text-base text-neutral-900 placeholder:text-neutral-500 focus:shadow-[0_0_0_3px_oklch(55%_0.1_25_/_0.15)] focus:outline-none";

export default function AuthPage({ onAuth, oauthError }: Props) {
	const [mode, setMode] = useState<"login" | "register">("login");
	const [username, setUsername] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const switchMode = (next: "login" | "register") => {
		setMode(next);
		setError(null);
	};

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (busy) return;
		setError(null);
		setBusy(true);
		try {
			const { user } =
				mode === "login"
					? await api.login(username.trim(), password)
					: await api.register(username.trim(), password, displayName.trim());
			onAuth(user);
		} catch (err) {
			setError(
				err instanceof ApiError
					? err.message
					: "Couldn't reach the server. Check your connection and try again.",
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
					<span className="text-sm text-neutral-500">Kanban for dev teams</span>
				</div>

				<form
					onSubmit={(e) => void submit(e)}
					className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
				>
					<h2 className="text-md font-semibold text-neutral-900">
						{mode === "login" ? "Sign in" : "Create your account"}
					</h2>
					<p className="mt-1 text-sm text-neutral-600">
						{mode === "login"
							? "Welcome back. Your board's waiting."
							: "Join your team's board in a few seconds. Pending workspace invites appear after you sign in."}
					</p>

					<div className="mt-5 space-y-3">
						<label className="block">
							<span className="text-sm font-medium text-neutral-700">
								Username
							</span>
							<input
								className={error ? errorInputClass : inputClass}
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								placeholder="Username"
								autoComplete="username"
								autoFocus
								required
							/>
						</label>
						{mode === "register" && (
							<label className="block">
								<span className="text-sm font-medium text-neutral-700">
									Display name{" "}
									<span className="font-normal text-neutral-500">
										(optional)
									</span>
								</span>
								<input
									className={inputClass}
									value={displayName}
									onChange={(e) => setDisplayName(e.target.value)}
									placeholder="How teammates see you"
									autoComplete="name"
								/>
							</label>
						)}
						<label className="block">
							<span className="text-sm font-medium text-neutral-700">
								Password
							</span>
							<input
								type="password"
								className={error ? errorInputClass : inputClass}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder={
									mode === "register" ? "At least 8 characters" : "Password"
								}
								autoComplete={
									mode === "login" ? "current-password" : "new-password"
								}
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
						{mode === "login" ? "Sign in" : "Create account"}
					</button>

					<p className="mt-4 text-center text-sm text-neutral-600">
						{mode === "login" ? (
							<>
								New here?{" "}
								<button
									type="button"
									onClick={() => switchMode("register")}
									className="font-medium text-primary-600 hover:text-primary-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
								>
									Create an account
								</button>
							</>
						) : (
							<>
								Already have an account?{" "}
								<button
									type="button"
									onClick={() => switchMode("login")}
									className="font-medium text-primary-600 hover:text-primary-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
								>
									Sign in
								</button>
							</>
						)}
					</p>

					{oauthError && (
						<p role="alert" className="mt-3 text-xs font-medium text-error-900">
							Login cancelled — try again.
						</p>
					)}

					<div className="mt-5 flex items-center gap-3">
						<div className="h-px flex-1 bg-neutral-200" />
						<span className="text-xs text-neutral-500">or</span>
						<div className="h-px flex-1 bg-neutral-200" />
					</div>

					<div className="mt-4 space-y-2">
						<button
							type="button"
							onClick={() => api.startOAuth("google")}
							className="flex w-full items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							aria-label="Sign in with Google"
							tabIndex={0}
						>
							<svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
								<path
									d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
									fill="#4285F4"
								/>
								<path
									d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
									fill="#34A853"
								/>
								<path
									d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
									fill="#FBBC05"
								/>
								<path
									d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
									fill="#EA4335"
								/>
							</svg>
							Sign in with Google
						</button>
						<button
							type="button"
							onClick={() => api.startOAuth("github")}
							className="flex w-full items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							aria-label="Sign in with GitHub"
							tabIndex={0}
						>
							<svg
								className="h-4 w-4"
								viewBox="0 0 24 24"
								fill="#181717"
								aria-hidden="true"
							>
								<path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
							</svg>
							Sign in with GitHub
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
