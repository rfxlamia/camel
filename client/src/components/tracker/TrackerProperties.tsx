import { Plus, Tag, UserRound } from "lucide-react";
import { useState } from "react";
import { NO_PRIORITY, sortStatusesByPosition } from "../../lib/trackerUtils";
import type {
	TrackerItem,
	TrackerVocabulary,
	WorkspaceMember,
} from "../../types";
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

export interface PropertyPatch {
	statusId?: number;
	priorityId?: number | null;
	/** Toggle one assignee; resolved against latest item state in the parent queue. */
	assigneeToggle?: number;
	/** Toggle one label; resolved against latest item state in the parent queue. */
	labelToggle?: number;
}

interface Props {
	item: TrackerItem;
	statuses: TrackerVocabulary[];
	priorities: TrackerVocabulary[];
	labels: TrackerVocabulary[];
	members: WorkspaceMember[];
	onChange: (patch: PropertyPatch) => void;
}

type PickerName = "status" | "priority" | "assignees" | "labels";

function formatDate(iso: string): string {
	return new Date(iso).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

/**
 * Property rail for one item. Each pick commits straight away — the same
 * semantics as the inline status change on a list row — so the rail never
 * competes with the title/description draft for the Save button.
 *
 * Labels commit on pick too — same queue semantics as assignees.
 */
export default function TrackerProperties({
	item,
	statuses,
	priorities,
	labels,
	members,
	onChange,
}: Props) {
	const [openPicker, setOpenPicker] = useState<PickerName | null>(null);

	const orderedStatuses = sortStatusesByPosition(statuses);
	const orderedPriorities = sortStatusesByPosition(priorities);
	const orderedLabels = sortStatusesByPosition(labels);
	const assigneeIds = item.assignees.map((a) => a.id);

	const statusOptions: PickerOption[] = orderedStatuses.map((s) => ({
		id: String(s.id),
		label: s.name,
		selected: s.id === item.status.id,
		icon: <StatusGlyph spec={statusGlyphSpec(orderedStatuses, s.id)} />,
	}));

	const priorityOptions: PickerOption[] = [
		{
			id: NO_PRIORITY,
			label: "No priority",
			selected: item.priority === null,
			icon: <PriorityGlyph bars={0} />,
		},
		...orderedPriorities.map((p) => ({
			id: String(p.id),
			label: p.name,
			selected: p.id === item.priority?.id,
			icon: <PriorityGlyph bars={priorityBars(orderedPriorities, p.id)} />,
		})),
	];

	const assigneeOptions: PickerOption[] = members.map((m) => ({
		id: String(m.userId),
		label: m.displayName,
		hint: `@${m.username}`,
		selected: assigneeIds.includes(m.userId),
		icon: <Avatar name={m.displayName} />,
	}));

	const assigneeValue =
		item.assignees.length === 0
			? undefined
			: item.assignees.length === 1
				? item.assignees[0].displayName
				: `${item.assignees[0].displayName} +${item.assignees.length - 1}`;

	const labelOptions: PickerOption[] = orderedLabels.map((l) => ({
		id: String(l.id),
		label: l.name,
		selected: item.labels.some((label) => label.id === l.id),
		icon: <LabelDot colour={l.colour} />,
	}));

	return (
		// order-first keeps the properties reachable on a phone, where the rail
		// stacks — otherwise they would sit below the whole activity feed.
		<aside className="order-first shrink-0 border-neutral-200 border-b px-4 py-4 md:px-6 lg:order-none lg:w-[264px] lg:border-b-0 lg:border-l lg:px-5 lg:py-6">
			<h2 className="hidden font-medium text-[11px] text-neutral-500 uppercase tracking-[0.08em] lg:block">
				Properties
			</h2>

			<div className="flex flex-wrap items-center gap-1.5 lg:mt-3 lg:flex-col lg:items-stretch">
				{orderedStatuses.length > 0 && (
					<TrackerPropertyPicker
						placeholder="Status"
						value={item.status.name}
						icon={
							<StatusGlyph
								spec={statusGlyphSpec(orderedStatuses, item.status.id)}
							/>
						}
						searchPlaceholder="Change status…"
						options={statusOptions}
						open={openPicker === "status"}
						onOpenChange={(open) => setOpenPicker(open ? "status" : null)}
						onSelect={(id) => onChange({ statusId: Number(id) })}
					/>
				)}

				{orderedPriorities.length > 0 && (
					<TrackerPropertyPicker
						placeholder="Priority"
						value={item.priority?.name}
						icon={
							<PriorityGlyph
								bars={
									item.priority
										? priorityBars(orderedPriorities, item.priority.id)
										: 0
								}
							/>
						}
						searchPlaceholder="Set priority to…"
						options={priorityOptions}
						open={openPicker === "priority"}
						onOpenChange={(open) => setOpenPicker(open ? "priority" : null)}
						onSelect={(id) =>
							onChange({ priorityId: id === NO_PRIORITY ? null : Number(id) })
						}
					/>
				)}

				{members.length > 0 && (
					<TrackerPropertyPicker
						placeholder="Assignee"
						value={assigneeValue}
						icon={
							item.assignees.length > 0 ? (
								<Avatar name={item.assignees[0].displayName} size={16} />
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
						onOpenChange={(open) => setOpenPicker(open ? "assignees" : null)}
						onSelect={(id) => onChange({ assigneeToggle: Number(id) })}
						multiple
					/>
				)}
			</div>

			{orderedLabels.length > 0 && (
				<>
					<h3 className="mt-6 font-medium text-[11px] text-neutral-500 uppercase tracking-[0.08em]">
						Labels
					</h3>
					<div className="mt-2.5 flex flex-wrap items-center gap-1.5">
						{item.labels.map((label) => (
							<span
								key={label.id}
								className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 py-0.5 pr-2 pl-1.5 text-neutral-600 text-xs"
							>
								<LabelDot colour={label.colour} />
								{label.name}
							</span>
						))}
						<TrackerPropertyPicker
							placeholder="Add label"
							variant={item.labels.length > 0 ? "inline" : "chip"}
							size="compact"
							triggerLabel="Add label"
							icon={
								item.labels.length > 0 ? (
									<Plus size={14} className="text-neutral-500" aria-hidden />
								) : (
									<Tag
										size={12}
										className="shrink-0 text-neutral-500"
										aria-hidden
									/>
								)
							}
							searchPlaceholder="Change or add labels…"
							options={labelOptions}
							open={openPicker === "labels"}
							onOpenChange={(open) => setOpenPicker(open ? "labels" : null)}
							onSelect={(id) => onChange({ labelToggle: Number(id) })}
							multiple
						/>
					</div>
				</>
			)}

			{/* Dates are reference material — on a phone they would push the title
			    below the fold, so the rail keeps them for the desktop layout. */}
			<dl className="mt-6 hidden space-y-1.5 border-neutral-200 border-t pt-4 text-xs lg:block">
				<div className="flex items-baseline justify-between gap-2">
					<dt className="text-neutral-500">Created</dt>
					<dd className="text-neutral-700 tabular-nums">
						{formatDate(item.createdAt)}
					</dd>
				</div>
				<div className="flex items-baseline justify-between gap-2">
					<dt className="text-neutral-500">Updated</dt>
					<dd className="text-neutral-700 tabular-nums">
						{formatDate(item.updatedAt)}
					</dd>
				</div>
			</dl>
		</aside>
	);
}
