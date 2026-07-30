import * as AssistantUIModule from "@assistant-ui/react";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { api } from "../api";
import { ChatRuntimeProvider } from "../chat/ChatRuntimeProvider";
import { LocalComposer, LocalThread } from "../chat/ui";
import type { ChatThread } from "../types";

type AssistantUIExtras = {
	Thread?: React.ComponentType;
	Composer?: React.ComponentType;
};

const { Thread = LocalThread, Composer = LocalComposer } =
	AssistantUIModule as typeof AssistantUIModule & AssistantUIExtras;

export default function ChatPage() {
	const { threadId: threadIdParam } = useParams();
	const navigate = useNavigate();
	const [threads, setThreads] = useState<ChatThread[]>([]);
	const [loading, setLoading] = useState(true);

	const loadThreads = useCallback(async () => {
		const list = await api.chat.listThreads();
		setThreads(list);
		return list;
	}, []);

	useEffect(() => {
		let cancelled = false;
		void loadThreads().finally(() => {
			if (!cancelled) setLoading(false);
		});
		return () => {
			cancelled = true;
		};
	}, [loadThreads]);

	const redirectTarget =
		!loading && !threadIdParam
			? threads.length > 0
				? `/chat/${threads[0].id}`
				: null
			: null;

	useEffect(() => {
		if (loading || threadIdParam || threads.length > 0) return;
		let cancelled = false;
		void api.chat.createThread().then((thread) => {
			if (!cancelled) navigate(`/chat/${thread.id}`, { replace: true });
		});
		return () => {
			cancelled = true;
		};
	}, [loading, navigate, threadIdParam, threads.length]);

	const handleNewThread = async () => {
		const thread = await api.chat.createThread();
		await loadThreads();
		navigate(`/chat/${thread.id}`);
	};

	const handleDeleteThread = async (thread: ChatThread) => {
		if (
			(thread.messageCount ?? 0) > 0 &&
			!window.confirm(
				`Delete "${thread.title}"? This thread has ${thread.messageCount} messages and cannot be undone.`,
			)
		) {
			return;
		}
		await api.chat.deleteThread(thread.id);
		const remaining = await loadThreads();
		if (String(thread.id) === threadIdParam) {
			if (remaining.length > 0) {
				navigate(`/chat/${remaining[0].id}`, { replace: true });
			} else {
				const created = await api.chat.createThread();
				navigate(`/chat/${created.id}`, { replace: true });
			}
		}
	};

	return (
		<div className="flex min-h-0 flex-1">
			{redirectTarget && <Navigate to={redirectTarget} replace />}

			<aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50">
				<div className="border-b border-neutral-200 p-3">
					<button
						type="button"
						onClick={() => void handleNewThread()}
						className="flex w-full items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-100"
					>
						<Plus size={16} aria-hidden />
						New chat
					</button>
				</div>
				<nav className="flex-1 overflow-y-auto p-2">
					{threads.map((thread) => {
						const active = String(thread.id) === threadIdParam;
						return (
							<div
								key={thread.id}
								className={`group mb-1 flex items-center gap-1 rounded-lg ${active ? "bg-white shadow-sm" : "hover:bg-neutral-100"}`}
							>
								<button
									type="button"
									onClick={() => navigate(`/chat/${thread.id}`)}
									className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm text-neutral-800"
								>
									{thread.title || "Untitled"}
								</button>
								<button
									type="button"
									aria-label={`Delete ${thread.title || "Untitled"}`}
									onClick={() => void handleDeleteThread(thread)}
									className="mr-1 rounded p-1 text-neutral-400 opacity-0 hover:bg-neutral-200 hover:text-neutral-700 group-hover:opacity-100"
								>
									<Trash2 size={14} aria-hidden />
								</button>
							</div>
						);
					})}
				</nav>
			</aside>

			<div className="flex min-w-0 flex-1 flex-col bg-white">
				<ChatRuntimeProvider threadId={threadIdParam}>
					<Thread />
					<Composer />
				</ChatRuntimeProvider>
			</div>
		</div>
	);
}
