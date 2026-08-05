import { type FormEvent, useState } from "react";
import TrackerDateFields from "./TrackerDateFields";

export interface PhaseEditorValues {
	name: string;
	subtitle: string;
	startDate: string;
	endDate: string;
}

interface Props {
	mode: "create" | "edit";
	initialName?: string;
	initialSubtitle?: string;
	initialStartDate?: string;
	initialEndDate?: string;
	onSubmit: (values: PhaseEditorValues) => void | Promise<void>;
	onCancel: () => void;
	submitting?: boolean;
	error?: string | null;
	idPrefix?: string;
}

export default function TrackerPhaseEditor({
	mode,
	initialName = "",
	initialSubtitle = "",
	initialStartDate = "",
	initialEndDate = "",
	onSubmit,
	onCancel,
	submitting = false,
	error = null,
	idPrefix = "tracker-phase",
}: Props) {
	const [name, setName] = useState(initialName);
	const [subtitle, setSubtitle] = useState(initialSubtitle);
	const [startDate, setStartDate] = useState(initialStartDate);
	const [endDate, setEndDate] = useState(initialEndDate);

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		if (!name.trim() || submitting) return;
		void onSubmit({
			name: name.trim(),
			subtitle: subtitle.trim(),
			startDate,
			endDate,
		});
	};

	return (
		<form
			onSubmit={handleSubmit}
			className="border-neutral-200 border-b bg-white px-4 py-3 md:px-6"
		>
			<div className="space-y-3">
				<label className="block">
					<span className="mb-1 block font-medium text-neutral-700 text-sm">
						Phase name
					</span>
					<input
						type="text"
						aria-label="Phase name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						className="h-9 w-full rounded-md border border-neutral-200 bg-white px-3 text-neutral-900 text-sm placeholder:text-neutral-500 focus:border-primary-600 focus-visible:outline-none"
					/>
				</label>
				<label className="block">
					<span className="mb-1 block font-medium text-neutral-700 text-sm">
						Subtitle
						<span className="font-normal text-neutral-500"> (optional)</span>
					</span>
					<input
						type="text"
						aria-label="Phase subtitle"
						value={subtitle}
						onChange={(e) => setSubtitle(e.target.value)}
						className="h-9 w-full rounded-md border border-neutral-200 bg-white px-3 text-neutral-900 text-sm placeholder:text-neutral-500 focus:border-primary-600 focus-visible:outline-none"
					/>
				</label>
				{mode === "edit" && (
					<TrackerDateFields
						layout="rail"
						idPrefix={idPrefix}
						startDate={startDate}
						endDate={endDate}
						onStartDateChange={setStartDate}
						onEndDateChange={setEndDate}
					/>
				)}
			</div>
			<div className="mt-3 flex items-center justify-end gap-3">
				{error && (
					<p
						role="alert"
						className="mr-auto text-error-900 text-sm font-medium"
					>
						{error}
					</p>
				)}
				<button
					type="button"
					onClick={onCancel}
					className="rounded-md px-3 py-1.5 text-neutral-600 text-sm transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Cancel
				</button>
				<button
					type="submit"
					disabled={!name.trim() || submitting}
					className="rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-60"
				>
					{mode === "create" ? "Create" : "Save"}
				</button>
			</div>
		</form>
	);
}
