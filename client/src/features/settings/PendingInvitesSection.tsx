import { useState } from "react";
import { ApiError, api } from "../../api";
import type { ToastType } from "../../shared/ToastContext";

export interface PendingInviteRow {
	id: number;
	username: string;
	role: string;
}

export interface PendingInvitesSectionProps {
	workspaceId: number;
	invites: PendingInviteRow[];
	onCancelled: (inviteId: number) => void;
	showToast: (msg: string, type?: ToastType) => void;
}

export default function PendingInvitesSection({
	workspaceId,
	invites,
	onCancelled,
	showToast,
}: PendingInvitesSectionProps) {
	const [cancellingId, setCancellingId] = useState<number | null>(null);

	async function handleCancel(invite: PendingInviteRow) {
		setCancellingId(invite.id);
		try {
			await api.cancelWorkspaceInvite(workspaceId, invite.id);
			showToast("Invite cancelled", "success");
			onCancelled(invite.id);
		} catch (err: unknown) {
			const msg =
				err instanceof ApiError
					? err.message
					: "Couldn't cancel the invite. Try again.";
			showToast(msg, "error");
		} finally {
			setCancellingId(null);
		}
	}

	return (
		<div className="mt-4">
			<p className="text-sm font-medium text-neutral-800">Pending invites</p>
			<ul className="mt-2 divide-y divide-neutral-200 rounded-md border border-neutral-200">
				{invites.map((invite) => (
					<li key={invite.id} className="flex items-center gap-3 px-3 py-2.5">
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm font-medium text-neutral-900">
								@{invite.username}
							</div>
							<div className="truncate text-xs text-neutral-500">
								Invite not accepted yet
							</div>
						</div>
						<span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700">
							{invite.role}
						</span>
						<button
							type="button"
							onClick={() => void handleCancel(invite)}
							disabled={cancellingId === invite.id}
							className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							{cancellingId === invite.id ? "Cancelling..." : "Cancel"}
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}
