import { AlertTriangle } from "lucide-react";
import { useCallback } from "react";
import { useWorkspace } from "../../shared/WorkspaceContext";

export function SessionErrorState() {
	const { logout } = useWorkspace();
	const handleSignIn = useCallback(async () => {
		try {
			await logout();
		} finally {
			window.location.assign("/login");
		}
	}, [logout]);

	return (
		<div
			data-testid="my-work-session-error"
			className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center"
		>
			<AlertTriangle size={22} className="text-warning-500" aria-hidden />
			<h2 className="mt-3 font-semibold text-neutral-900 text-base">
				Your session has expired
			</h2>
			<p role="alert" className="mt-1 max-w-sm text-neutral-600 text-sm">
				Sign in again to see your assigned work.
			</p>
			<button
				type="button"
				onClick={() => void handleSignIn()}
				className="mt-4 inline-flex h-9 items-center rounded-md bg-primary-600 px-3 font-medium text-sm text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 motion-reduce:transition-none"
			>
				Sign in again
			</button>
		</div>
	);
}
