import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
	icon: LucideIcon;
	title: string;
	description: string;
	/** Primary call-to-action — every empty state should invite a next step. */
	action?: ReactNode;
	className?: string;
}

/**
 * Shared empty state — icon chip + title + description + a CTA that tells the
 * user what to do next (brief copy guideline: never a dead end).
 */
export default function EmptyState({
	icon: Icon,
	title,
	description,
	action,
	className = "",
}: Props) {
	return (
		<div
			className={`animate-rise-in flex flex-col items-center text-center ${className}`}
		>
			<span
				className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-100 text-primary-600 ring-1 ring-primary-200/60"
				aria-hidden
			>
				<Icon size={26} />
			</span>
			<h3 className="mt-4 text-lg font-semibold text-neutral-900">{title}</h3>
			<p className="mt-1 max-w-sm text-sm leading-relaxed text-neutral-600">
				{description}
			</p>
			{action && <div className="mt-5">{action}</div>}
		</div>
	);
}
