import { ChevronDown, ChevronRight } from "lucide-react";
import type { TrackerItem, TrackerVocabulary } from "../../types";
import TrackerRow from "./TrackerRow";

interface Props {
	status: TrackerVocabulary;
	items: TrackerItem[];
	collapsed: boolean;
	onToggle: () => void;
}

export default function TrackerSection({
	status,
	items,
	collapsed,
	onToggle,
}: Props) {
	return (
		<section className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
			<button
				type="button"
				data-testid={`toggle-section-${status.name}`}
				onClick={onToggle}
				className="flex w-full items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-left text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-600"
			>
				{collapsed ? (
					<ChevronRight size={14} className="shrink-0 text-neutral-500" />
				) : (
					<ChevronDown size={14} className="shrink-0 text-neutral-500" />
				)}
				<span
					className="h-2 w-2 shrink-0 rounded-full"
					style={{ backgroundColor: status.colour }}
					aria-hidden
				/>
				<span>{status.name}</span>
				<span className="ml-1 text-xs font-normal text-neutral-500 tabular-nums">
					{items.length}
				</span>
			</button>
			{!collapsed && (
				<div>
					{items.map((item) => (
						<TrackerRow key={item.key} item={item} />
					))}
				</div>
			)}
		</section>
	);
}
