import { ListTodo, Tag, UserRound, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { sortStatusesByPosition } from "../../lib/trackerUtils";
import type { TrackerVocabulary, WorkspaceMember } from "../../types";
import {
	Avatar,
	LabelDot,
	PriorityGlyph,
	StatusGlyph,
	priorityBars,
	statusGlyphSpec,
} from "./TrackerGlyphs";
import {
	type PickerOption,
	TrackerPropertyPicker,
} from "./TrackerPropertyPicker";

interface Props {
	workspaceId: number;
	onClose: () => void;
	onCreated: () => void;
	statuses: TrackerVocabulary[];
	priorities: TrackerVocabulary[];
}

type PickerName = "status" | "priority" | "assignees" | "labels";

const NO_PRIORITY = "none";

export default function TrackerCreateModal({
	workspaceId,
	onClose,
	onCreated,
	statuses,
	priorities,
}: Props) {
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [statusId, setStatusId] = useState<number | undefined>();
	const [priorityId, setPriorityId] = useState<number | null>(null);
	const [labelIds, setLabelIds] = useState<number[]>([]);
	const [assigneeIds, setAssigneeIds] = useState<number[]>([]);
	const [labels, setLabels] = useState<TrackerVocabulary[]>([]);
	const [members, setMembers] = useState<WorkspaceMember[]>([]);
	const [submitting, setSubmitting] = useState(false);
	const [createMore, setCreateMore] = useState(false);
	const [openPicker, setOpenPicker] = useState<PickerName | null>(null);
	const titleRef = useRef<HTMLTextAreaElement>(null);

	const orderedStatuses = useMemo(
		() => sortStatusesByPosition(statuses),
		[statuses],
	);
	const orderedPriorities = useMemo(
		() => sortStatusesByPosition(priorities),
		[priorities],
	);

	// Mirrors the server default (Backlog), so the chip never lies about what
	// will be created.
	useEffect(() => {
		if (statusId !== undefined || orderedStatuses.length === 0) return;
		const backlog = orderedStatuses.find(
			(s) => s.name.toLowerCase() === "backlog",
		);
		setStatusId((backlog ?? orderedStatuses[0]).id);
	}, [orderedStatuses, statusId]);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const [labelList, memberList] = await Promise.all([
				api.listTrackerVocabularies(workspaceId, "label"),
				api.getWorkspaceMembers(workspaceId),
			]);
			if (cancelled) return;
			setLabels(labelList);
			setMembers(memberList.members);
		})();
		return () => {
			cancelled = true;
		};
	}, [workspaceId]);

	// Escape peels one layer at a time. A picker closing itself does not stop
	// the event, so this guard — not event propagation — decides whether the
	// modal is the layer that closes.
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (openPicker) {
				setOpenPicker(null);
				return;
			}
			onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [onClose, openPicker]);

	const selectedStatus = orderedStatuses.find((s) => s.id === statusId);
	const selectedPriority = orderedPriorities.find((p) => p.id === priorityId);
	const selectedLabels = labels.filter((l) => labelIds.includes(l.id));
	const selectedMembers = members.filter((m) => assigneeIds.includes(m.userId));

	const statusOptions: PickerOption[] = orderedStatuses.map((s) => ({
		id: String(s.id),
		label: s.name,
		selected: s.id === statusId,
		icon: <StatusGlyph spec={statusGlyphSpec(orderedStatuses, s.id)} />,
	}));

	const priorityOptions: PickerOption[] = [
		{
			id: NO_PRIORITY,
			label: "No priority",
			selected: priorityId === null,
			icon: <PriorityGlyph bars={0} />,
		},
		...orderedPriorities.map((p) => ({
			id: String(p.id),
			label: p.name,
			selected: p.id === priorityId,
			icon: <PriorityGlyph bars={priorityBars(orderedPriorities, p.id)} />,
		})),
	];

	const labelOptions: PickerOption[] = labels.map((l) => ({
		id: String(l.id),
		label: l.name,
		selected: labelIds.includes(l.id),
		icon: <LabelDot colour={l.colour} />,
	}));

	const assigneeOptions: PickerOption[] = members.map((m) => ({
		id: String(m.userId),
		label: m.displayName,
		hint: `@${m.username}`,
		selected: assigneeIds.includes(m.userId),
		icon: <Avatar name={m.displayName} />,
	}));

	const toggle = (list: number[], id: number) =>
		list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

	const summarise = (names: string[]) =>
		names.length === 0
			? undefined
			: names.length === 1
				? names[0]
				: `${names[0]} +${names.length - 1}`;

	const resetDraft = () => {
		setTitle("");
		setDescription("");
		setLabelIds([]);
		setAssigneeIds([]);
		titleRef.current?.focus();
	};

	const handleSubmit = async (e?: FormEvent) => {
		e?.preventDefault();
		if (!title.trim() || submitting) return;
		setSubmitting(true);
		try {
			const body: {
				title: string;
				description?: string;
				statusId?: number;
				priorityId?: number | null;
				labelIds?: number[];
				assigneeIds?: number[];
			} = { title: title.trim() };
			const trimmedDescription = description.trim();
			if (trimmedDescription) body.description = trimmedDescription;
			if (statusId !== undefined) body.statusId = statusId;
			body.priorityId = priorityId;
			if (labelIds.length > 0) body.labelIds = labelIds;
			if (assigneeIds.length > 0) body.assigneeIds = assigneeIds;
			await api.createTrackerItem(workspaceId, body);
			onCreated();
			if (createMore) resetDraft();
			else onClose();
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral-900/40 p-4 pt-[10vh] backdrop-blur-[2px]">
			{/* mousedown, not click: an open picker also closes itself on a
			    document mousedown, so a click handler would read a stale
			    openPicker and dismiss the whole modal. */}
			<div
				className="absolute inset-0"
				data-testid="tracker-create-backdrop"
				onMouseDown={() => (openPicker ? setOpenPicker(null) : onClose())}
				aria-hidden
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="tracker-create-title"
				className="relative w-full max-w-2xl rounded-xl border border-neutral-200 bg-white shadow-[0_16px_48px_rgba(23,42,62,0.18)]"
			>
				<div className="flex items-center justify-between px-4 pt-3.5 pb-1">
					<div className="flex min-w-0 items-center gap-2">
						<span className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 font-medium text-neutral-700 text-xs">
							<ListTodo size={13} aria-hidden />
							Tracker
						</span>
						<span className="text-neutral-400" aria-hidden>
							›
						</span>
						<h2
							id="tracker-create-title"
							className="truncate font-medium text-neutral-900 text-sm"
						>
							New item
						</h2>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="rounded-md p-1 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						<X size={16} aria-hidden />
					</button>
				</div>

				<form
					onSubmit={(e) => void handleSubmit(e)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							void handleSubmit();
						}
					}}
				>
					<div className="px-4 pt-2">
						<label htmlFor="tracker-create-item-title" className="sr-only">
							Item title
						</label>
						<textarea
							id="tracker-create-item-title"
							ref={titleRef}
							value={title}
							rows={1}
							placeholder="Item title"
							onChange={(e) => setTitle(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
									e.preventDefault();
								}
							}}
							autoFocus
							className="w-full resize-none border-0 bg-transparent font-medium text-[20px] text-neutral-900 leading-tight placeholder:text-neutral-400 focus:outline-none"
						/>
						<label
							htmlFor="tracker-create-item-description"
							className="sr-only"
						>
							Description
						</label>
						<textarea
							id="tracker-create-item-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={4}
							placeholder="Add description…"
							className="mt-2 w-full resize-none border-0 bg-transparent text-neutral-700 text-sm placeholder:text-neutral-500 focus:outline-none"
						/>
					</div>

					<div className="flex flex-wrap items-center gap-2 px-4 pb-3">
						{orderedStatuses.length > 0 && (
							<TrackerPropertyPicker
								placeholder="Status"
								value={selectedStatus?.name}
								icon={
									selectedStatus ? (
										<StatusGlyph
											spec={statusGlyphSpec(orderedStatuses, selectedStatus.id)}
										/>
									) : (
										<StatusGlyph spec={{ shape: "pending", fraction: 0 }} />
									)
								}
								searchPlaceholder="Change status…"
								options={statusOptions}
								open={openPicker === "status"}
								onOpenChange={(open) => setOpenPicker(open ? "status" : null)}
								onSelect={(id) => setStatusId(Number(id))}
							/>
						)}

						{orderedPriorities.length > 0 && (
							<TrackerPropertyPicker
								placeholder="Priority"
								value={selectedPriority?.name}
								icon={
									<PriorityGlyph
										bars={
											selectedPriority
												? priorityBars(orderedPriorities, selectedPriority.id)
												: 0
										}
									/>
								}
								searchPlaceholder="Set priority to…"
								options={priorityOptions}
								open={openPicker === "priority"}
								onOpenChange={(open) => setOpenPicker(open ? "priority" : null)}
								onSelect={(id) =>
									setPriorityId(id === NO_PRIORITY ? null : Number(id))
								}
							/>
						)}

						{members.length > 0 && (
							<TrackerPropertyPicker
								placeholder="Assignee"
								value={summarise(selectedMembers.map((m) => m.displayName))}
								icon={
									selectedMembers.length > 0 ? (
										<Avatar name={selectedMembers[0].displayName} size={16} />
									) : (
										<UserRound
											size={14}
											className="shrink-0 text-neutral-500"
											aria-hidden
										/>
									)
								}
								searchPlaceholder="Assign to…"
								options={assigneeOptions}
								open={openPicker === "assignees"}
								onOpenChange={(open) =>
									setOpenPicker(open ? "assignees" : null)
								}
								onSelect={(id) =>
									setAssigneeIds((prev) => toggle(prev, Number(id)))
								}
								multiple
							/>
						)}

						{labels.length > 0 && (
							<TrackerPropertyPicker
								placeholder="Labels"
								value={summarise(selectedLabels.map((l) => l.name))}
								icon={
									selectedLabels.length > 0 ? (
										<LabelDot colour={selectedLabels[0].colour} />
									) : (
										<Tag
											size={14}
											className="shrink-0 text-neutral-500"
											aria-hidden
										/>
									)
								}
								searchPlaceholder="Add label…"
								options={labelOptions}
								open={openPicker === "labels"}
								onOpenChange={(open) => setOpenPicker(open ? "labels" : null)}
								onSelect={(id) =>
									setLabelIds((prev) => toggle(prev, Number(id)))
								}
								multiple
							/>
						)}
					</div>

					<div className="flex items-center justify-end gap-3 border-neutral-200 border-t px-4 py-3">
						<button
							type="button"
							role="switch"
							aria-checked={createMore}
							onClick={() => setCreateMore((v) => !v)}
							className="inline-flex items-center gap-2 text-neutral-600 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							<span
								className={`flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors ${
									createMore ? "bg-primary-600" : "bg-neutral-300"
								}`}
								aria-hidden
							>
								<span
									className={`h-3 w-3 rounded-full bg-white transition-transform ${
										createMore ? "translate-x-3" : ""
									}`}
								/>
							</span>
							Create more
						</button>
						<button
							type="button"
							onClick={onClose}
							className="rounded-md px-3 py-1.5 text-neutral-700 text-sm transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!title.trim() || submitting}
							className="rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white shadow-[0_1px_2px_rgba(0,0,0,0.1)] transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none"
						>
							Create item
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
