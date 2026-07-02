import { useEffect } from "react";
import { useBoard } from "../../context/BoardContext";
import { useTicketIntakeChat } from "../../hooks/useTicketIntakeChat";
import type { AutoErrorDetail } from "../../lib/ticketIntakeBus";
import { subscribeAutoError } from "../../lib/ticketIntakeBus";
import { TicketIntakeChatOverlay } from "./TicketIntakeChatOverlay";

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
	const {
		activeWorkspaceId,
		ticketIntakeEnabled,
		ticketIntakeEvents,
	} = useBoard();
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
