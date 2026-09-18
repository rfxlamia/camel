import { ListTodo, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { TaskTitleEditor } from "../../shared/TaskTitleEditor";
import { TrackerCreateMetadataFields } from "./TrackerCreateMetadataFields";
import {
	type TrackerCreateModalProps,
	useTrackerCreateModal,
} from "./useTrackerCreateModal";

const DIALOG_FOCUSABLE_SELECTOR =
	"button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function getDialogFocusableElements(panel: HTMLElement): HTMLElement[] {
	return Array.from(
		panel.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR),
	);
}

export default function TrackerCreateModal(props: TrackerCreateModalProps) {
	const {
		onClose,
		statuses,
		priorities,
		description,
		setDescription,
		labels,
		members,
		projects,
		submitting,
		error,
		fieldErrors,
		createMore,
		setCreateMore,
		openPicker,
		setOpenPicker,
		titleEditorKey,
		setTitleValid,
		titleEditorRef,
		hideProjectPickers,
		metadataDraft,
		dispatchMetadata,
		commandFields,
		handleSubmit,
		titleFilled,
	} = useTrackerCreateModal(props);
	const panelRef = useRef<HTMLDivElement>(null);
	const openerRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		const active = document.activeElement;
		if (active instanceof HTMLElement) openerRef.current = active;
		panelRef.current?.querySelector<HTMLElement>("textarea")?.focus();
		return () => {
			const opener = openerRef.current;
			openerRef.current = null;
			if (opener?.isConnected) opener.focus();
		};
	}, []);

	useEffect(() => {
		const panel = panelRef.current;
		if (!panel) return;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Tab") return;
			if (openPicker || titleEditorRef.current?.isCommandOpen()) return;

			const focusable = getDialogFocusableElements(panel);
			const first = focusable[0];
			const last = focusable.at(-1);
			if (!first || !last) return;

			if (event.shiftKey) {
				if (document.activeElement === first) {
					event.preventDefault();
					last.focus();
				}
			} else if (document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [openPicker, titleEditorRef]);

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral-900/40 p-4 pt-[10vh] backdrop-blur-[2px]">
			<div
				className="absolute inset-0"
				data-testid="tracker-create-backdrop"
				onMouseDown={() => (openPicker ? setOpenPicker(null) : onClose())}
				aria-hidden
			/>
			<div
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="tracker-create-title"
				className="relative w-full max-w-2xl rounded-xl border border-neutral-200 bg-white shadow-[0_16px_48px_rgba(23,42,62,0.18)]"
			>
				<div className="flex items-center justify-between px-4 pt-3.5 pb-1">
					<div className="flex min-w-0 items-center gap-2">
						<span className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 font-medium text-neutral-700 text-xs">
							<ListTodo size={13} aria-hidden />
							Tracker
						</span>
						<span className="text-neutral-400" aria-hidden>
							›
						</span>
						<h2
							id="tracker-create-title"
							className="truncate font-medium text-neutral-900 text-sm"
						>
							New item
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

				<form
					onSubmit={(e) => void handleSubmit(e)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							void handleSubmit();
						}
					}}
				>
					<div className="px-4 pt-2">
						<div
							className="w-full font-medium text-[20px] text-neutral-900 leading-tight"
							data-field-error={fieldErrors.title ?? undefined}
						>
							<TaskTitleEditor
								key={titleEditorKey}
								ref={titleEditorRef}
								fields={commandFields}
								draft={metadataDraft}
								dispatch={dispatchMetadata}
								placeholder="Item title"
								fieldErrors={fieldErrors}
								suppressPlainEnter
								layeredEscape
								onTitleChange={(plain) =>
									setTitleValid(plain.trim().length > 0)
								}
							/>
						</div>
						<label
							htmlFor="tracker-create-item-description"
							className="sr-only"
						>
							Description
						</label>
						<textarea
							id="tracker-create-item-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={4}
							placeholder="Add description…"
							data-field-error={fieldErrors.description ?? undefined}
							aria-invalid={fieldErrors.description ? true : undefined}
							className="mt-2 w-full resize-none border-0 bg-transparent text-neutral-700 text-sm placeholder:text-neutral-500 focus:outline-none"
						/>
					</div>

					<div className="px-4 pb-3">
						<TrackerCreateMetadataFields
							draft={metadataDraft}
							dispatch={dispatchMetadata}
							openPicker={openPicker}
							onOpenPickerChange={setOpenPicker}
							statuses={statuses}
							priorities={priorities}
							labels={labels}
							members={members}
							projects={projects}
							hideProjectPickers={hideProjectPickers}
							fieldErrors={fieldErrors}
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
							role="switch"
							aria-checked={createMore}
							onClick={() => setCreateMore((v) => !v)}
							className="inline-flex items-center gap-2 text-neutral-600 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							<span
								className={`flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors ${
									createMore ? "bg-primary-600" : "bg-neutral-300"
								}`}
								aria-hidden
							>
								<span
									className={`h-3 w-3 rounded-full bg-white transition-transform ${
										createMore ? "translate-x-3" : ""
									}`}
								/>
							</span>
							Create more
						</button>
						<button
							type="button"
							onClick={onClose}
							className="rounded-md px-3 py-1.5 text-neutral-700 text-sm transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!titleFilled || submitting}
							className="rounded-md bg-primary-600 px-3 py-1.5 font-medium text-sm text-white shadow-[0_1px_2px_rgba(0,0,0,0.1)] transition-colors hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none"
						>
							Create item
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
