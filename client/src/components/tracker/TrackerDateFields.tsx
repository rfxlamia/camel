const inputClass =
	"rounded-md border border-neutral-300 bg-white px-2 py-1 text-neutral-900 text-sm tabular-nums hover:border-neutral-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)] focus:outline-none";

interface Props {
	startDate: string;
	endDate: string;
	onStartDateChange: (value: string) => void;
	onEndDateChange: (value: string) => void;
	/** Distinguishes inputs when multiple instances appear on one page. */
	idPrefix?: string;
	/** Chip row uses compact inline fields; the detail rail uses labelled blocks. */
	layout?: "chips" | "rail";
}

export default function TrackerDateFields({
	startDate,
	endDate,
	onStartDateChange,
	onEndDateChange,
	idPrefix = "tracker",
	layout = "chips",
}: Props) {
	const startId = `${idPrefix}-start-date`;
	const endId = `${idPrefix}-end-date`;

	if (layout === "rail") {
		return (
			<div className="space-y-2">
				<label className="block">
					<span className="text-neutral-500 text-xs">Start date</span>
					<input
						id={startId}
						type="date"
						aria-label="Start date"
						className={`mt-1 w-full ${inputClass}`}
						value={startDate}
						onChange={(e) => onStartDateChange(e.target.value)}
					/>
				</label>
				<label className="block">
					<span className="text-neutral-500 text-xs">End date</span>
					<input
						id={endId}
						type="date"
						aria-label="End date"
						className={`mt-1 w-full ${inputClass}`}
						value={endDate}
						onChange={(e) => onEndDateChange(e.target.value)}
					/>
				</label>
			</div>
		);
	}

	return (
		<>
			<label
				htmlFor={startId}
				className="inline-flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-100 px-2.5 text-sm text-neutral-600"
			>
				<span className="text-neutral-500">Start</span>
				<input
					id={startId}
					type="date"
					aria-label="Start date"
					className="border-0 bg-transparent p-0 text-neutral-900 text-sm tabular-nums focus:outline-none"
					value={startDate}
					onChange={(e) => onStartDateChange(e.target.value)}
				/>
			</label>
			<label
				htmlFor={endId}
				className="inline-flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-100 px-2.5 text-sm text-neutral-600"
			>
				<span className="text-neutral-500">End</span>
				<input
					id={endId}
					type="date"
					aria-label="End date"
					className="border-0 bg-transparent p-0 text-neutral-900 text-sm tabular-nums focus:outline-none"
					value={endDate}
					onChange={(e) => onEndDateChange(e.target.value)}
				/>
			</label>
		</>
	);
}
