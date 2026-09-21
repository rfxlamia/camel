import { useEffect } from "react";
import { useBoard } from "../features/board";
import { TicketIntakeChatOverlay } from "./TicketIntakeChatOverlay";
import type { AutoErrorDetail } from "./ticketIntakeBus";
import { subscribeAutoError } from "./ticketIntakeBus";
import { useTicketIntakeChat } from "./useTicketIntakeChat";
import { useWorkspace } from "./WorkspaceContext";

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
	const { activeWorkspaceId, ticketIntakeEnabled } = useWorkspace();
	const { ticketIntakeEvents } = useBoard();
	const chat = useTicketIntakeChat({
		workspaceId: activeWorkspaceId,
		variant: "global",
		ticketIntakeEvents,
	});

	useEffect(() => {
		if (!ticketIntakeEnabled) return;
		return subscribeAutoError((detail) => {
			if (activeWorkspaceId === null) return;
			chat.open({
				variant: "autoError",
				prefill: autoErrorDetailToPrefill(detail),
			});
		});
	}, [activeWorkspaceId, chat.open, ticketIntakeEnabled]);

	if (
		activeWorkspaceId === null ||
		!ticketIntakeEnabled ||
		!chat.panelOpen ||
		chat.activeVariant !== "autoError"
	) {
		return null;
	}

	return (
		<TicketIntakeChatOverlay
			chat={chat}
			onClose={chat.close}
			ariaLabel="Report issue from error"
		/>
	);
}
