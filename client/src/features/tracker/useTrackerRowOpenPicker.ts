import { useEffect, useRef, useState } from "react";
import type { TrackerRowDatePopoverHandle } from "./TrackerRowDatePopover";

export type OpenPicker =
	| "date"
	| "status"
	| "priority"
	| "project"
	| "phase"
	| "assignees"
	| "labels"
	| "kebab"
	| null;

export function useTrackerRowOpenPicker() {
	const [openPicker, setOpenPicker] = useState<OpenPicker>(null);
	const pendingPickerRef = useRef<OpenPicker>(null);
	const datePopoverRef = useRef<TrackerRowDatePopoverHandle>(null);
	const kebabRef = useRef<HTMLButtonElement>(null);

	const requestPicker = (next: OpenPicker) => {
		if (openPicker === "date" && next !== "date" && next !== null) {
			if (datePopoverRef.current?.tryClose() === false) return;
			pendingPickerRef.current = next;
			setOpenPicker(null);
			return;
		}
		setOpenPicker(next);
	};

	useEffect(() => {
		if (openPicker === null && pendingPickerRef.current !== null) {
			const pending = pendingPickerRef.current;
			pendingPickerRef.current = null;
			setOpenPicker(pending);
		}
	}, [openPicker]);

	return { openPicker, requestPicker, datePopoverRef, kebabRef };
}
