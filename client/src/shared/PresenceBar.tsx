import type { PresenceUser, User } from "../types";

interface Props {
	users: PresenceUser[];
	self: User;
}

function initials(name: string): string {
	const parts = name.trim().split(/\s+/);
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function PresenceBar({ users, self }: Props) {
	if (users.length === 0) return null;
	return (
		<div
			className="flex items-center gap-2"
			aria-label={`${users.length} online`}
		>
			<div className="flex -space-x-1.5">
				{users.slice(0, 6).map((u) => (
					<span
						key={u.id}
						title={u.id === self.id ? `${u.displayName} (you)` : u.displayName}
						className="relative inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-primary-200 text-xs font-semibold text-primary-800"
					>
						{initials(u.displayName)}
						<span
							aria-hidden
							className="absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full border border-white bg-success-500"
						/>
					</span>
				))}
			</div>
			<span className="text-xs text-neutral-600">
				{users.length === 1 ? "Just you" : `${users.length} online`}
			</span>
		</div>
	);
}
