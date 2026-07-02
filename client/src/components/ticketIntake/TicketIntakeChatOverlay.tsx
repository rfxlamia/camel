import { X } from "lucide-react";
import type { useTicketIntakeChat } from "../../hooks/useTicketIntakeChat";
import { ChatPanel } from "./ChatPanel";

type TicketIntakeChat = ReturnType<typeof useTicketIntakeChat>;

interface TicketIntakeChatOverlayProps {
	chat: TicketIntakeChat;
	onClose: () => void;
	ariaLabel?: string;
}

export function TicketIntakeChatOverlay({
	chat,
	onClose,
	ariaLabel = "Report issue chat",
}: TicketIntakeChatOverlayProps) {
	if (!chat.panelOpen) return null;

	return (
		<div
			className="fixed inset-0 z-[9999] flex items-end justify-end p-4 sm:items-center sm:justify-center sm:p-6"
			role="dialog"
			aria-label={ariaLabel}
		>
			<button
				type="button"
				aria-label="Close chat overlay"
				className="absolute inset-0 bg-neutral-900/30"
				onClick={onClose}
			/>
			<div className="relative z-10 flex h-[min(32rem,calc(100vh-2rem))] w-full max-w-md flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg">
				<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
					<h2 className="text-sm font-medium text-neutral-900">Report issue</h2>
					<button
						type="button"
						aria-label="Close chat"
						onClick={onClose}
						className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						<X size={16} aria-hidden />
					</button>
				</div>
				<ChatPanel chat={chat} onClose={onClose} />
			</div>
		</div>
	);
}
