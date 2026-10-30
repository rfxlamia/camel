// Display formatters shared across feature modules and pages. Kept import-free
// so re-exports through client/src/types.ts never pull a feature barrel into
// the api.ts hub (hub↔barrel cycles split module identity under vi.mock).
export type WipStatus = "unlimited" | "under" | "at" | "over";

export function wipStatus(count: number, wipLimit: number | null): WipStatus {
	if (wipLimit === null) return "unlimited";
	if (count < wipLimit) return "under";
	if (count === wipLimit) return "at";
	return "over";
}

export function formatDuration(ms: number): string {
	const hour = 60 * 60 * 1000;
	const day = 24 * hour;
	if (ms < hour) return `${Math.max(1, Math.round(ms / (60 * 1000)))}m`;
	if (ms < day) return `${(ms / hour).toFixed(1).replace(/\.0$/, "")}h`;
	return `${(ms / day).toFixed(1).replace(/\.0$/, "")}d`;
}

export function formatRelativeTime(iso: string): string {
	const ms = Date.now() - new Date(iso).getTime();
	const minute = 60 * 1000;
	const hour = 60 * minute;
	const day = 24 * hour;
	if (ms < minute) return "just now";
	if (ms < hour) return `${Math.floor(ms / minute)}m ago`;
	if (ms < day) return `${Math.floor(ms / hour)}h ago`;
	return `${Math.floor(ms / day)}d ago`;
}

export const TEMPLATE_NAMES: Record<string, string> = {
	"research-report": "Research & Report",
	"status-report": "Status Report",
};

export function templateName(templateId: string): string {
	return TEMPLATE_NAMES[templateId] ?? templateId;
}
