import { useState } from "react";
import { sortStatusesByPosition } from "../../lib/trackerUtils";
import type { TrackerItem, TrackerVocabulary } from "../../types";
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
import TrackerRowShell from "./TrackerRowShell";

interface Props {
	item: TrackerItem;
	statuses: TrackerVocabulary[];
	priorities: TrackerVocabulary[];
	onStatusChange: (statusId: number) => void;
	/**
	 * Project the item belongs to. Rendered as a chip so a mixed list still
	 * shows where each item lives — omitted when the group header already says
	 * it, or when the item has no project.
	 */
	projectLabel?: string | null;
}

/**
 * One issue line. Column rhythm is fixed (priority · key · status · title ·
 * labels · assignee · date) so the eye scans straight down each property
 * instead of following ragged content — the Linear reading pattern.
 *
 * The whole row opens the item, except the status glyph, which opens a status
 * menu in place. That is why the navigation target is an overlay button behind
 * the content rather than a wrapper: a button may not nest inside a button.
 */
export default function TrackerRow({
	item,
	statuses,
	priorities,
	onStatusChange,
	projectLabel,
}: Props) {
	const [menuOpen, setMenuOpen] = useState(false);
	const glyph = statusGlyphSpec(statuses, item.status.id);
	const bars = item.priority ? priorityBars(priorities, item.priority.id) : 0;

	const statusOptions: PickerOption[] = sortStatusesByPosition(statuses).map(
		(status) => ({
			id: String(status.id),
			label: status.name,
			icon: <StatusGlyph spec={statusGlyphSpec(statuses, status.id)} />,
			selected: status.id === item.status.id,
		}),
	);

	return (
		<TrackerRowShell itemKey={item.key} itemTitle={item.title}>
			<span
				className="hidden shrink-0 sm:block"
				title={item.priority ? item.priority.name : "No priority"}
			>
				<PriorityGlyph bars={bars} size={13} />
			</span>
			<span className="w-14 shrink-0 truncate font-mono text-neutral-500 text-xs tabular-nums">
				{item.key}
			</span>
			<span className="pointer-events-auto shrink-0">
				<TrackerPropertyPicker
					variant="inline"
					triggerLabel={`${item.status.name}, ${item.key}`}
					placeholder="Status"
					searchPlaceholder="Change status…"
					icon={<StatusGlyph spec={glyph} size={13} />}
					options={statusOptions}
					open={menuOpen}
					onOpenChange={setMenuOpen}
					onSelect={(id) => onStatusChange(Number(id))}
				/>
			</span>
			<span className="min-w-0 flex-1 truncate text-neutral-900">
				{item.title}
			</span>
			{projectLabel && (
				<span
					data-testid={`row-project-${item.key}`}
					className="hidden max-w-32 shrink-0 truncate rounded-md bg-primary-100 px-1.5 py-0.5 font-medium text-primary-800 text-xs sm:inline-block"
				>
					{projectLabel}
				</span>
			)}
			<div className="hidden shrink-0 items-center gap-1.5 sm:flex">
				{item.labels.map((label) => (
					<span
						key={label.id}
						className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 py-0.5 pr-2 pl-1.5 text-neutral-600 text-xs"
					>
						<LabelDot colour={label.colour} />
						{label.name}
					</span>
				))}
			</div>
			<div className="-space-x-1 hidden w-12 shrink-0 items-center justify-end md:flex">
				{item.assignees.length === 0 ? (
					<span
						className="h-[18px] w-[18px] rounded-full border border-neutral-300 border-dashed"
						aria-hidden
					/>
				) : (
					item.assignees.slice(0, 2).map((a) => (
						<span key={a.id} title={a.displayName} className="flex">
							<Avatar name={a.displayName} size={18} />
						</span>
					))
				)}
			</div>
			{/* TODO: due date preference on date column */}
			<time className="hidden w-12 shrink-0 text-right text-neutral-500 text-xs tabular-nums lg:block">
				{new Date(item.createdAt).toLocaleDateString(undefined, {
					month: "short",
					day: "numeric",
				})}
			</time>
		</TrackerRowShell>
	);
}
