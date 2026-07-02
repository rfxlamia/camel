import { useState } from "react";
import { useBoard } from "../../context/BoardContext";
import { useTicketIntakeChat } from "../../hooks/useTicketIntakeChat";
import { PreviewScreen } from "./PreviewScreen";

const inputClass =
	"mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 placeholder:text-neutral-500 hover:border-neutral-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)] focus:outline-none";

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
		editDraft,
		submitState,
		resubmit,
	} = chat;

	const [input, setInput] = useState("");

	const handleSend = async () => {
		const trimmed = input.trim();
		if (!trimmed) return;
		setInput("");
		await sendMessage(trimmed);
	};

	const handleConfirm = (edited: {
		title: string;
		description: string;
	}) => {
		editDraft(edited);
		queueMicrotask(() => {
			void confirm();
		});
	};

	if (previewReady && draft) {
		return (
			<div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
				<PreviewScreen
					draft={draft}
					onConfirm={handleConfirm}
					onResubmit={resubmit}
					submitState={submitState}
				/>
			</div>
		);
	}

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
			</div>
			<div className="border-t border-neutral-200 p-4">
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
					className={inputClass}
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
						disabled={!input.trim()}
						className="rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.1)] hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
					>
						Send
					</button>
				</div>
			</div>
		</div>
	);
}
