import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../api";
import { initials } from "../tracker/TrackerGlyphs";
import type { ToastType } from "../../context/BoardContext";
import type { WorkspaceMember, WorkspaceRole } from "../../types";

function roleLabel(role: WorkspaceRole): string {
	if (role === "owner") return "Owner";
	if (role === "admin") return "Admin";
	return "Member";
}

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
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState(false);
	const [pendingRemove, setPendingRemove] = useState<WorkspaceMember | null>(
		null,
	);
	const [removing, setRemoving] = useState(false);
	const [roleUpdatingId, setRoleUpdatingId] = useState<number | null>(null);
	const isFirstLoad = useRef(true);

	const canRemove =
		currentUserRole === "admin" || currentUserRole === "owner";
	const canChangeRole = currentUserRole === "owner";

	const loadMembers = useCallback(async () => {
		if (isFirstLoad.current) {
			setLoading(true);
		}
		setLoadError(false);
		try {
			const { members: rows } = await api.getWorkspaceMembers(workspaceId);
			setMembers(rows);
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
		setLoading(true);
	}, [workspaceId]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey triggers re-fetch after invite
	useEffect(() => {
		void loadMembers();
	}, [loadMembers, refreshKey]);

	useEffect(() => {
		if (!pendingRemove) return;
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") setPendingRemove(null);
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [pendingRemove]);

	async function handleRoleChange(member: WorkspaceMember, role: "admin" | "member") {
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
				err instanceof ApiError ? err.message : "Couldn't update role. Try again.";
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

	if (members.length === 0) {
		return <p className="text-sm text-neutral-600">No members yet</p>;
	}

	return (
		<>
			<ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200">
				{members.map((member) => {
					const isSelf = member.userId === currentUserId;
					const isOwnerRow = member.role === "owner";
					const showRemove =
						canRemove && !isSelf && !isOwnerRow;
					const showRoleDropdown =
						canChangeRole && !isOwnerRow;

					return (
						<li
							key={member.userId}
							className="flex items-center gap-3 px-3 py-2.5"
						>
							<div
								className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-800"
								aria-hidden="true"
							>
								{initials(member.displayName)}
							</div>
							<div className="min-w-0 flex-1">
								<div className="truncate text-sm font-medium text-neutral-900">
									{member.displayName}
								</div>
								<div className="truncate text-xs text-neutral-500">
									@{member.username}
								</div>
							</div>
							{showRoleDropdown ? (
								<select
									value={member.role}
									disabled={roleUpdatingId === member.userId}
									onChange={(e) =>
										void handleRoleChange(
											member,
											e.target.value as "admin" | "member",
										)
									}
									className="appearance-none rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 shadow-sm hover:border-neutral-400 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-600/15 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
									aria-label={`Role for ${member.displayName}`}
								>
									<option value="member">Member</option>
									<option value="admin">Admin</option>
								</select>
							) : (
								<span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700">
									{roleLabel(member.role)}
								</span>
							)}
							{showRemove && (
								<button
									type="button"
									onClick={() => setPendingRemove(member)}
									className="shrink-0 rounded-md border border-error-500 px-2.5 py-1 text-xs font-medium text-error-700 hover:bg-error-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error-500"
								>
									Remove
								</button>
							)}
						</li>
					);
				})}
			</ul>

			{pendingRemove && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
					role="dialog"
					aria-modal="true"
					aria-labelledby="confirm-remove-member-title"
					onClick={() => setPendingRemove(null)}
				>
					<div
						className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg"
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => e.stopPropagation()}
					>
						<p
							id="confirm-remove-member-title"
							className="font-medium text-neutral-800"
						>
							Remove {pendingRemove.displayName}?
						</p>
						<p className="mt-1 text-sm text-neutral-500">
							They will lose access to this workspace and its boards.
						</p>
						<div className="mt-4 flex gap-2">
							<button
								type="button"
								onClick={() => setPendingRemove(null)}
								className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => void handleConfirmRemove()}
								disabled={removing}
								aria-label="Confirm remove"
								className="flex-1 rounded-md bg-error-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-error-600 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
							>
								{removing ? "Removing..." : "Remove"}
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
