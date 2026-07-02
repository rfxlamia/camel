import { useState } from "react";
import { useBoard } from "../../context/BoardContext";
import { useTicketIntakeChat } from "../../hooks/useTicketIntakeChat";
import { ticketIntakeInputClass } from "./inputClass";
import { PreviewScreen } from "./PreviewScreen";

interface ChatPanelProps {
	onClose: () => void;
	chat?: ReturnType<typeof useTicketIntakeChat>;
}

export function ChatPanel({ onClose, chat: chatOverride }: ChatPanelProps) {
	const { activeWorkspaceId, ticketIntakeEvents } = useBoard();
	const internalChat = useTicketIntakeChat({
		workspaceId: activeWorkspaceId,
		variant: "global",
		ticketIntakeEvents,
	});
	const chat = chatOverride ?? internalChat;

	const {
		messages,
		sendMessage,
		previewReady,
		draft,
		confirm,
		submitState,
		resubmit,
		isSending,
		chatSendBlocked,
		sendError,
	} = chat;

	const [input, setInput] = useState("");

	const handleSend = async () => {
		const trimmed = input.trim();
		if (!trimmed || chatSendBlocked || isSending) return;
		setInput("");
		await sendMessage(trimmed);
	};

	if (previewReady && draft) {
		return (
			<div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
				<PreviewScreen
					draft={draft}
					onConfirm={(edited) => {
						void confirm(edited);
					}}
					onResubmit={resubmit}
					submitState={submitState}
				/>
			</div>
		);
	}

	const sendDisabled = !input.trim() || chatSendBlocked || isSending;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
				{messages.map((message, index) => (
					<div
						key={`${message.role}-${index}`}
						className={
							message.role === "user"
								? "ml-8 rounded-lg bg-primary-100 px-3 py-2 text-sm text-neutral-900"
								: "mr-8 rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-800"
						}
					>
						{message.content}
					</div>
				))}
				{isSending && (
					<p className="mr-8 text-sm text-neutral-500">Thinking…</p>
				)}
			</div>
			<div className="border-t border-neutral-200 p-4">
				{sendError && (
					<p className="mb-2 text-sm text-error-700">{sendError}</p>
				)}
				{chatSendBlocked && !sendError && (
					<p className="mb-2 text-sm text-neutral-600">
						Please wait a moment before sending another message.
					</p>
				)}
				<label htmlFor="ticket-intake-input" className="sr-only">
					Your message
				</label>
				<textarea
					id="ticket-intake-input"
					rows={3}
					value={input}
					onChange={(event) => setInput(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							void handleSend();
						}
					}}
					placeholder="Describe the issue..."
					className={ticketIntakeInputClass}
				/>
				<div className="mt-2 flex justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						className="rounded-md px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => void handleSend()}
						disabled={sendDisabled}
						className="rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.1)] hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						Send
					</button>
				</div>
			</div>
		</div>
	);
}
