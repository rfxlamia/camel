import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "../api";
import { useBoard } from "../context/BoardContext";
import { useFocusSession } from "../context/FocusSessionContext";
import type { WorkItemSource } from "../types";

export type FocusEntryButtonProps = {
	source: WorkItemSource;
	taskId: number;
	taskKey?: string | null;
};

function isSameTask(
	session: { source: WorkItemSource; taskId: number } | null,
	source: WorkItemSource,
	taskId: number,
): boolean {
	return (
		session !== null && session.source === source && session.taskId === taskId
	);
}

function FocusSwitchDialog({
	onConfirm,
	onCancel,
	pending,
}: {
	onConfirm: () => void;
	onCancel: () => void;
	pending: boolean;
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		cancelRef.current?.focus();
	}, []);

	useEffect(() => {
		const panel = panelRef.current;
		if (!panel) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onCancel();
				return;
			}
			if (e.key !== "Tab") return;

			const focusable = panel.querySelectorAll<HTMLElement>(
				"button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
			);
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (!first || !last) return;

			if (e.shiftKey) {
				if (document.activeElement === first) {
					e.preventDefault();
					last.focus();
				}
			} else if (document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [onCancel]);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
			role="dialog"
			aria-modal="true"
			aria-label="Switch focus"
		>
			<div
				ref={panelRef}
				className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-4 shadow-lg"
			>
				<p className="font-medium text-neutral-900">Switch focus?</p>
				<p className="mt-1 text-neutral-600 text-sm">
					Your current focus will be finished and the time you&apos;ve worked
					will be kept.
				</p>
				<div className="mt-4 flex gap-2">
					<button
						ref={cancelRef}
						type="button"
						disabled={pending}
						onClick={onCancel}
						className="flex-1 rounded-md border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={pending}
						onClick={() => void onConfirm()}
						className="flex-1 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
					>
						Switch focus
					</button>
				</div>
			</div>
		</div>
	);
}

export default function FocusEntryButton(props: FocusEntryButtonProps) {
	const { focusModeEnabled } = useBoard();
	if (!focusModeEnabled) {
		return null;
	}
	return <FocusEntryButtonInner {...props} />;
}

function FocusEntryButtonInner({ source, taskId }: FocusEntryButtonProps) {
	const navigate = useNavigate();
	const { showToast } = useBoard();
	const { session, focus, switchTo } = useFocusSession();
	const [pending, setPending] = useState(false);
	const [switchDialogOpen, setSwitchDialogOpen] = useState(false);

	const handleSwitchConfirm = useCallback(async () => {
		if (session === null) return;
		setPending(true);
		try {
			await switchTo({
				source,
				taskId,
				version: session.version,
				sessionId: session.id,
			});
			setSwitchDialogOpen(false);
			navigate("/focus");
		} catch {
			showToast("Couldn't switch focus. Try again.", "error");
		} finally {
			setPending(false);
		}
	}, [navigate, session, showToast, source, switchTo, taskId]);

	const handleClick = useCallback(async () => {
		if (pending) return;

		if (isSameTask(session, source, taskId)) {
			navigate("/focus");
			return;
		}

		setPending(true);
		try {
			await focus({ source, taskId });
			navigate("/focus");
		} catch (err) {
			if (
				err instanceof ApiError &&
				err.status === 409 &&
				err.code === "session_active"
			) {
				setSwitchDialogOpen(true);
				return;
			}
			showToast("Couldn't start focus. Try again.", "error");
		} finally {
			setPending(false);
		}
	}, [focus, navigate, pending, session, showToast, source, taskId]);

	return (
		<>
			<button
				type="button"
				disabled={pending}
				onClick={() => void handleClick()}
				className="rounded-md border border-neutral-300 bg-neutral-100 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
			>
				Focus on this task
			</button>
			{switchDialogOpen ? (
				<FocusSwitchDialog
					pending={pending}
					onCancel={() => {
						if (pending) return;
						setSwitchDialogOpen(false);
					}}
					onConfirm={handleSwitchConfirm}
				/>
			) : null}
		</>
	);
}
