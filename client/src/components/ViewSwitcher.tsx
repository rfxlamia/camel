import { Calendar, Columns3, List } from "lucide-react";
import type { BoardViewMode } from "../lib/boardViewPrefs";

const VIEWS: { mode: BoardViewMode; label: string; icon: typeof Columns3 }[] = [
	{ mode: "board", label: "Board", icon: Columns3 },
	{ mode: "list", label: "List", icon: List },
	{ mode: "calendar", label: "Calendar", icon: Calendar },
];

export default function ViewSwitcher({
	value,
	onChange,
}: {
	value: BoardViewMode;
	onChange: (mode: BoardViewMode) => void;
}) {
	return (
		<div
			className="inline-flex items-center gap-0.5 rounded-md border border-neutral-200 bg-neutral-100 p-0.5"
			role="tablist"
			aria-label="Board view"
		>
			{VIEWS.map(({ mode, label, icon: Icon }) => {
				const active = value === mode;
				return (
					<button
						key={mode}
						type="button"
						role="tab"
						aria-selected={active}
						onClick={() => onChange(mode)}
						className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
							active
								? "bg-white text-primary-700 shadow-sm"
								: "text-neutral-600 hover:text-neutral-900"
						}`}
					>
						<Icon size={14} aria-hidden />
						{label}
					</button>
				);
			})}
		</div>
	);
}
