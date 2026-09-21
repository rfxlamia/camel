import type { StagedImage } from "./addCardImageStaging";

interface AddCardImageChipsProps {
	stagedImages: StagedImage[];
	onRemove: (id: string) => void;
	onRetry: () => void;
}

export function AddCardImageChips({
	stagedImages,
	onRemove,
	onRetry,
}: AddCardImageChipsProps) {
	if (stagedImages.length === 0) return null;

	return (
		<div className="mt-2 flex flex-wrap items-center gap-1.5">
			{stagedImages.map((entry) => {
				const invalid =
					entry.kind === "invalid" || entry.kind === "network-error";
				const tone = invalid
					? "bg-error-100 text-error-900"
					: entry.kind === "loading"
						? "bg-neutral-100 text-neutral-700"
						: "bg-primary-100 text-primary-800";
				const label = `Image: ${entry.name}`;
				const ariaLabel =
					entry.kind === "invalid" || entry.kind === "network-error"
						? `${label}. ${entry.error}`
						: label;
				return (
					<span
						key={entry.id}
						className={`group inline-flex max-w-full items-center gap-0.5 rounded-full py-0.5 pr-1 pl-2 text-xs ${tone}`}
					>
						<button
							type="button"
							aria-label={ariaLabel}
							aria-invalid={invalid ? true : undefined}
							data-invalid={invalid ? "true" : undefined}
							className="max-w-40 truncate focus:outline-none"
						>
							{entry.kind === "loading" ? "Preparing…" : entry.name}
						</button>
						{entry.kind !== "loading" ? (
							<button
								type="button"
								aria-label={`Remove Image: ${entry.name}`}
								onClick={() => onRemove(entry.id)}
								className="shrink-0 rounded-full px-1 leading-none opacity-50 transition hover:bg-black/10 hover:opacity-100"
							>
								×
							</button>
						) : null}
						{entry.kind === "network-error" ? (
							<button
								type="button"
								aria-label={`Retry Image: ${entry.name}`}
								onClick={onRetry}
								className="shrink-0 rounded-full px-1 leading-none underline opacity-80 hover:opacity-100"
							>
								Retry
							</button>
						) : null}
					</span>
				);
			})}
		</div>
	);
}
