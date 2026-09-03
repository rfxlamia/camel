export type TaskFieldCatalogState =
	| "loading"
	| "ready"
	| "empty"
	| "failed"
	| "disabled";

export interface TaskFieldCommandOption {
	id: string;
	label: string;
	hint?: string;
}

export interface TaskFieldCommandPopoverProps {
	stage: "field" | "value";
	listLabel: string;
	options: TaskFieldCommandOption[];
	activeIndex: number;
	selectedIds: string[];
	multiple?: boolean;
	catalogState?: TaskFieldCatalogState;
	onRetry?: () => void;
	listboxId: string;
}

export function TaskFieldCommandPopover({
	stage: _stage,
	listLabel,
	options,
	activeIndex,
	selectedIds,
	multiple = false,
	catalogState = "ready",
	onRetry,
	listboxId,
}: TaskFieldCommandPopoverProps) {
	const optionId = (id: string) => `${listboxId}-${id}`;

	if (catalogState === "loading") {
		return (
			<div
				role="listbox"
				aria-label={listLabel}
				id={listboxId}
				className="absolute top-full left-0 z-50 mt-1 w-60 rounded-lg border border-neutral-200 bg-white p-2 text-neutral-500 text-sm shadow-[0_8px_24px_rgba(23,42,62,0.12)]"
			>
				Loading…
			</div>
		);
	}

	if (catalogState === "failed") {
		return (
			<div
				role="listbox"
				aria-label={listLabel}
				id={listboxId}
				className="absolute top-full left-0 z-50 mt-1 w-60 rounded-lg border border-neutral-200 bg-white p-2 text-sm shadow-[0_8px_24px_rgba(23,42,62,0.12)]"
			>
				<p className="text-neutral-700">Could not load options.</p>
				{onRetry ? (
					<button
						type="button"
						onClick={onRetry}
						className="mt-1 text-primary-600 text-sm hover:underline"
					>
						Retry
					</button>
				) : null}
			</div>
		);
	}

	if (catalogState === "disabled") {
		return (
			<div
				role="listbox"
				aria-label={listLabel}
				id={listboxId}
				className="absolute top-full left-0 z-50 mt-1 w-60 rounded-lg border border-neutral-200 bg-white p-2 text-neutral-500 text-sm shadow-[0_8px_24px_rgba(23,42,62,0.12)]"
			>
				Unavailable
			</div>
		);
	}

	if (catalogState === "empty" || options.length === 0) {
		return (
			<div
				role="listbox"
				aria-label={listLabel}
				id={listboxId}
				className="absolute top-full left-0 z-50 mt-1 w-60 rounded-lg border border-neutral-200 bg-white p-2 text-neutral-500 text-sm shadow-[0_8px_24px_rgba(23,42,62,0.12)]"
			>
				No options
			</div>
		);
	}

	return (
		<ul
			id={listboxId}
			role="listbox"
			aria-label={listLabel}
			aria-multiselectable={multiple || undefined}
			className="absolute top-full left-0 z-50 mt-1 max-h-64 w-60 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-[0_8px_24px_rgba(23,42,62,0.12)]"
		>
			{options.map((option, index) => {
				const selected = selectedIds.includes(option.id);
				return (
					<li key={option.id} role="presentation">
						<div
							id={optionId(option.id)}
							role="option"
							aria-selected={selected}
							className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-neutral-900 text-sm ${
								index === activeIndex ? "bg-neutral-100" : ""
							}`}
						>
							<span className="min-w-0 flex-1 truncate">{option.label}</span>
							{option.hint ? (
								<span className="shrink-0 text-neutral-500 text-xs">
									{option.hint}
								</span>
							) : null}
							{selected ? (
								<span className="shrink-0 text-primary-600 text-xs">✓</span>
							) : null}
						</div>
					</li>
				);
			})}
		</ul>
	);
}

export function isPickerUnavailable(
	catalogState: TaskFieldCatalogState | undefined,
	options: TaskFieldCommandOption[],
): boolean {
	if (!catalogState || catalogState === "ready") {
		return options.length === 0;
	}
	return (
		catalogState === "loading" ||
		catalogState === "failed" ||
		catalogState === "disabled" ||
		catalogState === "empty"
	);
}
