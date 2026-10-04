interface ThinkingBadgeProps {
	enabled: boolean;
}

/** Whether this column requests extended thinking (columns.reasoning). */
export default function ThinkingBadge({ enabled }: ThinkingBadgeProps) {
	return (
		<div>
			<span className="text-xs font-medium text-neutral-600">
				Extended Thinking:
			</span>
			<span
				className={`ml-2 rounded-md px-2 py-0.5 text-xs font-medium ${
					enabled
						? "bg-success-100 text-success-900"
						: "bg-neutral-100 text-neutral-700"
				}`}
			>
				{enabled ? "ON" : "OFF"}
			</span>
		</div>
	);
}
