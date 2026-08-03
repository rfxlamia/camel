import { useEffect } from "react";

export default function CalendarConflictNotice({
	onDismiss,
}: {
	onDismiss: () => void;
}) {
	useEffect(() => {
		const timer = setTimeout(onDismiss, 3000);
		return () => clearTimeout(timer);
	}, [onDismiss]);

	return (
		<span
			className="ml-1 text-[10px] font-medium text-warning-700"
			data-testid="calendar-conflict-notice"
		>
			Updated elsewhere
		</span>
	);
}
