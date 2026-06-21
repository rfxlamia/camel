import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
	icon: LucideIcon;
	title: string;
	subtitle?: string;
	/** Right-aligned actions (buttons, pills). */
	actions?: ReactNode;
}

/**
 * Shared page identity header — icon chip + title + subtitle + optional actions.
 * Gives each page a clear hero and consistent rhythm (per creative brief: calm,
 * Linear/Notion). The global topbar stays a thin breadcrumb so this leads.
 */
export default function PageHeader({
	icon: Icon,
	title,
	subtitle,
	actions,
}: Props) {
	return (
		<header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
			<div className="flex items-start gap-3">
				<span
					className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700 ring-1 ring-primary-200/60"
					aria-hidden
				>
					<Icon size={18} />
				</span>
				<div className="min-w-0">
					<h1 className="text-xl font-semibold tracking-tight text-neutral-900">
						{title}
					</h1>
					{subtitle && (
						<p className="mt-0.5 text-sm text-neutral-600">{subtitle}</p>
					)}
				</div>
			</div>
			{actions && (
				<div className="flex shrink-0 items-center gap-2">{actions}</div>
			)}
		</header>
	);
}
