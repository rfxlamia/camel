import { itemProjectTrail } from "../../lib/trackerSearch";
import type { TrackerItem, TrackerProject } from "../../types";
import TrackerRowShell from "./TrackerRowShell";

interface Props {
	items: TrackerItem[];
	projects: TrackerProject[];
}

export default function TrackerInProjectSection({ items, projects }: Props) {
	return (
		<section className="border-neutral-200 border-b">
			<div className="flex h-9 items-center bg-neutral-100/80 px-4 md:px-6">
				<span className="font-medium text-neutral-800 text-sm">
					In projects
				</span>
				<span className="ml-2 text-neutral-500 text-xs tabular-nums">
					{items.length}
				</span>
			</div>
			<div className="divide-y divide-neutral-200/70 bg-white">
				{items.map((item) => {
					const trail = itemProjectTrail(item, projects);
					return (
						<TrackerRowShell
							key={item.key}
							itemKey={item.key}
							itemTitle={item.title}
						>
							<span className="w-14 shrink-0 truncate font-mono text-neutral-500 text-xs tabular-nums">
								{item.key}
							</span>
							<span className="min-w-0 truncate text-neutral-900">
								{item.title}
							</span>
							{trail && (
								<span className="ml-auto shrink-0 truncate text-neutral-500 text-xs">
									{trail}
								</span>
							)}
						</TrackerRowShell>
					);
				})}
			</div>
		</section>
	);
}
