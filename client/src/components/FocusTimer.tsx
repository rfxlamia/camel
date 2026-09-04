import { useEffect, useState } from "react";
import { computeDisplaySeconds, formatDuration } from "../lib/focusDuration";
import type { FocusSession } from "../types";

export type FocusTimerProps = {
	session: FocusSession;
	onStart: () => void;
	onPause: () => void;
	onResume: () => void;
	onFinish: () => void;
	pending?: boolean;
};

const primaryButtonClass =
	"rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400";

const secondaryButtonClass =
	"rounded-md border border-neutral-300 bg-neutral-100 px-4 py-2 text-sm font-medium text-primary-700 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-100 disabled:text-neutral-400";

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

	return (
		<div className="flex flex-col items-center gap-6">
			<p
				className="font-sans text-xl leading-[1.2] text-neutral-900 tabular-nums"
				data-testid="focus-duration"
			>
				{formatDuration(displaySeconds)}
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
