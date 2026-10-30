import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../api";
import type { ToastType } from "../../shared/ToastContext";
import type { WorkspaceMember, WorkspaceRole } from "../../types";
import ConfirmActionDialog from "./ConfirmActionDialog";
import MemberRow from "./MemberRow";
import PendingInvitesSection, {
	type PendingInviteRow,
} from "./PendingInvitesSection";

export interface ManageMembersSectionProps {
	workspaceId: number;
	currentUserId: number;
	currentUserRole: WorkspaceRole;
	refreshKey?: number;
	onMembersChanged?: () => void;
	showToast: (msg: string, type?: ToastType) => void;
}

export default function ManageMembersSection({
	workspaceId,
	currentUserId,
	currentUserRole,
	refreshKey = 0,
	onMembersChanged,
	showToast,
}: ManageMembersSectionProps) {
	const [members, setMembers] = useState<WorkspaceMember[]>([]);
	const [invites, setInvites] = useState<PendingInviteRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState(false);
	const [pendingRemove, setPendingRemove] = useState<WorkspaceMember | null>(
		null,
	);
	const [pendingTransfer, setPendingTransfer] =
		useState<WorkspaceMember | null>(null);
	// The `currentUserRole` prop comes from the workspace context and can lag
	// behind a just-completed transfer — or never catch up if the workspace
	// reload triggered by `onMembersChanged` fails. Track the locally-applied
	// demotion so owner-only controls disappear immediately after a successful
	// transfer and stay gone until the prop confirms the new role.
	const [viewerRoleOverride, setViewerRoleOverride] =
		useState<WorkspaceRole | null>(null);
	const [transferring, setTransferring] = useState(false);
	const [removing, setRemoving] = useState(false);
	const [roleUpdatingId, setRoleUpdatingId] = useState<number | null>(null);
	const isFirstLoad = useRef(true);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the override must clear when the role prop catches up or the workspace changes
	useEffect(() => {
		setViewerRoleOverride(null);
	}, [currentUserRole, workspaceId]);

	const viewerRole = viewerRoleOverride ?? currentUserRole;
	const canRemove = viewerRole === "admin" || viewerRole === "owner";

	const loadMembers = useCallback(async () => {
		if (isFirstLoad.current) {
			setLoading(true);
		}
		setLoadError(false);
		try {
			const { members: rows, invites: pendingInvites } =
				await api.getWorkspaceMembers(workspaceId);
			setMembers(rows);
			setInvites(pendingInvites ?? []);
		} catch {
			setLoadError(true);
			showToast("Couldn't load members. Try again.", "error");
		} finally {
			setLoading(false);
			isFirstLoad.current = false;
		}
	}, [workspaceId, showToast]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: workspaceId change resets first-load state
	useEffect(() => {
		isFirstLoad.current = true;
		setMembers([]);
		setInvites([]);
		setLoading(true);
	}, [workspaceId]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey triggers re-fetch after invite
	useEffect(() => {
		void loadMembers();
	}, [loadMembers, refreshKey]);

	async function handleConfirmTransfer() {
		if (!pendingTransfer) return;
		setTransferring(true);
		try {
			await api.transferWorkspaceOwnership(workspaceId, {
				newOwnerId: pendingTransfer.userId,
				previousOwnerRole: "admin",
			});
			setMembers((prev) =>
				prev.map((m) => {
					if (m.userId === pendingTransfer.userId)
						return { ...m, role: "owner" as const };
					if (m.userId === currentUserId)
						return { ...m, role: "admin" as const };
					return m;
				}),
			);
			showToast("Ownership transferred", "success");
			// Apply the demotion locally so owner-only controls disappear right
			// away — independently of the workspace reload that `onMembersChanged`
			// triggers (which may be delayed or fail entirely).
			setViewerRoleOverride("admin");
			onMembersChanged?.();
		} catch (err: unknown) {
			const msg =
				err instanceof ApiError
					? err.message
					: "Couldn't transfer ownership. Try again.";
			showToast(msg, "error");
		} finally {
			setTransferring(false);
			setPendingTransfer(null);
		}
	}

	async function handleRoleChange(
		member: WorkspaceMember,
		role: "admin" | "member",
	) {
		if (role === member.role) return;
		setRoleUpdatingId(member.userId);
		try {
			const updated = await api.updateWorkspaceMemberRole(
				workspaceId,
				member.userId,
				{ role },
			);
			setMembers((prev) =>
				prev.map((m) => (m.userId === updated.userId ? updated : m)),
			);
			showToast("Role updated", "success");
		} catch (err: unknown) {
			const msg =
				err instanceof ApiError
					? err.message
					: "Couldn't update role. Try again.";
			showToast(msg, "error");
		} finally {
			setRoleUpdatingId(null);
		}
	}

	async function handleConfirmRemove() {
		if (!pendingRemove) return;
		setRemoving(true);
		try {
			await api.removeWorkspaceMember(workspaceId, pendingRemove.userId);
			setMembers((prev) =>
				prev.filter((m) => m.userId !== pendingRemove.userId),
			);
			showToast("Member removed", "success");
			onMembersChanged?.();
		} catch (err: unknown) {
			const msg =
				err instanceof ApiError
					? err.message
					: "Couldn't remove member. Try again.";
			showToast(msg, "error");
			if (err instanceof ApiError && err.status === 404) {
				void loadMembers();
			}
		} finally {
			setRemoving(false);
			setPendingRemove(null);
		}
	}

	if (loading) {
		return (
			<div className="space-y-3" aria-busy="true">
				{[1, 2, 3].map((n) => (
					<div
						key={n}
						className="h-12 animate-pulse rounded-md bg-neutral-100"
					/>
				))}
			</div>
		);
	}

	if (loadError) {
		return (
			<div className="text-sm text-neutral-600">
				<p>Couldn't load members.</p>
				<button
					type="button"
					onClick={() => void loadMembers()}
					className="mt-2 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
				>
					Retry
				</button>
			</div>
		);
	}

	if (members.length === 0 && (!canRemove || invites.length === 0)) {
		return <p className="text-sm text-neutral-600">No members yet</p>;
	}

	return (
		<>
			{members.length > 0 && (
				<ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200">
					{members.map((member) => (
						<MemberRow
							key={member.userId}
							member={member}
							viewerId={currentUserId}
							viewerRole={viewerRole}
							roleUpdating={roleUpdatingId === member.userId}
							onRoleChange={(m, role) => void handleRoleChange(m, role)}
							onTransfer={setPendingTransfer}
							onRemove={setPendingRemove}
						/>
					))}
				</ul>
			)}

			{canRemove && invites.length > 0 && (
				<PendingInvitesSection
					workspaceId={workspaceId}
					invites={invites}
					onCancelled={(inviteId) => {
						setInvites((prev) => prev.filter((i) => i.id !== inviteId));
						onMembersChanged?.();
					}}
					showToast={showToast}
				/>
			)}

			{pendingRemove && (
				<ConfirmActionDialog
					titleId="confirm-remove-member-title"
					title={`Remove ${pendingRemove.displayName}?`}
					description="They will lose access to this workspace and its boards."
					confirmAriaLabel="Confirm remove"
					confirmLabel="Remove"
					busyLabel="Removing..."
					busy={removing}
					tone="error"
					onConfirm={() => void handleConfirmRemove()}
					onCancel={() => setPendingRemove(null)}
				/>
			)}

			{pendingTransfer && (
				<ConfirmActionDialog
					titleId="confirm-transfer-ownership-title"
					title={`Transfer ownership to ${pendingTransfer.displayName}?`}
					description="They will own this workspace and its settings. You will become an admin."
					confirmAriaLabel="Confirm transfer"
					confirmLabel="Transfer"
					busyLabel="Transferring..."
					busy={transferring}
					tone="primary"
					onConfirm={() => void handleConfirmTransfer()}
					onCancel={() => setPendingTransfer(null)}
				/>
			)}
		</>
	);
}
