import { useState } from "react";

/** Collapsible section following creative-brief design tokens */
export function SettingsSection({
	title,
	titleClassName = "text-neutral-800",
	defaultOpen = true,
	children,
}: {
	title: string;
	titleClassName?: string;
	defaultOpen?: boolean;
	children: React.ReactNode;
}) {
	const [isOpen, setIsOpen] = useState(defaultOpen);

	return (
		<div className="mb-6 overflow-hidden rounded-lg border border-neutral-200 bg-white">
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				className="flex w-full items-center justify-between px-4 py-3 text-base font-medium text-left hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
				aria-expanded={isOpen}
			>
				<span className={titleClassName}>{title}</span>
				<svg
					className={`h-4 w-4 text-neutral-500 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					strokeWidth={2}
					aria-hidden="true"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						d="M19 9l-7 7-7-7"
					/>
				</svg>
			</button>
			{isOpen && (
				<div className="border-t border-neutral-200 p-4 space-y-6">
					{children}
				</div>
			)}
		</div>
	);
}
