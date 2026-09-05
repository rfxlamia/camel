import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import FocusTimer from "../components/FocusTimer";
import { useBoard } from "../context/BoardContext";
import { useFocusSession } from "../context/FocusSessionContext";
import type { FocusSession } from "../types";

const TASK_LOAD_ERROR =
	"Couldn't load this task. Check your connection and try again.";

const exitButtonClass =
	"inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-neutral-600 transition-colors duration-150 ease-out hover:bg-neutral-200 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600";

const focusLoadingScreen = (
	<div className="focus-field flex min-h-full items-center justify-center px-6">
		<p className="text-sm text-neutral-500">Loading…</p>
	</div>
);

type TaskContent = {
	title: string;
	description: string;
};

export default function FocusPage() {
	const navigate = useNavigate();
	const {
		activeWorkspaceId,
		focusSessionHydrated,
		subscribeCardEvents,
		subscribeTrackerEvents,
	} = useBoard();
	const { session, loading, actionError, start, pause, resume, finish } =
		useFocusSession();

	const finishingRef = useRef(false);
	const [pending, setPending] = useState(false);
	const [task, setTask] = useState<TaskContent | null>(null);
	const [taskLoading, setTaskLoading] = useState(false);
	const [taskError, setTaskError] = useState<string | null>(null);
	const taskLoadGeneration = useRef(0);

	// Redirect only once the session fetch has actually settled. `loading`
	// alone is not enough: workspace selection and workspacesReady commit
	// together, so this page can mount while the provider still reports the
	// loading=false it set on its no-workspace branch. Child effects run
	// before parent effects, so the guard would fire before the fetch began
	// and a reload on /focus would bounce to /board with a live session.
	useEffect(() => {
		if (
			!loading &&
			focusSessionHydrated &&
			session === null &&
			!finishingRef.current
		) {
			navigate("/board", { replace: true });
		}
	}, [loading, focusSessionHydrated, session, navigate]);

	// This surface hides the app chrome, so it needs its own way out. Leaving
	// does not finish the session — it stays live and the header indicator
	// brings the user back.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			// An open modal owns Escape — the workspace picker and blocking
			// invite render on this surface too, and dismissing one must not
			// also route the user off the page.
			if (document.querySelector('[role="dialog"]')) return;
			navigate("/board");
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [navigate]);

	const loadTask = useCallback(
		async (sess: FocusSession) => {
			if (activeWorkspaceId === null) return;
			const generation = ++taskLoadGeneration.current;
			setTaskLoading(true);
			setTaskError(null);
			try {
				if (sess.source === "board") {
					const card = await api.getCard(activeWorkspaceId, sess.taskId);
					if (generation !== taskLoadGeneration.current) return;
					setTask({ title: card.title, description: card.description });
				} else if (!sess.taskKey) {
					if (generation !== taskLoadGeneration.current) return;
					setTask(null);
					setTaskError(TASK_LOAD_ERROR);
				} else {
					const item = await api.getWorkItem(activeWorkspaceId, sess.taskKey);
					if (generation !== taskLoadGeneration.current) return;
					setTask({ title: item.title, description: item.description });
				}
			} catch {
				if (generation !== taskLoadGeneration.current) return;
				setTask(null);
				setTaskError(TASK_LOAD_ERROR);
			} finally {
				if (generation === taskLoadGeneration.current) {
					setTaskLoading(false);
				}
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
		if (
			!session ||
			session.source !== "tracker" ||
			activeWorkspaceId === null
		) {
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

	// The app chrome that used to signal "still loading" is gone on this
	// surface, so an empty return would read as a broken white window.
	if (loading || !focusSessionHydrated) {
		return focusLoadingScreen;
	}

	if (session === null) {
		return null;
	}

	if (taskLoading && task === null && taskError === null) {
		return focusLoadingScreen;
	}

	if (taskError) {
		return (
			<div className="focus-field flex min-h-full flex-col items-center justify-center gap-5 px-6">
				<p className="max-w-[46ch] rounded-md border border-error-500 bg-error-100 px-4 py-3 text-center text-sm text-error-900">
					{taskError}
				</p>
				<button
					type="button"
					onClick={() => navigate("/board")}
					className={exitButtonClass}
				>
					<ArrowLeft size={15} aria-hidden />
					Back to board
				</button>
			</div>
		);
	}

	return (
		<div className="focus-field flex min-h-full flex-col">
			<div className="flex shrink-0 items-center px-4 py-4 md:px-6">
				<button
					type="button"
					onClick={() => navigate("/board")}
					className={`-ml-2.5 ${exitButtonClass}`}
				>
					<ArrowLeft size={15} aria-hidden />
					Back to board
				</button>
			</div>

			<div className="flex flex-1 flex-col items-center justify-center px-6 pb-20">
				<h1 className="focus-enter max-w-[22ch] text-balance text-center font-sans text-lg font-medium leading-[1.3] tracking-[-0.01em] text-neutral-900 md:text-xl">
					{task?.title}
				</h1>

				{actionError ? (
					<p className="mt-5 max-w-[46ch] rounded-md border border-error-500 bg-error-100 px-4 py-3 text-center text-sm text-error-900">
						{actionError}
					</p>
				) : null}

				<div className="focus-enter mt-12" style={{ animationDelay: "70ms" }}>
					<FocusTimer
						session={session}
						pending={pending}
						onStart={() => runAction(start)}
						onPause={() => runAction(pause)}
						onResume={() => runAction(resume)}
						onFinish={handleFinish}
					/>
				</div>

				{task?.description ? (
					<div
						className="focus-enter mt-16 w-full max-w-[58ch] border-t border-neutral-300/70 pt-5"
						style={{ animationDelay: "150ms" }}
					>
						<p className="whitespace-pre-wrap font-sans text-sm leading-[1.65] text-neutral-600">
							{task.description}
						</p>
					</div>
				) : null}
			</div>
		</div>
	);
}
