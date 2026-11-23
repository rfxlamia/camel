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
	isPersonal?: boolean;
	refreshKey?: number;
	onMembersChanged?: () => void;
	showToast: (msg: string, type?: ToastType) => void;
}

export default function ManageMembersSection({
	workspaceId,
	currentUserId,
	currentUserRole,
	isPersonal = false,
	refreshKey = 0,
	onMembersChanged,
	showToast,
}: ManageMembersSectionProps) {
	const [members, setMembers] = useState<WorkspaceMember[]>([]);
	const [invites, setInvites] = useState<PendingInviteRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState(false);
	const [pendingRemove, setPendingRemove] = useState<{
		member: WorkspaceMember;
		workspaceId: number;
	} | null>(null);
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
	const [roleUpdatingIds, setRoleUpdatingIds] = useState<ReadonlySet<number>>(
		() => new Set(),
	);
	const isFirstLoad = useRef(true);
	const membersSectionRef = useRef<HTMLDivElement>(null);
	const workspaceIdRef = useRef(workspaceId);
	workspaceIdRef.current = workspaceId;
	// Bumped when the workspace changes so an in-flight member action cannot
	// clear or overwrite state that now belongs to another workspace.
	const transferSeq = useRef(0);
	// Bumped when a transfer demotes the viewer. A members reload that started
	// before that demotion must not clear the override with a stale "owner" row.
	const viewerOverrideEpoch = useRef(0);

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
		const epochAtStart = viewerOverrideEpoch.current;
		try {
			const { members: rows, invites: pendingInvites } =
				await api.getWorkspaceMembers(workspaceId);
			setMembers(rows);
			setInvites(pendingInvites ?? []);
			setViewerRoleOverride((current) => {
				if (!current || viewerOverrideEpoch.current !== epochAtStart) {
					return current;
				}
				const self = rows.find((m) => m.userId === currentUserId);
				// A later reload is the source of truth when ownership comes back
				// and the role prop never flipped away from its previous value.
				if (self && self.role !== current) return null;
				return current;
			});
		} catch {
			setLoadError(true);
			showToast("Couldn't load members. Try again.", "error");
		} finally {
			setLoading(false);
			isFirstLoad.current = false;
		}
	}, [workspaceId, showToast, currentUserId]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: workspaceId change resets first-load state and drops member actions started in the previous workspace
	useEffect(() => {
		isFirstLoad.current = true;
		setMembers([]);
		setInvites([]);
		setLoading(true);
		setPendingTransfer(null);
		setPendingRemove(null);
		setTransferring(false);
		setRemoving(false);
		setRoleUpdatingIds(new Set());
		transferSeq.current += 1;
	}, [workspaceId]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey triggers re-fetch after invite
	useEffect(() => {
		void loadMembers();
	}, [loadMembers, refreshKey]);

	async function handleConfirmTransfer() {
		if (!pendingTransfer) return;
		const target = pendingTransfer;
		const originWorkspaceId = workspaceId;
		const seq = transferSeq.current;
		setTransferring(true);
		try {
			await api.transferWorkspaceOwnership(originWorkspaceId, {
				newOwnerId: target.userId,
				previousOwnerRole: "admin",
			});
			const stillOrigin =
				seq === transferSeq.current &&
				workspaceIdRef.current === originWorkspaceId;
			if (stillOrigin) {
				setMembers((prev) =>
					prev.map((m) => {
						if (m.userId === target.userId)
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
				viewerOverrideEpoch.current += 1;
			}
			// The parent reloads workspace roles. That refresh stays valid after
			// the viewer has switched away; the local role writes above do not.
			onMembersChanged?.();
		} catch (err: unknown) {
			const stillOrigin =
				seq === transferSeq.current &&
				workspaceIdRef.current === originWorkspaceId;
			if (stillOrigin && err instanceof ApiError && err.status === 404) {
				// 404 means the target member is gone, or the viewer is no longer
				// the owner. The list and the role prop are both stale.
				showToast(
					"This member or your ownership changed. Refreshing.",
					"error",
				);
				onMembersChanged?.();
				void loadMembers();
			} else if (stillOrigin) {
				const msg =
					err instanceof ApiError
						? err.message
						: "Couldn't transfer ownership. Try again.";
				showToast(msg, "error");
			}
		} finally {
			if (seq === transferSeq.current) {
				setTransferring(false);
				setPendingTransfer(null);
			}
		}
	}

	function setRolePending(userId: number, pending: boolean) {
		setRoleUpdatingIds((prev) => {
			if (prev.has(userId) === pending) return prev;
			const next = new Set(prev);
			if (pending) next.add(userId);
			else next.delete(userId);
			return next;
		});
	}

	async function handleRoleChange(
		member: WorkspaceMember,
		role: "admin" | "member",
	) {
		if (role === member.role) return;
		const originWorkspaceId = workspaceId;
		const seq = transferSeq.current;
		setRolePending(member.userId, true);
		try {
			const updated = await api.updateWorkspaceMemberRole(
				originWorkspaceId,
				member.userId,
				{ role },
			);
			if (
				seq !== transferSeq.current ||
				workspaceIdRef.current !== originWorkspaceId
			) {
				return;
			}
			setMembers((prev) =>
				prev.map((m) => (m.userId === updated.userId ? updated : m)),
			);
			showToast("Role updated", "success");
		} catch (err: unknown) {
			if (
				seq !== transferSeq.current ||
				workspaceIdRef.current !== originWorkspaceId
			) {
				return;
			}
			const msg =
				err instanceof ApiError
					? err.message
					: "Couldn't update role. Try again.";
			showToast(msg, "error");
		} finally {
			if (seq === transferSeq.current) setRolePending(member.userId, false);
		}
	}

	async function handleConfirmRemove() {
		if (!pendingRemove) return;
		const target = pendingRemove.member;
		const originWorkspaceId = pendingRemove.workspaceId;
		if (workspaceIdRef.current !== originWorkspaceId) {
			setPendingRemove(null);
			return;
		}
		const seq = transferSeq.current;
		setRemoving(true);
		try {
			await api.removeWorkspaceMember(originWorkspaceId, target.userId);
			const stillOrigin =
				seq === transferSeq.current &&
				workspaceIdRef.current === originWorkspaceId;
			if (stillOrigin) {
				setMembers((prev) => prev.filter((m) => m.userId !== target.userId));
				showToast("Member removed", "success");
				onMembersChanged?.();
			}
		} catch (err: unknown) {
			const stillOrigin =
				seq === transferSeq.current &&
				workspaceIdRef.current === originWorkspaceId;
			if (!stillOrigin) return;
			const msg =
				err instanceof ApiError
					? err.message
					: "Couldn't remove member. Try again.";
			showToast(msg, "error");
			if (err instanceof ApiError && err.status === 404) {
				void loadMembers();
			}
		} finally {
			if (seq === transferSeq.current) {
				setRemoving(false);
				setPendingRemove(null);
			}
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
			<div
				ref={membersSectionRef}
				tabIndex={-1}
				className="space-y-6 focus:outline-none"
			>
				{members.length > 0 && (
					<ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200">
						{members.map((member) => (
							<MemberRow
								key={member.userId}
								member={member}
								viewerId={currentUserId}
								viewerRole={viewerRole}
								isPersonal={isPersonal}
								roleUpdating={roleUpdatingIds.has(member.userId)}
								onRoleChange={(m, role) => void handleRoleChange(m, role)}
								onTransfer={setPendingTransfer}
								onRemove={(memberToRemove) =>
									setPendingRemove({
										member: memberToRemove,
										workspaceId,
									})
								}
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
			</div>

			{pendingRemove && (
				<ConfirmActionDialog
					titleId="confirm-remove-member-title"
					title={`Remove ${pendingRemove.member.displayName}?`}
					description="They will lose access to this workspace and its boards."
					confirmAriaLabel="Confirm remove"
					confirmLabel="Remove"
					busyLabel="Removing..."
					busy={removing}
					tone="error"
					fallbackFocusRef={membersSectionRef}
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
					fallbackFocusRef={membersSectionRef}
					onConfirm={() => void handleConfirmTransfer()}
					onCancel={() => setPendingTransfer(null)}
				/>
			)}
		</>
	);
}
