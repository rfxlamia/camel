import { MessageSquarePlus, X } from "lucide-react";
import { useState } from "react";
import { useBoard } from "../../context/BoardContext";
import { ChatPanel } from "./ChatPanel";

export function FloatingChatButton() {
	const { activeWorkspaceId } = useBoard();
	const [open, setOpen] = useState(false);

	if (activeWorkspaceId === null) return null;

	return (
		<>
			<button
				type="button"
				aria-label="Report issue"
				onClick={() => setOpen(true)}
				className="fixed bottom-6 right-6 z-[9999] flex h-14 w-14 items-center justify-center rounded-full bg-primary-600 text-white shadow-[0_1px_2px_rgba(0,0,0,0.1)] hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
			>
				<MessageSquarePlus size={22} aria-hidden />
			</button>

			{open && (
				<div
					className="fixed inset-0 z-[9999] flex items-end justify-end p-4 sm:items-center sm:justify-center sm:p-6"
					role="dialog"
					aria-label="Report issue chat"
				>
					<button
						type="button"
						aria-label="Close chat overlay"
						className="absolute inset-0 bg-neutral-900/30"
						onClick={() => setOpen(false)}
					/>
					<div className="relative z-10 flex h-[min(32rem,calc(100vh-2rem))] w-full max-w-md flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg">
						<div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
							<h2 className="text-sm font-medium text-neutral-900">
								Report issue
							</h2>
							<button
								type="button"
								aria-label="Close chat"
								onClick={() => setOpen(false)}
								className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
							>
								<X size={16} aria-hidden />
							</button>
						</div>
						<ChatPanel onClose={() => setOpen(false)} />
					</div>
				</div>
			)}
		</>
	);
}
