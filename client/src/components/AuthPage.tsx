import {
	ArrowRight,
	AtSign,
	Check,
	Eye,
	EyeOff,
	GitBranch,
	Lock,
	User,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { ApiError, api } from "../api";
import type { User as AuthUser } from "../types";

interface Props {
	onAuth: (user: AuthUser) => void;
	oauthError?: string | null;
	initialMode?: "login" | "register";
}

// Input wrapper: leading icon + token-driven field. Error state mirrors the
// brief's Input/Error spec (error-500 border + 3px error ring on focus).
const fieldBase =
	"w-full rounded-md border bg-white py-2.5 pl-10 pr-3 text-base text-neutral-900 placeholder:text-neutral-500 focus:outline-none transition-shadow";
const fieldOk =
	"border-neutral-300 hover:border-neutral-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)]";
const fieldErr =
	"border-error-500 focus:shadow-[0_0_0_3px_oklch(55%_0.1_25_/_0.15)]";

export default function AuthPage({
	onAuth,
	oauthError,
	initialMode = "login",
}: Props) {
	const [mode, setMode] = useState<"login" | "register">(initialMode);
	const [username, setUsername] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const isLogin = mode === "login";

	const switchMode = (next: "login" | "register") => {
		if (next === mode) return;
		setMode(next);
		setError(null);
	};

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (busy) return;
		setError(null);
		setBusy(true);
		try {
			const { user } = isLogin
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
		<div className="grid min-h-screen lg:grid-cols-2">
			{/* ── Showcase (static, calm depth) — hidden on small screens ── */}
			<aside className="auth-showcase relative hidden flex-col justify-between overflow-hidden p-12 text-primary-100 lg:flex">
				<div
					className="board-canvas absolute inset-0 opacity-[0.07]"
					aria-hidden
				/>

				{/* Wordmark → home */}
				<a
					href="/"
					className="auth-enter relative flex items-center gap-2.5 self-start rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-400"
					style={{ animationDelay: "40ms" }}
					aria-label="Camel — back to home"
				>
					<img src="/logo.png" alt="" className="h-8 w-8" />
					<span className="text-md font-bold tracking-tight text-white">
						Camel
					</span>
				</a>

				{/* Center: headline + a crisp static product visual */}
				<div className="relative max-w-md">
					<h2
						className="auth-enter text-2xl font-bold leading-[1.12] tracking-tight text-white"
						style={{ animationDelay: "120ms" }}
					>
						The board that moves the work forward,{" "}
						<span className="text-accent-400">calmly.</span>
					</h2>
					<p
						className="auth-enter mt-4 text-base leading-relaxed text-primary-200"
						style={{ animationDelay: "200ms" }}
					>
						WIP limits that hold, live flow metrics, and real-time presence —
						for small dev teams that want a steady pace.
					</p>

					{/* Static mini-board: a "look how organized this is" demo. */}
					<div
						className="auth-enter mt-9 rounded-xl border border-primary-700 bg-primary-800/50 p-4 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.7)] backdrop-blur-sm"
						style={{ animationDelay: "300ms" }}
						aria-hidden
					>
						<div className="grid grid-cols-3 gap-2.5">
							{[
								{ label: "To do", cards: 2, tone: "bg-primary-600" },
								{ label: "Doing", cards: 1, tone: "bg-accent-500" },
								{ label: "Done", cards: 2, tone: "bg-success-500" },
							].map((col) => (
								<div key={col.label}>
									<div className="mb-2 flex items-center justify-between">
										<span className="text-[10px] font-semibold uppercase tracking-wide text-primary-300">
											{col.label}
										</span>
										<span className={`h-1.5 w-1.5 rounded-full ${col.tone}`} />
									</div>
									<div className="space-y-1.5">
										{Array.from({ length: col.cards }).map((_, i) => (
											<div
												key={`${col.label}-${i}`}
												className="rounded-md border border-primary-700 bg-primary-900/70 px-2 py-1.5"
											>
												<div className="h-1.5 w-full rounded-full bg-primary-700" />
												<div className="mt-1.5 h-1.5 w-2/3 rounded-full bg-primary-700/60" />
											</div>
										))}
									</div>
								</div>
							))}
						</div>
					</div>
				</div>

				{/* Bottom: trust signals + the single sanctioned live pulse */}
				<div
					className="auth-enter relative flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-primary-200"
					style={{ animationDelay: "380ms" }}
				>
					<span className="inline-flex items-center gap-2">
						<span className="pulse-dot relative inline-flex h-2 w-2 rounded-full bg-success-500" />
						Real-time presence
					</span>
					<span className="inline-flex items-center gap-1.5">
						<GitBranch className="h-3.5 w-3.5" /> GitHub-friendly
					</span>
					<span className="inline-flex items-center gap-1.5">
						<Check className="h-3.5 w-3.5" /> Free to self-host
					</span>
				</div>
			</aside>

			{/* ── Form ─────────────────────────────────────────────────── */}
			<main className="relative flex items-center justify-center bg-neutral-100 px-5 py-12">
				<div
					className="auth-enter w-full max-w-sm"
					style={{ animationDelay: "80ms" }}
				>
					{/* Mobile wordmark (showcase is hidden < lg) */}
					<a
						href="/"
						className="mb-8 flex items-center gap-2 lg:hidden"
						aria-label="Camel — back to home"
					>
						<img src="/logo.png" alt="" className="h-7 w-7" />
						<span className="text-md font-bold tracking-tight text-primary-900">
							Camel
						</span>
					</a>

					<h1 className="text-xl font-bold tracking-tight text-neutral-900">
						{isLogin ? "Welcome back" : "Create your account"}
					</h1>
					<p className="mt-2 text-base text-neutral-600">
						{isLogin
							? "Sign in — your board's waiting."
							: "Join your team's board in a few seconds."}
					</p>

					{/* Segmented mode toggle */}
					<div
						className="relative mt-7 grid grid-cols-2 rounded-lg border border-neutral-200 bg-neutral-100 p-1"
						role="tablist"
						aria-label="Sign in or create an account"
					>
						<span
							className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-md bg-white shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
								isLogin ? "translate-x-0" : "translate-x-full"
							}`}
							aria-hidden
						/>
						<button
							type="button"
							role="tab"
							aria-selected={isLogin}
							onClick={() => switchMode("login")}
							className={`relative z-10 rounded-md py-1.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
								isLogin ? "text-primary-800" : "text-neutral-600"
							}`}
						>
							Sign in
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={!isLogin}
							onClick={() => switchMode("register")}
							className={`relative z-10 rounded-md py-1.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
								!isLogin ? "text-primary-800" : "text-neutral-600"
							}`}
						>
							Create account
						</button>
					</div>

					<form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4">
						<label className="block">
							<span className="text-sm font-medium text-neutral-700">
								Username
							</span>
							<div className="relative mt-1.5">
								<AtSign
									className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
									aria-hidden
								/>
								<input
									className={`${fieldBase} ${error ? fieldErr : fieldOk}`}
									value={username}
									onChange={(e) => setUsername(e.target.value)}
									placeholder="Username"
									autoComplete="username"
									autoFocus
									required
								/>
							</div>
						</label>

						{!isLogin && (
							<label className="block">
								<span className="text-sm font-medium text-neutral-700">
									Display name{" "}
									<span className="font-normal text-neutral-500">
										(optional)
									</span>
								</span>
								<div className="relative mt-1.5">
									<User
										className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
										aria-hidden
									/>
									<input
										className={`${fieldBase} ${fieldOk}`}
										value={displayName}
										onChange={(e) => setDisplayName(e.target.value)}
										placeholder="How teammates see you"
										autoComplete="name"
									/>
								</div>
							</label>
						)}

						<label className="block">
							<span className="text-sm font-medium text-neutral-700">
								Password
							</span>
							<div className="relative mt-1.5">
								<Lock
									className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
									aria-hidden
								/>
								<input
									type={showPassword ? "text" : "password"}
									className={`${fieldBase} !pr-10 ${error ? fieldErr : fieldOk}`}
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									placeholder={isLogin ? "Password" : "At least 8 characters"}
									autoComplete={isLogin ? "current-password" : "new-password"}
									required
								/>
								<button
									type="button"
									onClick={() => setShowPassword((v) => !v)}
									className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-neutral-500 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-600"
									aria-label={showPassword ? "Hide password" : "Show password"}
								>
									{showPassword ? (
										<EyeOff className="h-4 w-4" />
									) : (
										<Eye className="h-4 w-4" />
									)}
								</button>
							</div>
						</label>

						{error && (
							<p role="alert" className="text-sm font-medium text-error-900">
								{error}
							</p>
						)}

						<button
							type="submit"
							disabled={busy}
							className="group flex w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-3 py-2.5 text-base font-medium text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
						>
							{busy ? "One moment…" : isLogin ? "Sign in" : "Create account"}
							{!busy && (
								<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
							)}
						</button>
					</form>

					{oauthError && (
						<p role="alert" className="mt-3 text-sm font-medium text-error-900">
							Login cancelled — try again.
						</p>
					)}

					<div className="mt-7 flex items-center gap-3">
						<div className="h-px flex-1 bg-neutral-200" />
						<span className="text-sm text-neutral-500">or continue with</span>
						<div className="h-px flex-1 bg-neutral-200" />
					</div>

					<div className="mt-5 grid grid-cols-2 gap-3">
						<button
							type="button"
							onClick={() => api.startOAuth("google")}
							className="flex items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2.5 text-sm font-medium text-neutral-800 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							aria-label="Sign in with Google"
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
							Google
						</button>
						<button
							type="button"
							onClick={() => api.startOAuth("github")}
							className="flex items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2.5 text-sm font-medium text-neutral-800 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							aria-label="Sign in with GitHub"
						>
							<svg
								className="h-4 w-4"
								viewBox="0 0 24 24"
								fill="#181717"
								aria-hidden="true"
							>
								<path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
							</svg>
							GitHub
						</button>
					</div>

					<p className="mt-8 text-center text-sm text-neutral-500">
						{isLogin ? "New to Camel? " : "Already have an account? "}
						<button
							type="button"
							onClick={() => switchMode(isLogin ? "register" : "login")}
							className="font-medium text-primary-600 hover:text-primary-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							{isLogin ? "Create an account" : "Sign in"}
						</button>
					</p>
				</div>
			</main>
		</div>
	);
}
