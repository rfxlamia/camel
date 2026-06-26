import type { Mode } from "./shared";

interface ModeSwitcherProps {
	mode: Mode;
	onSwitch: (m: Mode) => void;
}

export function ModeSwitcher({ mode, onSwitch }: ModeSwitcherProps) {
	return (
		<div className="flex rounded-lg bg-neutral-100 p-1 gap-1">
			<button
				type="button"
				onClick={() => onSwitch("kanban")}
				className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
					mode === "kanban"
						? "bg-white text-neutral-900 shadow-sm"
						: "text-neutral-500 hover:text-neutral-700"
				}`}
			>
				Kanban
			</button>
			<button
				type="button"
				onClick={() => onSwitch("agent")}
				className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
					mode === "agent"
						? "bg-white text-neutral-900 shadow-sm"
						: "text-neutral-500 hover:text-neutral-700"
				}`}
			>
				Agent
			</button>
		</div>
	);
}
