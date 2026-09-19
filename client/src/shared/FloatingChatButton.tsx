import { MessageSquarePlus } from "lucide-react";
import { useBoard } from "../context/BoardContext";
import { TicketIntakeChatOverlay } from "./TicketIntakeChatOverlay";
import { useTicketIntakeChat } from "./useTicketIntakeChat";
import { useWorkspace } from "./WorkspaceContext";

export function FloatingChatButton() {
	const { activeWorkspaceId, ticketIntakeEnabled } = useWorkspace();
	const { ticketIntakeEvents } = useBoard();
	const chat = useTicketIntakeChat({
		workspaceId: activeWorkspaceId,
		variant: "global",
		ticketIntakeEvents,
	});

	if (activeWorkspaceId === null || !ticketIntakeEnabled) return null;

	return (
		<>
			<button
				type="button"
				aria-label="Report issue"
				onClick={chat.openPanel}
				className="fixed bottom-6 right-6 z-[9999] flex h-14 w-14 items-center justify-center rounded-full bg-primary-600 text-white shadow-[0_1px_2px_rgba(0,0,0,0.1)] hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
			>
				<MessageSquarePlus size={22} aria-hidden />
			</button>

			<TicketIntakeChatOverlay chat={chat} onClose={chat.close} />
		</>
	);
}
