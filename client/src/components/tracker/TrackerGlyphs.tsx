import type { TrackerStatusCategory, TrackerVocabulary } from "../../types";

/**
 * Workflow glyphs derived from vocabulary category — a status renders as a ring
 * filled in proportion to how far along the workflow it sits, so custom
 * vocabularies get meaningful icons without hardcoded name lists.
 */

export type StatusShape = "pending" | "progress" | "done" | "cancelled";

export interface StatusGlyphSpec {
	shape: StatusShape;
	/** 0..1 — share of the ring that is filled. */
	fraction: number;
}

const CATEGORY_SHAPE: Record<TrackerStatusCategory, StatusShape> = {
	canceled: "cancelled",
	completed: "done",
	backlog: "pending",
	started: "progress",
};

/** Ordered statuses, cancelled ones excluded from the progress scale. */
export function statusGlyphSpec(
	statuses: TrackerVocabulary[],
	statusId: number,
): StatusGlyphSpec {
	const ordered = [...statuses].sort((a, b) => a.position - b.position);
	const status = ordered.find((s) => s.id === statusId);
	if (!status) return { shape: "pending", fraction: 0 };

	const category = status.category ?? null;
	if (category === null) return { shape: "pending", fraction: 0 };

	const shape = CATEGORY_SHAPE[category];
	if (category !== "started") {
		return { shape, fraction: category === "backlog" ? 0 : 1 };
	}

	const flow = ordered.filter((s) => s.category !== "canceled");
	if (flow.length === 1) return { shape: "progress", fraction: 1 };
	const index = flow.findIndex((s) => s.id === statusId);
	const fraction = index / (flow.length - 1);
	return { shape: "progress", fraction };
}

/** Bars lit for a priority, 1..3, highest position-rank first. */
export function priorityBars(
	priorities: TrackerVocabulary[],
	priorityId: number,
): number {
	const ordered = [...priorities].sort((a, b) => a.position - b.position);
	const index = ordered.findIndex((p) => p.id === priorityId);
	if (index < 0) return 0;
	const rank = (ordered.length - index) / ordered.length;
	return Math.min(3, Math.max(1, Math.round(rank * 3)));
}

const RADIUS = 5;
const CIRCUMFERENCE = 2 * Math.PI * (RADIUS / 2);

export function StatusGlyph({
	spec,
	size = 14,
}: {
	spec: StatusGlyphSpec;
	size?: number;
}) {
	const tone =
		spec.shape === "done"
			? "text-primary-600"
			: spec.shape === "progress"
				? "text-[oklch(55%_0.100_85)]"
				: "text-neutral-500";

	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 14 14"
			className={`shrink-0 ${tone}`}
			aria-hidden
		>
			{spec.shape === "done" || spec.shape === "cancelled" ? (
				<>
					<circle cx="7" cy="7" r={RADIUS + 1} fill="currentColor" />
					<path
						d={
							spec.shape === "done"
								? "M4.4 7.1 6.2 8.9 9.6 5.3"
								: "M4.8 4.8 9.2 9.2 M9.2 4.8 4.8 9.2"
						}
						stroke="white"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						fill="none"
					/>
				</>
			) : (
				<>
					<circle
						cx="7"
						cy="7"
						r={RADIUS}
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeDasharray={spec.shape === "pending" ? "1.6 2.2" : undefined}
						strokeLinecap="round"
					/>
					{spec.fraction > 0 && (
						<circle
							cx="7"
							cy="7"
							r={RADIUS / 2}
							fill="none"
							stroke="currentColor"
							strokeWidth={RADIUS}
							strokeDasharray={`${CIRCUMFERENCE * spec.fraction} ${CIRCUMFERENCE}`}
							transform="rotate(-90 7 7)"
						/>
					)}
				</>
			)}
		</svg>
	);
}

export function PriorityGlyph({
	bars,
	size = 14,
}: {
	bars: number;
	size?: number;
}) {
	if (bars === 0) {
		return (
			<svg
				width={size}
				height={size}
				viewBox="0 0 14 14"
				className="shrink-0 text-neutral-500"
				aria-hidden
			>
				{[3, 7, 11].map((x) => (
					<rect
						key={x}
						x={x - 1}
						y="6.4"
						width="2"
						height="1.4"
						rx="0.7"
						fill="currentColor"
					/>
				))}
			</svg>
		);
	}
	const heights = [4, 7, 10];
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 14 14"
			className="shrink-0 text-neutral-700"
			aria-hidden
		>
			{heights.map((h, i) => (
				<rect
					key={h}
					x={2 + i * 4}
					y={12 - h}
					width="2.6"
					height={h}
					rx="1"
					fill="currentColor"
					opacity={i < bars ? 1 : 0.22}
				/>
			))}
		</svg>
	);
}

export function LabelDot({ colour }: { colour: string }) {
	return (
		<span
			className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-neutral-300 ring-inset"
			style={{ backgroundColor: colour }}
			aria-hidden
		/>
	);
}

export function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return "?";
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, size = 18 }: { name: string; size?: number }) {
	return (
		<span
			className="flex shrink-0 items-center justify-center rounded-full bg-primary-100 font-semibold text-[9px] text-primary-700"
			style={{ width: size, height: size }}
			aria-hidden
		>
			{initials(name)}
		</span>
	);
}

/**
 * Quiet, name-free trigger content for a row's assignee field — up to 2
 * overlapping avatars, each carrying the real name in a native tooltip so
 * identity is still discoverable without a bordered name pill.
 */
export function AvatarStack({
	members,
	testId,
}: {
	members: { id: number; displayName: string }[];
	testId?: string;
}) {
	return (
		<span
			data-testid={testId}
			className="-space-x-1 flex shrink-0 items-center"
		>
			{members.length === 0 ? (
				<span
					className="h-[18px] w-[18px] rounded-full border border-neutral-300 border-dashed"
					aria-hidden
				/>
			) : (
				members.slice(0, 2).map((m) => (
					<span key={m.id} title={m.displayName} className="flex">
						<Avatar name={m.displayName} size={18} />
					</span>
				))
			)}
		</span>
	);
}

const LABEL_DOT_CLUSTER_MAX = 3;

/**
 * Quiet, name-free trigger content for a row's label field — colored dots
 * only, each carrying the real name in a native tooltip.
 */
export function LabelDotCluster({
	labels,
	testId,
}: {
	labels: { id: number; name: string; colour: string }[];
	testId?: string;
}) {
	const shown = labels.slice(0, LABEL_DOT_CLUSTER_MAX);
	const overflow = labels.length - shown.length;
	return (
		<span data-testid={testId} className="flex shrink-0 items-center gap-1">
			{labels.length === 0 ? (
				<span
					className="h-2.5 w-2.5 rounded-full border border-neutral-300 border-dashed"
					aria-hidden
				/>
			) : (
				<>
					{shown.map((l) => (
						<span key={l.id} title={l.name} className="flex">
							<LabelDot colour={l.colour} />
						</span>
					))}
					{overflow > 0 && (
						<span className="text-[10px] text-neutral-500" aria-hidden>
							+{overflow}
						</span>
					)}
				</>
			)}
		</span>
	);
}
