import { useMemo } from "react";
import type { Column } from "../../types";
import type { BoardViewMode } from "./boardViewPrefs";
import ViewSwitcher from "./ViewSwitcher";

function StatChip({
	dot,
	value,
	label,
}: {
	dot: string;
	value: number | string;
	label: string;
}) {
	return (
		<span className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs text-neutral-600">
			<span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
			<span className="font-semibold tabular-nums text-neutral-900">
				{value}
			</span>
			{label}
		</span>
	);
}

export function BoardToolbar({
	columns,
	boardViewMode,
	setBoardViewMode,
}: {
	columns: Column[];
	boardViewMode: BoardViewMode;
	setBoardViewMode: (mode: BoardViewMode) => void;
}) {
	const s = useMemo(() => {
		let total = 0;
		let active = 0;
		let done = 0;
		let over = 0;
		for (const col of columns) {
			total += col.cards.length;
			if (col.wipLimit !== null && col.cards.length > col.wipLimit) over++;
			for (const c of col.cards) {
				if (c.doneAt) done++;
				else if (c.startedAt) active++;
			}
		}
		return { total, active, done, over, cols: columns.length };
	}, [columns]);

	const hasColumns = columns.length > 0;

	return (
		<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2.5 md:px-6">
			{hasColumns && (
				<>
					<StatChip dot="bg-neutral-300" value={s.total} label="cards" />
					<StatChip dot="bg-primary-400" value={s.active} label="in progress" />
					<StatChip dot="bg-success-500" value={s.done} label="done" />
					<span className="hidden text-neutral-300 sm:inline" aria-hidden>
						·
					</span>
					<span className="hidden text-xs text-neutral-500 sm:inline">
						{s.cols} column{s.cols === 1 ? "" : "s"}
					</span>
				</>
			)}
			<div className="ml-auto flex items-center gap-2">
				<ViewSwitcher value={boardViewMode} onChange={setBoardViewMode} />
				{hasColumns &&
					(s.over > 0 ? (
						<span className="inline-flex items-center gap-1.5 rounded-md bg-error-100 px-2.5 py-1 text-xs font-medium text-error-900">
							<span
								className="h-1.5 w-1.5 rounded-full bg-error-500"
								aria-hidden
							/>
							WIP over in {s.over} column{s.over === 1 ? "" : "s"}
						</span>
					) : (
						<span className="inline-flex items-center gap-1.5 rounded-md bg-success-100 px-2.5 py-1 text-xs font-medium text-success-900">
							<span
								className="h-1.5 w-1.5 rounded-full bg-success-500"
								aria-hidden
							/>
							Flow healthy
						</span>
					))}
			</div>
		</div>
	);
}
