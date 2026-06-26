import { Check, ChevronDown, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useBoard } from "../../context/BoardContext";
import {
	getInvitePopoverState,
	getSwitchAttemptState,
	getWorkspaceLimitActionState,
	workspaceInitials,
} from "../../lib/workspaceSwitcher";
import type { Workspace, WorkspaceInvite } from "../../types";
import { PopoverShell } from "./shared";

/* ------------------------------------------------------------------ */
/*  Workspace avatar                                                   */
/* ------------------------------------------------------------------ */

export function WorkspaceAvatar({
	workspace,
	logoPath,
}: {
	workspace: Workspace;
	logoPath?: string;
}) {
	if (logoPath && logoPath !== "/logo.png") {
		return (
			<img
				src={logoPath}
				alt=""
				className="h-6 w-6 shrink-0 rounded object-cover"
			/>
		);
	}
	return (
		<span
			className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary-100 text-[10px] font-semibold text-primary-800"
			aria-hidden
		>
			{workspaceInitials(workspace.name)}
		</span>
	);
}

/* ------------------------------------------------------------------ */
/*  Workspace switcher                                                 */
/* ------------------------------------------------------------------ */

interface WorkspaceSwitcherProps {
	collapsed?: boolean;
	placement?: "right" | "top";
}

export function WorkspaceSwitcher({
	collapsed = false,
	placement = "right",
}: WorkspaceSwitcherProps) {
	const {
		activeWorkspace,
		activeWorkspaceId,
		workspaces,
		settings,
		pendingInvites,
		remindedInviteIds,
		membershipCount,
		hasUnsavedCardEdits,
		attemptSwitchWorkspace,
		switchConfirm,
		confirmPendingSwitch,
		cancelPendingSwitch,
		openCreateWorkspace,
		acceptWorkspaceInvite,
		declineWorkspaceInvite,
	} = useBoard();

	const [open, setOpen] = useState(false);
	const [busyInviteId, setBusyInviteId] = useState<number | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);

	const handleAcceptInvite = async (invite: WorkspaceInvite) => {
		if (busyInviteId !== null) return;
		setBusyInviteId(invite.id);
		try {
			await acceptWorkspaceInvite(invite);
		} finally {
			setBusyInviteId(null);
		}
	};

	const handleDeclineInvite = async (invite: WorkspaceInvite) => {
		if (busyInviteId !== null) return;
		setBusyInviteId(invite.id);
		try {
			await declineWorkspaceInvite(invite);
		} finally {
			setBusyInviteId(null);
		}
	};

	const invitePopover = getInvitePopoverState({
		switcherOpen: open,
		remindedInviteIds,
		pendingInvites,
	});

	const createLimit = getWorkspaceLimitActionState({
		membershipCount,
		action: "create-workspace",
	});

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: MouseEvent) => {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
				setOpen(false);
				cancelPendingSwitch();
			}
		};
		document.addEventListener("mousedown", onPointerDown);
		return () => document.removeEventListener("mousedown", onPointerDown);
	}, [open, cancelPendingSwitch]);

	const selectWorkspace = (id: number) => {
		const state = getSwitchAttemptState({
			activeWorkspaceId,
			targetWorkspaceId: id,
			hasUnsavedCardEdits,
		});
		attemptSwitchWorkspace(id);
		if (state.status !== "confirm-required") setOpen(false);
	};

	const labelHidden = collapsed ? "hidden" : "hidden lg:inline";

	if (!activeWorkspace) {
		return (
			<div className="flex min-w-0 flex-1 items-center gap-2 px-1">
				<span className="h-6 w-6 shrink-0 rounded bg-neutral-200" />
				<span className={`truncate text-sm text-primary-900 ${labelHidden}`}>
					Choose workspace
				</span>
			</div>
		);
	}

	return (
		<div ref={rootRef} className="relative min-w-0 flex-1">
			<button
				type="button"
				onClick={() => setOpen((prev) => !prev)}
				aria-expanded={open}
				aria-haspopup="listbox"
				className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
			>
				<WorkspaceAvatar
					workspace={activeWorkspace}
					logoPath={settings.logoPath}
				/>
				<span
					className={`min-w-0 truncate text-sm text-primary-900 ${labelHidden}`}
				>
					{activeWorkspace.name}
				</span>
				<ChevronDown
					size={16}
					className={`shrink-0 text-neutral-500 transition-transform ${open ? "rotate-180" : ""} ${collapsed ? "hidden" : ""}`}
					aria-hidden
				/>
			</button>

			{open && (
				<div
					className="absolute left-0 bottom-full z-50 mb-1 w-56 rounded-md border border-neutral-200 bg-white py-1 shadow-lg"
					role="listbox"
					aria-label="Workspaces"
				>
					{workspaces.map((ws) => (
						<button
							key={ws.id}
							type="button"
							role="option"
							aria-selected={ws.id === activeWorkspaceId}
							onClick={() => selectWorkspace(ws.id)}
							className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
								ws.id === activeWorkspaceId
									? "bg-primary-100 font-medium text-primary-800"
									: "text-neutral-700 hover:bg-neutral-100"
							}`}
						>
							<WorkspaceAvatar workspace={ws} />
							<span className="min-w-0 truncate">{ws.name}</span>
							{ws.id === activeWorkspaceId && (
								<Check size={14} className="ml-auto shrink-0" aria-hidden />
							)}
						</button>
					))}
					<div className="my-1 border-t border-neutral-200" />
					<button
						type="button"
						disabled={createLimit.disabled}
						title={createLimit.message ?? undefined}
						onClick={() => {
							setOpen(false);
							openCreateWorkspace();
						}}
						className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-primary-600 hover:bg-primary-100 hover:text-primary-700 disabled:cursor-not-allowed disabled:text-neutral-400 disabled:hover:bg-transparent"
					>
						<Plus size={16} aria-hidden />
						Create workspace
					</button>
					{createLimit.disabled && createLimit.message && (
						<p className="px-3 pb-2 text-xs text-neutral-500">
							{createLimit.message}
						</p>
					)}
				</div>
			)}

			<PopoverShell
				open={switchConfirm.open}
				onCancel={cancelPendingSwitch}
				placement={placement}
				ariaLabel="Confirm workspace switch"
			>
				<p className="text-sm font-medium text-neutral-700">
					Switch workspace?
				</p>
				<p className="mt-1 text-xs text-neutral-500">
					You have unsaved card edits. They will be discarded.
				</p>
				<div className="mt-3 flex gap-2">
					<button
						onClick={cancelPendingSwitch}
						className="flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						Cancel
					</button>
					<button
						onClick={() => {
							confirmPendingSwitch();
							setOpen(false);
						}}
						className="flex-1 rounded-md bg-primary-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						Switch
					</button>
				</div>
			</PopoverShell>

			{invitePopover.visible && (
				<PopoverShell
					open
					onCancel={() => setOpen(false)}
					placement={placement}
					ariaLabel="Pending workspace invites"
				>
					<p className="text-sm font-medium text-neutral-700">
						Pending invites
					</p>
					<ul className="mt-2 space-y-3">
						{invitePopover.invites.map((invite) => {
							const acceptLimit = getWorkspaceLimitActionState({
								membershipCount,
								action: "accept-invite",
							});
							const busy = busyInviteId === invite.id;
							return (
								<li key={invite.id} className="space-y-1.5">
									<p className="text-xs text-neutral-600">
										<span className="font-medium text-neutral-800">
											{invite.workspaceName}
										</span>
										<span className="text-neutral-500"> · {invite.role}</span>
									</p>
									{acceptLimit.disabled && acceptLimit.message && (
										<p className="text-xs text-error-600">
											{acceptLimit.message}
										</p>
									)}
									<div className="flex gap-1.5">
										<button
											type="button"
											disabled={busy || acceptLimit.disabled}
											onClick={() => void handleAcceptInvite(invite)}
											className="flex-1 rounded-md bg-primary-600 px-2 py-1 text-xs font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
										>
											{busy ? "…" : "Accept"}
										</button>
										<button
											type="button"
											disabled={busy}
											onClick={() => void handleDeclineInvite(invite)}
											className="flex-1 rounded-md border border-neutral-300 bg-neutral-100 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-neutral-200 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
										>
											Decline
										</button>
									</div>
								</li>
							);
						})}
					</ul>
				</PopoverShell>
			)}
		</div>
	);
}
