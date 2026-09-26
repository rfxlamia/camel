import type { ReactNode } from "react";
import type { Card } from "../../types";
import { formatRelativeTime } from "../../types";

export type FocusEntryButtonRenderer = (props: {
	source: "board";
	taskId: number;
	taskKey: string | null;
}) => ReactNode;

export const inputClass =
	"mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 placeholder:text-neutral-500 hover:border-neutral-400 focus:border-primary-600 focus:shadow-[0_0_0_3px_oklch(55%_0.076_250_/_0.15)] focus:outline-none";

export function issueIdentifierFromUrl(issueUrl: string): string {
	const segment = issueUrl.split("/").pop();
	return segment ?? issueUrl;
}

export function assigneeIdsEqual(a: number[], b: number[]): boolean {
	if (a.length !== b.length) return false;
	const sortedA = [...a].sort((x, y) => x - y);
	const sortedB = [...b].sort((x, y) => x - y);
	return sortedA.every((id, i) => id === sortedB[i]);
}

export function labelIdsEqual(a: number[], b: number[]): boolean {
	return assigneeIdsEqual(a, b);
}

export interface TaxonomyBaseline {
	priorityId: number | null;
	labelIds: number[];
	projectId: number | null;
	phaseId: number | null;
}

export function taxonomyFromCard(card: Card): TaxonomyBaseline {
	return {
		priorityId: card.priority?.id ?? null,
		labelIds: (card.labels ?? []).map((l) => l.id),
		projectId: card.projectId ?? null,
		phaseId: card.phaseId ?? null,
	};
}

export function MetaRow({
	label,
	value,
}: {
	label: string;
	value: string | null;
}) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<dt className="text-sm text-neutral-600">{label}</dt>
			<dd className="text-sm text-neutral-800">
				{value ? formatRelativeTime(value) : "—"}
			</dd>
		</div>
	);
}
