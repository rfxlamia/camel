import type { ReactNode } from "react";
import { useNavigate } from "react-router";

interface Props {
	itemKey: string;
	itemTitle: string;
	children: ReactNode;
}

/** Overlay-button row chrome shared by TrackerRow and search result rows. */
export default function TrackerRowShell({
	itemKey,
	itemTitle,
	children,
}: Props) {
	const navigate = useNavigate();

	return (
		<div className="group/row relative flex h-9 items-center transition-colors hover:bg-neutral-100/70">
			<button
				type="button"
				data-testid={`tracker-row-${itemKey}`}
				aria-label={`${itemKey} ${itemTitle}`}
				onClick={() => navigate(`/tracker/${itemKey}`)}
				className="absolute inset-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-600"
			/>
			<div className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-2.5 px-4 text-left text-sm md:px-6">
				{children}
			</div>
		</div>
	);
}
