import { useEffect, useState } from "react";
import {
	computeDisplaySeconds,
	formatDurationParts,
} from "../lib/focusDuration";
import type { FocusSession } from "../types";

export type FocusTimerProps = {
	session: FocusSession;
	onStart: () => void;
	onPause: () => void;
	onResume: () => void;
	onFinish: () => void;
	pending?: boolean;
};

// Disabled buttons never match :active, so the press scale needs no guard.
const buttonBase =
	"inline-flex items-center justify-center rounded-md px-5 py-2.5 text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed";

const primaryButtonClass = `${buttonBase} bg-primary-600 text-white shadow-sm hover:bg-primary-700 hover:shadow disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none`;

const secondaryButtonClass = `${buttonBase} border border-neutral-300 bg-neutral-100 text-primary-700 hover:bg-neutral-200 disabled:border-neutral-200 disabled:bg-neutral-100 disabled:text-neutral-400`;

const STATE_LABEL: Record<FocusSession["state"], string> = {
	ready: "Ready when you are",
	running: "Focusing",
	paused: "Paused",
	finished: "Done",
};

// The dot carries the state before the words do: warm and pulsing while the
// clock runs, flat while it doesn't.
const DOT_CLASS: Record<FocusSession["state"], string> = {
	ready: "bg-neutral-300",
	running: "bg-accent-500 pulse-dot",
	paused: "bg-neutral-400",
	finished: "bg-neutral-300",
};

export default function FocusTimer({
	session,
	onStart,
	onPause,
	onResume,
	onFinish,
	pending = false,
}: FocusTimerProps) {
	const [, setTick] = useState(0);

	useEffect(() => {
		if (session.state !== "running") return;
		const id = window.setInterval(() => {
			setTick((t) => t + 1);
		}, 1000);
		return () => {
			window.clearInterval(id);
		};
	}, [session.state]);

	const displaySeconds = computeDisplaySeconds(
		session.accumulatedSeconds,
		session.state,
		session.runningSince,
	);
	const { major, seconds } = formatDurationParts(displaySeconds);
	const paused = session.state === "paused";

	return (
		<div className="flex flex-col items-center gap-7">
			{/* Minutes large, seconds small — a session counts up with no target,
			    so the seconds are precision rather than pressure. */}
			<p
				role="timer"
				data-testid="focus-duration"
				className={`flex items-baseline font-sans leading-none tabular-nums transition-colors duration-300 ease-out ${paused ? "text-neutral-500" : "text-primary-900"}`}
			>
				<span className="text-[clamp(3.8rem,11vw,7.5rem)] tracking-[-0.035em]">
					{major}
				</span>
				<span className="text-[clamp(1.3rem,3.7vw,2.55rem)] tracking-[-0.01em] text-neutral-500">
					{seconds}
				</span>
			</p>

			<p className="flex items-center gap-2 text-sm text-neutral-600">
				<span
					aria-hidden
					className={`relative inline-block h-1.5 w-1.5 rounded-full ${DOT_CLASS[session.state]}`}
				/>
				{STATE_LABEL[session.state]}
			</p>

			<div className="flex flex-wrap items-center justify-center gap-3">
				{session.state === "ready" ? (
					<button
						type="button"
						className={primaryButtonClass}
						disabled={pending}
						onClick={onStart}
					>
						Start
					</button>
				) : null}
				{/* Running has no primary button on purpose: the intended action is
				    to keep working, not to press anything. */}
				{session.state === "running" ? (
					<>
						<button
							type="button"
							className={secondaryButtonClass}
							disabled={pending}
							onClick={onPause}
						>
							Pause
						</button>
						<button
							type="button"
							className={secondaryButtonClass}
							disabled={pending}
							onClick={onFinish}
						>
							Finish focus
						</button>
					</>
				) : null}
				{session.state === "paused" ? (
					<>
						<button
							type="button"
							className={primaryButtonClass}
							disabled={pending}
							onClick={onResume}
						>
							Resume
						</button>
						<button
							type="button"
							className={secondaryButtonClass}
							disabled={pending}
							onClick={onFinish}
						>
							Finish focus
						</button>
					</>
				) : null}
			</div>
		</div>
	);
}
