import { useNavigate } from "react-router";
import { itemProjectTrail } from "../../lib/trackerSearch";
import type { TrackerItem, TrackerProject } from "../../types";

interface Props {
	items: TrackerItem[];
	projects: TrackerProject[];
}

export default function TrackerInProjectSection({ items, projects }: Props) {
	const navigate = useNavigate();

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
						<div
							key={item.key}
							className="group/row relative flex h-9 items-center transition-colors hover:bg-neutral-100/70"
						>
							<button
								type="button"
								data-testid={`tracker-row-${item.key}`}
								aria-label={`${item.key} ${item.title}`}
								onClick={() => navigate(`/tracker/${item.key}`)}
								className="absolute inset-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-600"
							/>
							<div className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-2.5 px-4 text-left text-sm md:px-6">
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
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}
