import { Check, LoaderCircle } from "lucide-react";
import type { MyWorkDoneActionController } from "./useMyWorkDoneAction";

const ACTION_BUTTON =
	"inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-primary-300 bg-white px-2.5 font-medium text-primary-700 text-xs shadow-sm transition-colors hover:bg-primary-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 motion-reduce:transition-none disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-200 disabled:text-neutral-400";

type MyWorkDoneActionViewProps = MyWorkDoneActionController & {
	className: string;
};

type ActionButtonProps = Pick<
	MyWorkDoneActionController,
	"identity" | "reasonId" | "handleClick" | "inFlight" | "completed" | "disabledReason"
>;

function ActionButton({
	identity,
	reasonId,
	handleClick,
	inFlight,
	completed,
	disabledReason,
}: ActionButtonProps) {
	return (
		<button
			type="button"
			onClick={handleClick}
			disabled={disabledReason !== null}
			aria-label="Mark done"
			aria-describedby={reasonId}
			data-testid={`my-work-done-action-${identity.replace(/[^a-zA-Z0-9_-]+/g, "-")}`}
			className={ACTION_BUTTON}
		>
			{inFlight ? (
				<LoaderCircle
					size={14}
					className="animate-spin motion-reduce:animate-none"
					aria-hidden
				/>
			) : (
				<Check size={14} aria-hidden />
			)}
			{completed ? "Done" : "Mark done"}
		</button>
	);
}

function ActionMessage({
	message,
}: Pick<MyWorkDoneActionController, "message">) {
	if (!message) return null;
	return (
		<span
			role={message.kind === "success" ? "status" : "alert"}
			className={`text-[11px] ${message.kind === "success" ? "text-success-900" : message.kind === "warning" ? "text-warning-900" : "text-error-900"}`}
		>
			{message.message}
		</span>
	);
}

export default function MyWorkDoneActionView({
	identity,
	reasonId,
	handleClick,
	inFlight,
	completed,
	disabledReason,
	message,
	className,
}: MyWorkDoneActionViewProps) {
	return (
		<span
			className={`inline-flex min-w-0 flex-col items-end gap-1 ${className}`}
		>
			<ActionButton
				identity={identity}
				reasonId={reasonId}
				handleClick={handleClick}
				inFlight={inFlight}
				completed={completed}
				disabledReason={disabledReason}
			/>
			<span
				id={reasonId}
				role={disabledReason ? "note" : undefined}
				className={`max-w-56 text-right text-[11px] leading-snug ${disabledReason ? "text-neutral-600" : "sr-only"}`}
			>
				{disabledReason ?? "Marks this work item done."}
			</span>
			<ActionMessage message={message} />
		</span>
	);
}
