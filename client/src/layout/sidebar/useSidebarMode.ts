import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { getModeFromPath } from "./navItems";
import type { Mode } from "./shared";

export function useSidebarMode(): [Mode, (m: Mode) => void] {
	const location = useLocation();
	const [mode, setMode] = useState<Mode>(() =>
		getModeFromPath(location.pathname),
	);
	useEffect(() => {
		// Exact equality — NOT startsWith. Navigating TO /settings must not change mode;
		// leaving /settings to a mode route is URL-driven. Effect keyed on pathname only,
		// so a manual ModeSwitcher click persists until the next navigation.
		if (location.pathname !== "/settings") {
			setMode(getModeFromPath(location.pathname));
		}
	}, [location.pathname]);
	return [mode, setMode];
}
