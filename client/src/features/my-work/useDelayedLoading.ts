import { useEffect, useRef, useState } from "react";

/** Wait this long before showing a loading surface, so fast fetches never flash. */
export const SKELETON_SHOW_DELAY_MS = 200;
/** Once shown, keep the surface up at least this long so it does not blink off. */
export const SKELETON_MIN_VISIBLE_MS = 300;

function clearTimer(ref: { current: ReturnType<typeof setTimeout> | null }) {
	if (ref.current === null) return;
	clearTimeout(ref.current);
	ref.current = null;
}

/**
 * Delayed loading flag with a minimum visible time.
 * Hidden until `loading` has been true for {@link SKELETON_SHOW_DELAY_MS}.
 * After it appears, it stays true until both loading is false and
 * {@link SKELETON_MIN_VISIBLE_MS} have elapsed since it appeared.
 */
export function useDelayedLoading(loading: boolean): boolean {
	const [visible, setVisible] = useState(false);
	const visibleRef = useRef(false);
	const shownAtRef = useRef<number | null>(null);
	const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		const hide = () => {
			shownAtRef.current = null;
			visibleRef.current = false;
			setVisible(false);
		};
		const show = () => {
			shownAtRef.current = Date.now();
			visibleRef.current = true;
			setVisible(true);
		};

		if (loading) {
			clearTimer(holdTimerRef);
			if (visibleRef.current) return;
			delayTimerRef.current = setTimeout(() => {
				delayTimerRef.current = null;
				show();
			}, SKELETON_SHOW_DELAY_MS);
			return () => clearTimer(delayTimerRef);
		}

		clearTimer(delayTimerRef);
		if (!visibleRef.current) return;

		const shownAt = shownAtRef.current ?? Date.now();
		const remaining = Math.max(
			0,
			SKELETON_MIN_VISIBLE_MS - (Date.now() - shownAt),
		);
		if (remaining === 0) {
			hide();
			return;
		}
		holdTimerRef.current = setTimeout(() => {
			holdTimerRef.current = null;
			hide();
		}, remaining);
		return () => clearTimer(holdTimerRef);
	}, [loading]);

	return visible;
}
