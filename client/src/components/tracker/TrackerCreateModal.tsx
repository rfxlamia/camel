import { X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../../api";
import type { TrackerVocabulary } from "../../types";

interface Props {
	workspaceId: number;
	onClose: () => void;
	onCreated: () => void;
	statuses: TrackerVocabulary[];
	priorities: TrackerVocabulary[];
}

export default function TrackerCreateModal({
	workspaceId,
	onClose,
	onCreated,
	statuses,
	priorities,
}: Props) {
	const [title, setTitle] = useState("");
	const [statusId, setStatusId] = useState<number | undefined>();
	const [priorityId, setPriorityId] = useState<number | null | undefined>();
	const [submitting, setSubmitting] = useState(false);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (!title.trim() || submitting) return;
		setSubmitting(true);
		try {
			const body: {
				title: string;
				statusId?: number;
				priorityId?: number | null;
			} = { title: title.trim() };
			if (statusId !== undefined) body.statusId = statusId;
			if (priorityId !== undefined) body.priorityId = priorityId;
			await api.createTrackerItem(workspaceId, body);
			onCreated();
			onClose();
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4">
			<div className="absolute inset-0" onClick={onClose} aria-hidden />
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="tracker-create-title"
				className="relative w-full max-w-md rounded-xl border border-neutral-200 bg-white shadow-lg"
			>
				<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
					<h2
						id="tracker-create-title"
						className="text-base font-semibold text-neutral-900"
					>
						New tracker item
					</h2>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						<X size={16} />
					</button>
				</div>
				<form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 p-4">
					<div>
						<label
							htmlFor="tracker-create-item-title"
							className="mb-1 block text-sm font-medium text-neutral-700"
						>
							Title
						</label>
						<input
							id="tracker-create-item-title"
							type="text"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							autoFocus
						/>
					</div>

					{statuses.length > 0 && (
						<fieldset>
							<legend className="mb-1.5 text-sm font-medium text-neutral-700">
								Status
							</legend>
							<div className="flex flex-wrap gap-2">
								{statuses.map((s) => (
									<label
										key={s.id}
										className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors ${
											statusId === s.id
												? "border-primary-600 bg-primary-50 text-primary-700"
												: "border-neutral-300 text-neutral-700 hover:bg-neutral-50"
										}`}
									>
										<input
											type="radio"
											name="tracker-status"
											className="sr-only"
											checked={statusId === s.id}
											onChange={() => setStatusId(s.id)}
											aria-label={s.name}
										/>
										{s.name}
									</label>
								))}
							</div>
						</fieldset>
					)}

					{priorities.length > 0 && (
						<fieldset>
							<legend className="mb-1.5 text-sm font-medium text-neutral-700">
								Priority
							</legend>
							<div className="flex flex-wrap gap-2">
								{priorities.map((p) => (
									<label
										key={p.id}
										className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors ${
											priorityId === p.id
												? "border-primary-600 bg-primary-50 text-primary-700"
												: "border-neutral-300 text-neutral-700 hover:bg-neutral-50"
										}`}
									>
										<input
											type="radio"
											name="tracker-priority"
											className="sr-only"
											checked={priorityId === p.id}
											onChange={() => setPriorityId(p.id)}
											aria-label={p.name}
										/>
										{p.name}
									</label>
								))}
							</div>
						</fieldset>
					)}

					<div className="flex justify-end gap-2 pt-1">
						<button
							type="button"
							onClick={onClose}
							className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!title.trim() || submitting}
							className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							Create
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
