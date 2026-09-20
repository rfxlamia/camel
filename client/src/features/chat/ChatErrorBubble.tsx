import { RefreshCw } from "lucide-react";

interface ChatErrorBubbleProps {
	message: string;
	canRetry?: boolean;
	onRetry?: () => void;
}

export function ChatErrorBubble({
	message,
	canRetry = true,
	onRetry,
}: ChatErrorBubbleProps) {
	return (
		<div className="rounded-lg border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-900">
			<p>{message}</p>
			{canRetry && onRetry && (
				<button
					type="button"
					onClick={onRetry}
					className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-error-300 bg-white px-3 py-1.5 text-xs font-medium text-error-800 hover:bg-error-100"
				>
					<RefreshCw size={12} aria-hidden />
					Retry
				</button>
			)}
		</div>
	);
}
