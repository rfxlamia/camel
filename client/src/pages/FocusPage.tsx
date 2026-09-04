import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import FocusTimer from "../components/FocusTimer";
import { useBoard } from "../context/BoardContext";
import { useFocusSession } from "../context/FocusSessionContext";
import type { FocusSession } from "../types";

const TASK_LOAD_ERROR =
	"Couldn't load this task. Check your connection and try again.";

type TaskContent = {
	title: string;
	description: string;
};

export default function FocusPage() {
	const navigate = useNavigate();
	const { activeWorkspaceId, subscribeCardEvents, subscribeTrackerEvents } =
		useBoard();
	const { session, loading, actionError, start, pause, resume, finish } =
		useFocusSession();

	const finishingRef = useRef(false);
	const [pending, setPending] = useState(false);
	const [task, setTask] = useState<TaskContent | null>(null);
	const [taskLoading, setTaskLoading] = useState(false);
	const [taskError, setTaskError] = useState<string | null>(null);

	useEffect(() => {
		if (!loading && session === null && !finishingRef.current) {
			navigate("/board", { replace: true });
		}
	}, [loading, session, navigate]);

	const loadTask = useCallback(
		async (sess: FocusSession) => {
			if (activeWorkspaceId === null) return;
			setTaskLoading(true);
			setTaskError(null);
			try {
				if (sess.source === "board") {
					const card = await api.getCard(activeWorkspaceId, sess.taskId);
					setTask({ title: card.title, description: card.description });
				} else if (!sess.taskKey) {
					setTask(null);
					setTaskError(TASK_LOAD_ERROR);
				} else {
					const item = await api.getWorkItem(activeWorkspaceId, sess.taskKey);
					setTask({ title: item.title, description: item.description });
				}
			} catch {
				setTask(null);
				setTaskError(TASK_LOAD_ERROR);
			} finally {
				setTaskLoading(false);
			}
		},
		[activeWorkspaceId],
	);

	useEffect(() => {
		if (!session || activeWorkspaceId === null) return;
		void loadTask(session);
	}, [session, activeWorkspaceId, loadTask]);

	useEffect(() => {
		if (!session || session.source !== "board" || activeWorkspaceId === null) {
			return;
		}
		const taskId = session.taskId;
		return subscribeCardEvents((event) => {
			if (event.type === "card.updated" && event.cardId === taskId) {
				void loadTask(session);
			}
		});
	}, [session, activeWorkspaceId, subscribeCardEvents, loadTask]);

	useEffect(() => {
		if (!session || session.source !== "tracker" || activeWorkspaceId === null) {
			return;
		}
		const taskId = session.taskId;
		return subscribeTrackerEvents((event) => {
			if (
				event.type === "tracker.updated" &&
				event.trackerItemId !== undefined &&
				event.trackerItemId === taskId
			) {
				void loadTask(session);
			}
		});
	}, [session, activeWorkspaceId, subscribeTrackerEvents, loadTask]);

	const runAction = useCallback(async (action: () => Promise<void>) => {
		setPending(true);
		try {
			await action();
		} finally {
			setPending(false);
		}
	}, []);

	const handleFinish = useCallback(async () => {
		finishingRef.current = true;
		try {
			const finished = await finish();
			const path = finished.returnPath || "/board";
			navigate(path);
		} catch {
			finishingRef.current = false;
		}
	}, [finish, navigate]);

	if (loading || session === null) {
		return null;
	}

	if (taskLoading && task === null && taskError === null) {
		return (
			<p className="px-4 py-16 text-center text-sm text-neutral-500">
				Loading…
			</p>
		);
	}

	if (taskError) {
		return (
			<div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center gap-4 px-4 py-16 md:px-6">
				<div className="w-full rounded-md border border-error-500 bg-error-100 px-4 py-3 text-sm text-error-900">
					{taskError}
				</div>
				<button
					type="button"
					onClick={() => navigate("/board")}
					className="inline-flex items-center rounded-md border border-neutral-300 bg-neutral-100 px-4 py-2 text-sm font-medium text-primary-700 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				>
					Back to board
				</button>
			</div>
		);
	}

	return (
		<div className="mx-auto flex min-h-full max-w-2xl flex-col gap-8 bg-neutral-100 px-4 py-10 md:px-6">
			<div className="flex flex-col gap-3">
				<h1 className="font-sans text-xl leading-[1.2] text-neutral-900">
					{task?.title}
				</h1>
				{task?.description ? (
					<p className="font-sans text-base leading-normal text-neutral-700 whitespace-pre-wrap">
						{task.description}
					</p>
				) : null}
			</div>
			{actionError ? (
				<div className="rounded-md border border-error-500 bg-error-100 px-4 py-3 text-sm text-error-900">
					{actionError}
				</div>
			) : null}
			<FocusTimer
				session={session}
				pending={pending}
				onStart={() => runAction(start)}
				onPause={() => runAction(pause)}
				onResume={() => runAction(resume)}
				onFinish={handleFinish}
			/>
		</div>
	);
}
