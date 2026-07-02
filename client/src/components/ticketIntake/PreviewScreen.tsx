import { useState } from "react";
import type { TicketIntakeDraft } from "../../api";
import { ticketIntakeInputClass } from "./inputClass";

export type PreviewSubmitState = {
	status:
		| "idle"
		| "submitting"
		| "success"
		| "graceful_failure"
		| "rate_limited";
	issueUrl?: string;
	issueIdentifier?: string;
};

interface PreviewScreenProps {
	draft: Pick<TicketIntakeDraft, "title" | "description" | "type">;
	onConfirm: (edited: { title: string; description: string }) => void;
	onResubmit?: () => void;
	submitState: PreviewSubmitState;
}

export function PreviewScreen({
	draft,
	onConfirm,
	onResubmit,
	submitState,
}: PreviewScreenProps) {
	const [title, setTitle] = useState(draft.title ?? "");
	const [description, setDescription] = useState(draft.description ?? "");

	const confirmDisabled =
		title.trim() === "" ||
		submitState.status === "submitting" ||
		submitState.status === "rate_limited";

	if (submitState.status === "success") {
		return (
			<div className="space-y-3">
				<p className="text-sm text-neutral-800">
					Issue created
					{submitState.issueIdentifier ? (
						<>
							{" "}
							{submitState.issueUrl ? (
								<a
									href={submitState.issueUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="font-medium text-primary-600 hover:text-primary-700 underline underline-offset-2"
								>
									{submitState.issueIdentifier}
								</a>
							) : (
								<span className="font-medium text-neutral-900">
									{submitState.issueIdentifier}
								</span>
							)}
						</>
					) : null}
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{submitState.status === "submitting" && (
				<p className="text-sm text-neutral-600">Submitting…</p>
			)}

			{submitState.status === "graceful_failure" && (
				<div className="space-y-2">
					<p className="text-sm text-error-700">
						We could not create the issue. Please try again.
					</p>
					<button
						type="button"
						onClick={() => onResubmit?.()}
						className="rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.1)] hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						Resubmit
					</button>
				</div>
			)}

			{submitState.status === "rate_limited" && (
				<p className="text-sm text-neutral-600">
					Please wait before submitting again.
				</p>
			)}

			<div>
				<label htmlFor="ticket-preview-title" className="text-sm text-neutral-600">
					Title
				</label>
				<input
					id="ticket-preview-title"
					type="text"
					value={title}
					onChange={(event) => setTitle(event.target.value)}
					className={ticketIntakeInputClass}
				/>
			</div>

			<div>
				<label
					htmlFor="ticket-preview-description"
					className="text-sm text-neutral-600"
				>
					Description
				</label>
				<textarea
					id="ticket-preview-description"
					rows={5}
					value={description}
					onChange={(event) => setDescription(event.target.value)}
					className={ticketIntakeInputClass}
				/>
			</div>

			<div>
				<span className="text-sm text-neutral-600">Type</span>
				<p className="mt-1 text-sm font-medium text-neutral-900">
					{draft.type ?? "Bug"}
				</p>
			</div>

			<button
				type="button"
				onClick={() => onConfirm({ title, description })}
				disabled={confirmDisabled}
				className="w-full rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.1)] hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
			>
				Confirm
			</button>
		</div>
	);
}
