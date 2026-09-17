export type TrackerAuxiliaryLoadState = "loading" | "ready" | "failed";

export function trackerAuxiliaryMessage(
	kind: "labels" | "members",
	state: TrackerAuxiliaryLoadState,
): string {
	if (state === "loading") return `Loading ${kind}…`;
	if (state === "failed") {
		const label = kind === "labels" ? "Labels" : "Members";
		return `${label} unavailable`;
	}
	return `No ${kind} in this workspace`;
}
