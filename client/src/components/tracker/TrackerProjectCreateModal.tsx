import { FolderKanban, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { ApiError, api } from "../../api";

interface Props {
	workspaceId: number;
	onClose: () => void;
	onCreated: () => void;
}

export default function TrackerProjectCreateModal({
	workspaceId,
	onClose,
	onCreated,
}: Props) {
	const [name, setName] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	const handleSubmit = async (e?: FormEvent) => {
		e?.preventDefault();
		if (submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			await api.createTrackerProject(workspaceId, { name: name.trim() });
			onCreated();
			onClose();
		} catch (err) {
			if (
				err instanceof ApiError &&
				(err.status === 400 || err.status === 409)
			) {
				setError(err.message);
			} else {
				setError("Could not create the project. Try again.");
			}
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral-900/40 p-4 pt-[10vh] backdrop-blur-[2px]">
			<div
				className="absolute inset-0"
				data-testid="tracker-project-create-backdrop"
				onMouseDown={onClose}
				aria-hidden
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="tracker-project-create-title"
				className="relative w-full max-w-md rounded-xl border border-neutral-200 bg-white shadow-[0_16px_48px_rgba(23,42,62,0.18)]"
			>
				<div className="flex items-center justify-between px-4 pt-3.5 pb-1">
					<div className="flex min-w-0 items-center gap-2">
						<span className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 font-medium text-neutral-700 text-xs">
							<FolderKanban size={13} aria-hidden />
							Tracker
						</span>
						<span className="text-neutral-400" aria-hidden>
							›
						</span>
						<h2
							id="tracker-project-create-title"
							className="truncate font-medium text-neutral-900 text-sm"
						>
							New project
						</h2>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="rounded-md p-1 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						<X size={16} aria-hidden />
					</button>
				</div>

				<form onSubmit={(e) => void handleSubmit(e)}>
					<div className="px-4 pt-2 pb-3">
						<label
							htmlFor="tracker-project-create-name"
							className="mb-1.5 block font-medium text-neutral-700 text-sm"
						>
							Project name
						</label>
						<input
							id="tracker-project-create-name"
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. Rilis v2"
							autoFocus
							className="h-9 w-full rounded-md border border-neutral-200 bg-white px-3 text-neutral-900 text-sm placeholder:text-neutral-500 focus:border-primary-600 focus-visible:outline-none"
						/>
					</div>

					<div className="flex items-center justify-end gap-3 border-neutral-200 border-t px-4 py-3">
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
							onClick={onClose}
							className="rounded-md px-3 py-1.5 text-neutral-600 text-sm transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={submitting}
							className="rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-60"
						>
							Create project
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
