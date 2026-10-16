import { useEffect, useState } from "react";
import { ApiError, api } from "../../api";
import { useShowToast } from "../../shared/ToastContext";
import { useWorkspace } from "../../shared/WorkspaceContext";

export default function LeaveWorkspaceSection() {
	const {
		activeWorkspace,
		activeWorkspaceId,
		reloadWorkspaces,
		switchWorkspace,
	} = useWorkspace();
	const showToast = useShowToast();
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [leaving, setLeaving] = useState(false);

	useEffect(() => {
		if (!confirmOpen) return;
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") setConfirmOpen(false);
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [confirmOpen]);

	if (
		!activeWorkspace ||
		activeWorkspaceId === null ||
		activeWorkspace.role === "owner"
	) {
		return null;
	}

	async function handleLeave() {
		if (activeWorkspaceId === null || !activeWorkspace) return;
		setLeaving(true);
		try {
			await api.leaveWorkspace(activeWorkspaceId);
			const list = await reloadWorkspaces();
			const fallback = list.find((w) => w.isPersonal) ?? list[0];
			if (fallback) switchWorkspace(fallback.id);
			showToast(`You left ${activeWorkspace.name}.`, "success");
		} catch (err: unknown) {
			const msg =
				err instanceof ApiError
					? err.message
					: "Failed to leave workspace. Try again.";
			showToast(msg, "error");
		} finally {
			setLeaving(false);
			setConfirmOpen(false);
		}
	}

	return (
		<>
			<p className="text-sm text-neutral-600">
				You will lose access to this workspace and its boards. You can only
				rejoin if someone invites you again.
			</p>
			<button
				type="button"
				onClick={() => setConfirmOpen(true)}
				className="rounded-md border border-error-500 px-3 py-1.5 text-sm font-medium text-error-700 hover:bg-error-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error-500"
			>
				Leave workspace
			</button>

			{confirmOpen && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
					role="dialog"
					aria-modal="true"
					aria-labelledby="confirm-leave-workspace-title"
					onClick={() => setConfirmOpen(false)}
				>
					<div
						className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg"
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => e.stopPropagation()}
					>
						<p
							id="confirm-leave-workspace-title"
							className="font-medium text-neutral-800"
						>
							Leave {activeWorkspace.name}?
						</p>
						<p className="mt-1 text-sm text-neutral-500">
							You will lose access to this workspace and its boards. Only the
							workspace owner can leave after transferring ownership.
						</p>
						<div className="mt-4 flex gap-2">
							<button
								type="button"
								onClick={() => setConfirmOpen(false)}
								className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => void handleLeave()}
								disabled={leaving}
								aria-label="Confirm leave"
								className="flex-1 rounded-md bg-error-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-error-600 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
							>
								{leaving ? "Leaving..." : "Leave"}
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
