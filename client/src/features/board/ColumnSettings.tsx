import { Shuffle, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useWorkspace } from "../../shared/WorkspaceContext";
import type { Column, WorkspaceMember } from "../../types";
import { COLOR_LABELS, type ColumnColor } from "./columnColors";
import {
	columnColorPreviewStyle,
	generateSwatchCandidates,
} from "./columnColorUtils";

function formatSelectedColorLabel(color: string): string {
	if (color in COLOR_LABELS) {
		return COLOR_LABELS[color as ColumnColor];
	}
	return color.length > 28 ? `${color.slice(0, 25)}...` : color;
}

export interface ColumnSettingsProps {
	column: Column;
	onUpdateColumn: (
		id: number,
		patch: {
			title?: string;
			wipLimit?: number | null;
			policy?: string;
			isDone?: boolean;
			isSignable?: boolean;
			signableAssigneeId?: number | null;
			color?: string | null;
		},
	) => Promise<void>;
	onDeleteColumn: (id: number) => Promise<void>;
	onClose: () => void;
}

export default function ColumnSettings({
	column,
	onUpdateColumn,
	onDeleteColumn,
	onClose,
}: ColumnSettingsProps) {
	const { activeWorkspaceId } = useWorkspace();
	const [title, setTitle] = useState(column.title);
	const [wipLimit, setWipLimit] = useState(
		column.wipLimit === null ? "" : String(column.wipLimit),
	);
	const [policy, setPolicy] = useState(column.policy);
	const [isDone, setIsDone] = useState(column.isDone);
	const [isSignable, setIsSignable] = useState(column.isSignable);
	const [signableAssigneeId, setSignableAssigneeId] = useState<number | null>(
		column.signableAssigneeId,
	);
	const [color, setColor] = useState<string | null>(column.color ?? null);
	const [swatches, setSwatches] = useState(() =>
		generateSwatchCandidates(column.color),
	);
	const [members, setMembers] = useState<WorkspaceMember[]>([]);
	const [membersError, setMembersError] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);

	// Ref to avoid stale closure in useEffect while keeping signableAssigneeId
	// out of deps (re-fetching members on every assignee change is unnecessary)
	const assigneeIdRef = useRef(signableAssigneeId);
	assigneeIdRef.current = signableAssigneeId;

	useEffect(() => {
		if (!isSignable || activeWorkspaceId === null) return;
		let active = true;
		setMembersError(false);
		api
			.getWorkspaceMembers(activeWorkspaceId)
			.then(({ members: m }) => {
				if (!active) return;
				setMembers(m);
				// Validate that signableAssigneeId still exists in the members list
				if (
					assigneeIdRef.current !== null &&
					!m.some((mem) => mem.userId === assigneeIdRef.current)
				) {
					setSignableAssigneeId(null);
				}
			})
			.catch(() => {
				if (active) {
					setMembersError(true);
					// Clear signableAssigneeId when we can't verify membership
					setSignableAssigneeId(null);
				}
			});
		return () => {
			active = false;
		};
	}, [isSignable, activeWorkspaceId]);

	useEffect(() => {
		if (!confirmDelete) return;
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") setConfirmDelete(false);
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [confirmDelete]);

	const save = async () => {
		const limit = wipLimit.trim() === "" ? null : Number(wipLimit);
		// Sanitize signableAssigneeId: validate against current members or clear if errored
		const sanitizedSignableAssigneeId = isSignable
			? membersError
				? null
				: signableAssigneeId !== null &&
						!members.some((m) => m.userId === signableAssigneeId)
					? null
					: signableAssigneeId
			: null;
		await onUpdateColumn(column.id, {
			title: title.trim() || column.title,
			wipLimit:
				limit !== null && (!Number.isInteger(limit) || limit < 1)
					? null
					: limit,
			policy,
			isDone,
			isSignable,
			signableAssigneeId: sanitizedSignableAssigneeId,
			color,
		});
		onClose();
	};

	async function handleDelete() {
		setDeleting(true);
		try {
			await onDeleteColumn(column.id);
			setConfirmDelete(false);
		} finally {
			setDeleting(false);
		}
	}

	const inputClass =
		"w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-500 hover:border-neutral-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)] focus:outline-none";

	return (
		<div className="mt-2 space-y-2 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
			<label className="block">
				<span className="text-xs font-medium text-neutral-700">
					Column name
				</span>
				<input
					className={inputClass}
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder="Column name"
				/>
			</label>
			<label className="block">
				<span className="text-xs font-medium text-neutral-700">
					WIP limit (leave empty for none)
				</span>
				<input
					className={inputClass}
					value={wipLimit}
					onChange={(e) => setWipLimit(e.target.value)}
					type="number"
					min={1}
					placeholder="No limit"
				/>
			</label>
			<label className="block">
				<span className="text-xs font-medium text-neutral-700">Policy</span>
				<textarea
					className={inputClass}
					value={policy}
					onChange={(e) => setPolicy(e.target.value)}
					rows={2}
					placeholder="When does a card belong here?"
				/>
			</label>
			<div className="block">
				<div className="flex items-center justify-between gap-2">
					<span className="text-xs font-medium text-neutral-700">Color</span>
					<button
						type="button"
						onClick={() => setSwatches(generateSwatchCandidates(color))}
						className="rounded-md p-1 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						aria-label="Shuffle colors"
					>
						<Shuffle size={14} aria-hidden />
					</button>
				</div>
				<div className="mt-1.5 flex flex-wrap items-center gap-2">
					{swatches.map((swatch, i) => (
						<button
							key={i}
							type="button"
							onClick={() => setColor(color === swatch ? null : swatch)}
							className={`h-7 w-7 rounded-full border-2 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
								color === swatch
									? "border-neutral-800 scale-110 shadow-md"
									: "border-neutral-300 hover:border-neutral-500 hover:scale-105"
							}`}
							style={columnColorPreviewStyle(swatch)}
							aria-label={`Color swatch ${i + 1}`}
							aria-pressed={color === swatch}
						/>
					))}
					{color !== null && (
						<button
							type="button"
							title="Remove color"
							onClick={() => setColor(null)}
							className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-neutral-300 bg-neutral-100 text-neutral-500 transition-all hover:border-neutral-500 hover:bg-neutral-200 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							aria-label="Remove color"
						>
							<X size={14} />
						</button>
					)}
				</div>
				<p className="mt-1 text-xs text-neutral-500">
					{color
						? `Selected: ${formatSelectedColorLabel(color)}`
						: "Default neutral"}
				</p>
			</div>
			<label className="flex items-center gap-2">
				<input
					type="checkbox"
					checked={isDone}
					onChange={(e) => setIsDone(e.target.checked)}
					className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
				/>
				<span className="text-xs font-medium text-neutral-700">
					Mark as Done column
				</span>
			</label>
			<p className="-mt-1 text-xs text-neutral-500">
				Cards moved here will be marked as completed
			</p>
			{column.isDone && !isDone && (
				<p className="-mt-1 text-xs text-neutral-500">
					Clearing the last Done column is allowed; saving remains available.
				</p>
			)}
			<label className="flex items-center gap-2">
				<input
					type="checkbox"
					checked={isSignable}
					onChange={(e) => setIsSignable(e.target.checked)}
					className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
				/>
				<span className="text-xs font-medium text-neutral-700">
					Mark as Signable Column
				</span>
			</label>
			<p className="-mt-1 text-xs text-neutral-500">
				Cards moved here will be auto-assigned to the selected member
			</p>
			{isSignable && (
				<label className="block">
					<span className="text-xs font-medium text-neutral-700">
						Auto-assign to
					</span>
					{membersError ? (
						<p className="text-xs text-error-600">
							Failed to load members. Save and reopen to retry.
						</p>
					) : (
						<select
							className={inputClass}
							value={signableAssigneeId ?? ""}
							onChange={(e) =>
								setSignableAssigneeId(
									e.target.value === "" ? null : Number(e.target.value),
								)
							}
						>
							<option value="">No auto-assign</option>
							{members.map((m) => (
								<option key={m.userId} value={m.userId}>
									{m.displayName}
								</option>
							))}
						</select>
					)}
				</label>
			)}
			<div className="flex gap-2">
				<button
					onClick={save}
					className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Save
				</button>
				<button
					onClick={onClose}
					className="rounded-md border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Cancel
				</button>
			</div>

			<div className="border-t border-neutral-200 pt-2">
				<button
					type="button"
					onClick={() => setConfirmDelete(true)}
					className="inline-flex items-center gap-1.5 rounded-md border border-error-500 px-2.5 py-1 text-xs font-medium text-error-700 hover:bg-error-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-error-500"
				>
					<Trash2 size={13} aria-hidden />
					Delete column
				</button>
			</div>

			{confirmDelete && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
					role="dialog"
					aria-modal="true"
					aria-labelledby="confirm-delete-column-title"
					onClick={() => setConfirmDelete(false)}
				>
					<div
						className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg"
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => e.stopPropagation()}
					>
						<p
							id="confirm-delete-column-title"
							className="font-medium text-neutral-800"
						>
							Delete {column.title}?
						</p>
						<p className="mt-1 text-sm text-neutral-500">
							Cards in this column move to your first remaining column
							automatically, and attachments on those cards are permanently
							deleted. This cannot be undone.
						</p>
						<div className="mt-4 flex gap-2">
							<button
								type="button"
								onClick={() => setConfirmDelete(false)}
								className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => void handleDelete()}
								disabled={deleting}
								aria-label="Confirm delete column"
								className="flex-1 rounded-md bg-error-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-error-600 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
							>
								{deleting ? "Deleting..." : "Delete"}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
