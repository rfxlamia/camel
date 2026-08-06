export type TrackerTab = "items" | "projects";

interface Props {
	value: TrackerTab;
	itemCount: number;
	projectCount: number;
	onChange: (tab: TrackerTab) => void;
}

/**
 * Items and Projects are two different things — a state list and a container
 * list — so they get two surfaces rather than two bands on one page. Underline
 * tabs read as page navigation, which keeps them distinct from the pill-shaped
 * Group by control in the toolbar below.
 *
 * These are page states held in the query string, not an ARIA tab widget: the
 * roles are nav/aria-current rather than tablist/tab, because the ARIA tab
 * pattern promises roving focus and arrow-key navigation this does not have.
 */
export default function TrackerTabs({
	value,
	itemCount,
	projectCount,
	onChange,
}: Props) {
	const tabs: { id: TrackerTab; label: string; count: number }[] = [
		{ id: "items", label: "Items", count: itemCount },
		{ id: "projects", label: "Projects", count: projectCount },
	];

	return (
		<nav
			aria-label="Tracker view"
			className="flex items-stretch gap-4 border-neutral-200 border-b px-4 md:px-6"
		>
			{tabs.map((tab) => {
				const active = tab.id === value;
				return (
					<button
						key={tab.id}
						type="button"
						aria-current={active ? "page" : undefined}
						onClick={() => onChange(tab.id)}
						className={`-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 font-medium text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-600 ${
							active
								? "border-primary-600 text-neutral-900"
								: "border-transparent text-neutral-600 hover:text-neutral-900"
						}`}
					>
						{tab.label}
						<span className="text-neutral-500 text-xs tabular-nums">
							{tab.count}
						</span>
					</button>
				);
			})}
		</nav>
	);
}
