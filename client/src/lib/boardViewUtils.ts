import type { Card } from "../types";

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

export function isCardDone(card: Card): boolean {
	return card.doneAt !== null;
}

/** Today as a "YYYY-MM-DD" calendar string in the user's local timezone. */
export function todayISODate(): string {
	const d = new Date();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${m}-${day}`;
}

/** "2026-06-21" → "Jun 21". Parsed from the string to avoid timezone shifts. */
export function formatDueDate(iso: string): string {
	const [, m, d] = iso.split("-").map(Number);
	return `${MONTHS[m - 1]} ${d}`;
}

/** Initials for the assignee avatar: "Jane Doe" → "JD", "cher" → "CH". */
export function assigneeInitials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function isDueOverdue(card: Card): boolean {
	if (card.dueDate === null) return false;
	if (isCardDone(card)) return false;
	// Date-only string compare is valid because ISO "YYYY-MM-DD" sorts lexically.
	return card.dueDate < todayISODate();
}
