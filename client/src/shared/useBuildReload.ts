import { useEffect } from "react";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function useBuildReload(): void {
	useEffect(() => {
		let capturedId: string | null = null;
		let reloading = false;
		let inFlight = false;
		let active = true;

		const check = async () => {
			if (inFlight || reloading) return;
			inFlight = true;
			try {
				const res = await fetch("/api/health", { cache: "no-store" });
				if (!res.ok) return;
				const body = await res.json();
				const buildId = body?.buildId;
				if (!active || typeof buildId !== "string" || buildId === "") return;
				if (capturedId === null) {
					capturedId = buildId;
				} else if (buildId !== capturedId) {
					reloading = true;
					window.location.reload();
				}
			} catch {
				return;
			} finally {
				inFlight = false;
			}
		};

		const onVisibility = () => {
			if (document.visibilityState === "visible") void check();
		};

		void check();
		document.addEventListener("visibilitychange", onVisibility);
		const timer = setInterval(() => void check(), CHECK_INTERVAL_MS);

		return () => {
			active = false;
			document.removeEventListener("visibilitychange", onVisibility);
			clearInterval(timer);
		};
	}, []);
}
