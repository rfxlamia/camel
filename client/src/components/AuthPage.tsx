import { useState, type FormEvent } from "react";
import { ApiError, api } from "../api";
import type { User } from "../types";

interface Props {
  onAuth: (user: User) => void;
}

const inputClass =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 placeholder:text-neutral-500 hover:border-neutral-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)] focus:outline-none";

const errorInputClass =
  "mt-1 w-full rounded-md border border-error-500 bg-white px-3 py-2 text-base text-neutral-900 placeholder:text-neutral-500 focus:shadow-[0_0_0_3px_oklch(55%_0.1_25_/_0.15)] focus:outline-none";

export default function AuthPage({ onAuth }: Props) {
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
              : "Join your team's board in a few seconds."}
          </p>

          <div className="mt-5 space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-neutral-700">Username</span>
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
                  Display name <span className="font-normal text-neutral-500">(optional)</span>
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
              <span className="text-sm font-medium text-neutral-700">Password</span>
              <input
                type="password"
                className={error ? errorInputClass : inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "register" ? "At least 8 characters" : "Password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
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
        </form>
      </div>
    </div>
  );
}
