import { ChevronRight, Folder, Plus } from "lucide-react";
import type { TrackerGroup } from "../../lib/trackerUtils";
import type { TrackerItem, TrackerVocabulary } from "../../types";
import {
	PriorityGlyph,
	StatusGlyph,
	priorityBars,
	statusGlyphSpec,
} from "./TrackerGlyphs";
import TrackerRow from "./TrackerRow";

interface Props {
	group: TrackerGroup;
	statuses: TrackerVocabulary[];
	priorities: TrackerVocabulary[];
	collapsed: boolean;
	onToggle: () => void;
	/** Omitted when the grouping has nothing to preselect on create. */
	onCreate?: () => void;
	onStatusChange: (item: TrackerItem, statusId: number) => void;
	/** Project name per id, for the row chip. */
	projectNames: Map<number, string>;
	/** Off while grouping by project — the header already names it. */
	showProjectChip: boolean;
}

/**
 * A group band and the rows beneath it. No card chrome — the band alone carries
 * the grouping, so an empty group costs one thin line instead of an empty box.
 * The band is grouping-agnostic: only the leading glyph changes.
 */
export default function TrackerSection({
	group,
	statuses,
	priorities,
	collapsed,
	onToggle,
	onCreate,
	onStatusChange,
	projectNames,
	showProjectChip,
}: Props) {
	const glyph = group.status ? (
		<StatusGlyph spec={statusGlyphSpec(statuses, group.status.id)} size={13} />
	) : group.priority ? (
		<PriorityGlyph bars={priorityBars(priorities, group.priority.id)} size={13} />
	) : (
		<Folder size={13} className="shrink-0 text-neutral-500" aria-hidden />
	);

	return (
		<section className="border-neutral-200 border-b last:border-b-0">
			<div className="group/head flex h-9 items-center gap-2 bg-neutral-100/80 px-4 md:px-6">
				<button
					type="button"
					data-testid={`toggle-section-${group.label}`}
					onClick={onToggle}
					className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					<ChevronRight
						size={13}
						className={`shrink-0 text-neutral-500 transition-transform duration-150 ${
							collapsed ? "" : "rotate-90"
						}`}
						aria-hidden
					/>
					{glyph}
					<span className="truncate font-medium text-neutral-800 text-sm">
						{group.label}
					</span>
					<span className="text-neutral-500 text-xs tabular-nums">
						{group.items.length}
					</span>
				</button>
				{onCreate && (
					<button
						type="button"
						aria-label={`Add item to ${group.label}`}
						onClick={onCreate}
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-500 opacity-0 transition hover:bg-neutral-200 hover:text-neutral-800 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 group-hover/head:opacity-100"
					>
						<Plus size={14} aria-hidden />
					</button>
				)}
			</div>
			{!collapsed && group.items.length > 0 && (
				<div className="divide-y divide-neutral-200/70 bg-white">
					{group.items.map((item) => (
						<TrackerRow
							key={item.key}
							item={item}
							statuses={statuses}
							priorities={priorities}
							projectLabel={
								showProjectChip && item.projectId != null
									? (projectNames.get(item.projectId) ?? null)
									: null
							}
							onStatusChange={(statusId) => onStatusChange(item, statusId)}
						/>
					))}
				</div>
			)}
		</section>
	);
}
