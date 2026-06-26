import { Plus, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useBoard } from "../../context/BoardContext";
import { getWorkspaceLimitActionState } from "../../lib/workspaceSwitcher";
import type { WorkspaceInvite } from "../../types";
import { inputClass } from "./shared";
import { WorkspaceAvatar } from "./WorkspaceSwitcher";

function ModalBackdrop({
	children,
	onClose,
}: {
	children: React.ReactNode;
	onClose?: () => void;
}) {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4">
			<div className="absolute inset-0" onClick={onClose} aria-hidden />
			<div className="relative w-full max-w-sm">{children}</div>
		</div>
	);
}

function BlockingInviteModal({ invite }: { invite: WorkspaceInvite }) {
	const {
		acceptWorkspaceInvite,
		declineWorkspaceInvite,
		remindInviteLater,
		membershipCount,
	} = useBoard();
	const [busy, setBusy] = useState(false);
	const acceptLimit = getWorkspaceLimitActionState({
		membershipCount,
		action: "accept-invite",
	});

	const run = async (action: () => Promise<void> | void) => {
		if (busy) return;
		setBusy(true);
		try {
			await action();
		} finally {
			setBusy(false);
		}
	};

	return (
		<ModalBackdrop>
			<div
				role="dialog"
				aria-label="Workspace invite"
				className="rounded-lg border border-neutral-200 bg-white p-6 shadow-lg"
			>
				<h2 className="text-md font-semibold text-neutral-900">
					Workspace invite
				</h2>
				<p className="mt-2 text-sm text-neutral-600">
					You&apos;ve been invited to join{" "}
					<span className="font-medium text-neutral-900">
						{invite.workspaceName}
					</span>{" "}
					as {invite.role}.
				</p>
				{acceptLimit.disabled && acceptLimit.message && (
					<p className="mt-3 text-xs font-medium text-error-900">
						{acceptLimit.message}
					</p>
				)}
				<div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
					<button
						type="button"
						disabled={busy || acceptLimit.disabled}
						onClick={() => void run(() => acceptWorkspaceInvite(invite))}
						className="flex-1 rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
					>
						Accept
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => void run(() => declineWorkspaceInvite(invite))}
						className="flex-1 rounded-md border border-neutral-300 bg-neutral-100 px-3 py-2 text-sm font-medium text-primary-700 hover:bg-neutral-200"
					>
						Decline
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => remindInviteLater(invite)}
						className="flex-1 rounded-md px-3 py-2 text-sm font-medium text-primary-600 hover:bg-primary-100"
					>
						Remind me later
					</button>
				</div>
			</div>
		</ModalBackdrop>
	);
}

function WorkspacePickerModal() {
	const {
		workspaces,
		activeWorkspaceId,
		membershipCount,
		attemptSwitchWorkspace,
		openCreateWorkspace,
	} = useBoard();
	const createLimit = getWorkspaceLimitActionState({
		membershipCount,
		action: "create-workspace",
	});

	return (
		<ModalBackdrop>
			<div
				role="dialog"
				aria-label="Choose a workspace"
				className="rounded-lg border border-neutral-200 bg-white p-6 shadow-lg"
			>
				<h2 className="text-md font-semibold text-neutral-900">
					Choose a workspace
				</h2>
				<p className="mt-1 text-sm text-neutral-600">
					Select where you want to work.
				</p>
				<ul className="mt-4 max-h-64 space-y-1 overflow-y-auto">
					{workspaces.map((ws) => (
						<li key={ws.id}>
							<button
								type="button"
								onClick={() => attemptSwitchWorkspace(ws.id)}
								className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${
									ws.id === activeWorkspaceId
										? "bg-primary-100 font-medium text-primary-800"
										: "text-neutral-700 hover:bg-neutral-100"
								}`}
							>
								<WorkspaceAvatar workspace={ws} />
								<span className="truncate">{ws.name}</span>
							</button>
						</li>
					))}
				</ul>
				<div className="mt-4 border-t border-neutral-200 pt-4">
					<button
						type="button"
						disabled={createLimit.disabled}
						title={createLimit.message ?? undefined}
						onClick={openCreateWorkspace}
						className="flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-primary-600 hover:bg-primary-100 disabled:cursor-not-allowed disabled:text-neutral-400"
					>
						<Plus size={16} aria-hidden />
						Create workspace
					</button>
					{createLimit.disabled && createLimit.message && (
						<p className="mt-2 text-center text-xs text-neutral-500">
							{createLimit.message}
						</p>
					)}
				</div>
			</div>
		</ModalBackdrop>
	);
}

function CreateWorkspaceModal() {
	const {
		createWorkspaceOpen,
		closeCreateWorkspace,
		submitCreateWorkspace,
		membershipCount,
	} = useBoard();
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const limit = getWorkspaceLimitActionState({
		membershipCount,
		action: "create-workspace",
	});

	useEffect(() => {
		if (createWorkspaceOpen) setName("");
	}, [createWorkspaceOpen]);

	if (!createWorkspaceOpen) return null;

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (busy || limit.disabled) return;
		setBusy(true);
		try {
			await submitCreateWorkspace(name);
		} finally {
			setBusy(false);
		}
	};

	return (
		<ModalBackdrop onClose={closeCreateWorkspace}>
			<form
				role="dialog"
				aria-label="Create workspace"
				onSubmit={(e) => void submit(e)}
				className="rounded-lg border border-neutral-200 bg-white p-6 shadow-lg"
			>
				<div className="flex items-start justify-between gap-3">
					<h2 className="text-md font-semibold text-neutral-900">
						Create workspace
					</h2>
					<button
						type="button"
						onClick={closeCreateWorkspace}
						aria-label="Close"
						className="rounded-md p-1 text-neutral-500 hover:bg-neutral-200"
					>
						<X size={18} aria-hidden />
					</button>
				</div>
				<label className="mt-4 block">
					<span className="text-sm font-medium text-neutral-700">
						Workspace name
					</span>
					<input
						className={inputClass}
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Workspace name"
						autoFocus
						required
						disabled={limit.disabled}
					/>
				</label>
				{limit.disabled && limit.message && (
					<p className="mt-2 text-xs font-medium text-error-900">
						{limit.message}
					</p>
				)}
				<div className="mt-5 flex justify-end gap-2">
					<button
						type="button"
						onClick={closeCreateWorkspace}
						className="rounded-md border border-neutral-300 bg-neutral-100 px-3 py-2 text-sm font-medium text-primary-700 hover:bg-neutral-200"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={busy || limit.disabled || !name.trim()}
						className="rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
					>
						Create
					</button>
				</div>
			</form>
		</ModalBackdrop>
	);
}

/** Blocking invite, picker, and create modals — mount once at app shell level. */
export function WorkspaceOverlays() {
	const {
		workspacesReady,
		pickerRequired,
		activeWorkspaceId,
		pendingInvites,
		remindedInviteIds,
	} = useBoard();

	if (!workspacesReady) return null;

	const blockingInvite =
		pendingInvites.find((invite) => !remindedInviteIds.includes(invite.id)) ??
		null;

	return (
		<>
			{blockingInvite && <BlockingInviteModal invite={blockingInvite} />}
			{!blockingInvite && pickerRequired && activeWorkspaceId === null && (
				<WorkspacePickerModal />
			)}
			<CreateWorkspaceModal />
		</>
	);
}
