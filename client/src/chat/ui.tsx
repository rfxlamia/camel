import {
	ComposerPrimitive,
	MessagePrimitive,
	ThreadPrimitive,
} from "@assistant-ui/react";

export function LocalThread() {
	return (
		<ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
			<ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4 py-3">
				<ThreadPrimitive.Messages>
					{() => (
						<MessagePrimitive.Root className="mb-4">
							<MessagePrimitive.Parts />
						</MessagePrimitive.Root>
					)}
				</ThreadPrimitive.Messages>
			</ThreadPrimitive.Viewport>
		</ThreadPrimitive.Root>
	);
}

export function LocalComposer() {
	return (
		<ComposerPrimitive.Root className="border-t border-neutral-200 bg-white px-4 py-3">
			<div className="flex items-end gap-2">
				<ComposerPrimitive.Input
					rows={1}
					placeholder="Message Camel…"
					className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
				/>
				<ComposerPrimitive.Send className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
					Send
				</ComposerPrimitive.Send>
			</div>
		</ComposerPrimitive.Root>
	);
}
