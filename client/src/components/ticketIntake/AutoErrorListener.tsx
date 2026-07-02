import { X } from "lucide-react";
import { useEffect } from "react";
import { useBoard } from "../../context/BoardContext";
import { useTicketIntakeChat } from "../../hooks/useTicketIntakeChat";
import type { AutoErrorDetail } from "../../lib/ticketIntakeBus";
import { subscribeAutoError } from "../../lib/ticketIntakeBus";
import { ChatPanel } from "./ChatPanel";

function autoErrorDetailToPrefill(detail: AutoErrorDetail) {
	return {
		endpoint: detail.endpoint,
		status: detail.status,
		errorMessage: detail.message,
		timestamp: detail.timestamp,
		userAction: detail.userAction,
	};
}

export function AutoErrorListener() {
	const { activeWorkspaceId, ticketIntakeEvents } = useBoard();
	const chat = useTicketIntakeChat({
		workspaceId: activeWorkspaceId,
		variant: "global",
		ticketIntakeEvents,
	});

	useEffect(() => {
		return subscribeAutoError((detail) => {
			if (activeWorkspaceId === null) return;
			chat.open({
				variant: "autoError",
				prefill: autoErrorDetailToPrefill(detail),
			});
		});
	}, [activeWorkspaceId, chat.open]);

	if (
		activeWorkspaceId === null ||
		!chat.panelOpen ||
		chat.activeVariant !== "autoError"
	) {
		return null;
	}

	return (
		<div
			className="fixed inset-0 z-[9999] flex items-end justify-end p-4 sm:items-center sm:justify-center sm:p-6"
			role="dialog"
			aria-label="Report issue from error"
		>
			<button
				type="button"
				aria-label="Close chat overlay"
				className="absolute inset-0 bg-neutral-900/30"
				onClick={chat.close}
			/>
			<div className="relative z-10 flex h-[min(32rem,calc(100vh-2rem))] w-full max-w-md flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg">
				<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
					<h2 className="text-sm font-medium text-neutral-900">
						Report issue
					</h2>
					<button
						type="button"
						aria-label="Close chat"
						onClick={chat.close}
						className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						<X size={16} aria-hidden />
					</button>
				</div>
				<ChatPanel chat={chat} onClose={chat.close} />
			</div>
		</div>
	);
}
