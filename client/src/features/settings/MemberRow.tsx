import { initials } from "../../shared/TrackerGlyphs";
import type { WorkspaceMember, WorkspaceRole } from "../../types";

function roleLabel(role: WorkspaceRole): string {
	if (role === "owner") return "Owner";
	if (role === "admin") return "Admin";
	return "Member";
}

export interface MemberRowProps {
	member: WorkspaceMember;
	viewerId: number;
	viewerRole: WorkspaceRole;
	/** True while the viewer is updating this member's role. */
	roleUpdating: boolean;
	onRoleChange: (member: WorkspaceMember, role: "admin" | "member") => void;
	onTransfer: (member: WorkspaceMember) => void;
	onRemove: (member: WorkspaceMember) => void;
}

export default function MemberRow({
	member,
	viewerId,
	viewerRole,
	roleUpdating,
	onRoleChange,
	onTransfer,
	onRemove,
}: MemberRowProps) {
	const isSelf = member.userId === viewerId;
	const isOwnerRow = member.role === "owner";
	const showRemove =
		(viewerRole === "admin" || viewerRole === "owner") && !isSelf && !isOwnerRow;
	const showRoleDropdown = viewerRole === "owner" && !isOwnerRow;
	const showTransferOwnership = viewerRole === "owner" && !isSelf && !isOwnerRow;

	return (
		<li className="flex items-center gap-3 px-3 py-2.5">
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
					disabled={roleUpdating}
					onChange={(e) =>
						onRoleChange(member, e.target.value as "admin" | "member")
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
			{showTransferOwnership && (
				<button
					type="button"
					onClick={() => onTransfer(member)}
					className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Make owner
				</button>
			)}
			{showRemove && (
				<button
					type="button"
					onClick={() => onRemove(member)}
					className="shrink-0 rounded-md border border-error-500 px-2.5 py-1 text-xs font-medium text-error-700 hover:bg-error-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error-500"
				>
					Remove
				</button>
			)}
		</li>
	);
}
