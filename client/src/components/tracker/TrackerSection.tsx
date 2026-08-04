import { ChevronRight, Plus } from "lucide-react";
import type { TrackerItem, TrackerVocabulary } from "../../types";
import { StatusGlyph, statusGlyphSpec } from "./TrackerGlyphs";
import TrackerRow from "./TrackerRow";

interface Props {
	status: TrackerVocabulary;
	items: TrackerItem[];
	statuses: TrackerVocabulary[];
	priorities: TrackerVocabulary[];
	collapsed: boolean;
	onToggle: () => void;
	onCreate: () => void;
	onStatusChange: (item: TrackerItem, statusId: number) => void;
}

/**
 * A status group: a tinted header band and flush rows beneath it. No card
 * chrome — the band alone carries the grouping, so an empty status costs one
 * thin line instead of an empty box.
 */
export default function TrackerSection({
	status,
	items,
	statuses,
	priorities,
	collapsed,
	onToggle,
	onCreate,
	onStatusChange,
}: Props) {
	return (
		<section className="border-neutral-200 border-b last:border-b-0">
			<div className="group/head flex h-9 items-center gap-2 bg-neutral-100/80 px-4 md:px-6">
				<button
					type="button"
					data-testid={`toggle-section-${status.name}`}
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
					<StatusGlyph spec={statusGlyphSpec(statuses, status.id)} size={13} />
					<span className="truncate font-medium text-neutral-800 text-sm">
						{status.name}
					</span>
					<span className="text-neutral-500 text-xs tabular-nums">
						{items.length}
					</span>
				</button>
				<button
					type="button"
					aria-label={`Add item to ${status.name}`}
					onClick={onCreate}
					className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-500 opacity-0 transition hover:bg-neutral-200 hover:text-neutral-800 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 group-hover/head:opacity-100"
				>
					<Plus size={14} aria-hidden />
				</button>
			</div>
			{!collapsed && items.length > 0 && (
				<div className="divide-y divide-neutral-200/70 bg-white">
					{items.map((item) => (
						<TrackerRow
							key={item.key}
							item={item}
							statuses={statuses}
							priorities={priorities}
							onStatusChange={(statusId) => onStatusChange(item, statusId)}
						/>
					))}
				</div>
			)}
		</section>
	);
}
