import { FileText, X } from "lucide-react";
import type { AgentFileMeta } from "../../types";

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AttachmentChipsProps {
	files: AgentFileMeta[];
	onRemove?: (id: number) => void;
}

/**
 * Compact chip row for attached agent files. With onRemove the chips are
 * editable (composer); without it they render read-only (transcript).
 */
export default function AttachmentChips({
	files,
	onRemove,
}: AttachmentChipsProps) {
	if (files.length === 0) return null;

	return (
		<div className="flex flex-wrap gap-1.5">
			{files.map((file) => (
				<span
					key={file.id}
					className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-xs text-neutral-700 shadow-sm"
				>
					<FileText
						size={12}
						className="shrink-0 text-primary-600"
						aria-hidden
					/>
					<span className="truncate" title={file.filename}>
						{file.filename}
					</span>
					<span className="shrink-0 text-neutral-400">
						{formatSize(file.sizeBytes)}
					</span>
					{file.truncated && (
						<span className="shrink-0 rounded bg-warning-100 px-1 text-[10px] font-medium text-warning-900">
							truncated
						</span>
					)}
					{onRemove && (
						<button
							type="button"
							onClick={() => onRemove(file.id)}
							aria-label={`Remove ${file.filename}`}
							className="shrink-0 rounded-full p-0.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
						>
							<X size={12} aria-hidden />
						</button>
					)}
				</span>
			))}
		</div>
	);
}
