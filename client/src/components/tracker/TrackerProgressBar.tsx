import type { RollupResult } from "../../lib/trackerRollup";

interface Props {
	rollup: RollupResult;
}

export default function TrackerProgressBar({ rollup }: Props) {
	if (rollup.kind === "no-tasks") {
		return <span className="text-neutral-500 text-xs">No tasks</span>;
	}

	if (rollup.kind === "no-active-work") {
		return <span className="text-neutral-500 text-xs">No active work</span>;
	}

	const pct = Math.round(rollup.ratio * 100);

	return (
		<div className="flex min-w-0 items-center gap-2">
			<div
				className="h-1.5 min-w-0 flex-1 rounded-full bg-neutral-200"
				role="progressbar"
				aria-valuenow={pct}
				aria-valuemin={0}
				aria-valuemax={100}
			>
				<div
					className="h-full rounded-full bg-primary-600"
					style={{ width: `${pct}%` }}
				/>
			</div>
			<span className="shrink-0 text-neutral-600 text-xs tabular-nums">
				{pct}%
			</span>
		</div>
	);
}
