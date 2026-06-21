import {
	Activity as ActivityIcon,
	ArrowRight,
	LayoutDashboard,
	Minus,
	TrendingDown,
	TrendingUp,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { api } from "../api";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import { useBoard } from "../context/BoardContext";
import type { MetricsHistoryBucket } from "../types";
import { formatDuration, formatRelativeTime } from "../types";
import { describeEvent } from "./ActivityPage";

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_WEEKS = 8;

// One consistent color per metric, from the creative brief palette.
const COLORS = {
	throughput: "#4e759d", // primary-600
	leadTime: "#98624f", // accent-600
	cycleTime: "#47769d", // info-500
	wip: "#49814c", // success-500
	grid: "#e2e5e7", // neutral-200
	tick: "#6d7277", // neutral-600
};

const AXIS_TICK = { fill: COLORS.tick, fontSize: 11 };

interface ChartPoint {
	week: string;
	throughput: number;
	leadDays: number | null;
	cycleDays: number | null;
	wip: number;
}

function toChartPoints(history: MetricsHistoryBucket[]): ChartPoint[] {
	return history.map((b) => ({
		week: new Date(b.weekStart).toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
		}),
		throughput: b.throughput,
		leadDays:
			b.avgLeadTimeMs === null ? null : +(b.avgLeadTimeMs / DAY_MS).toFixed(1),
		cycleDays:
			b.avgCycleTimeMs === null
				? null
				: +(b.avgCycleTimeMs / DAY_MS).toFixed(1),
		wip: b.wipCount,
	}));
}

type Tone = "good" | "bad" | "flat";

interface Delta {
	direction: "up" | "down" | "flat";
	tone: Tone;
	text: string;
}

/** Week-over-week delta for counts (more is better when goodWhen="up"). */
function countDelta(
	current: number | undefined,
	previous: number | undefined,
	goodWhen: "up" | "down" | "neutral",
): Delta | null {
	if (current === undefined || previous === undefined) return null;
	const diff = current - previous;
	if (diff === 0)
		return { direction: "flat", tone: "flat", text: "same as last week" };
	const direction = diff > 0 ? "up" : "down";
	const tone: Tone =
		goodWhen === "neutral" ? "flat" : direction === goodWhen ? "good" : "bad";
	return {
		direction,
		tone,
		text: `${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs last week`,
	};
}

/** Week-over-week delta for durations (less is better). */
function durationDelta(
	currentMs: number | null | undefined,
	previousMs: number | null | undefined,
): Delta | null {
	if (currentMs == null || previousMs == null) return null;
	const diff = currentMs - previousMs;
	if (Math.abs(diff) < 60 * 1000) {
		return { direction: "flat", tone: "flat", text: "same as last week" };
	}
	return {
		direction: diff > 0 ? "up" : "down",
		tone: diff > 0 ? "bad" : "good",
		text: `${diff > 0 ? "+" : "−"}${formatDuration(Math.abs(diff))} vs last week`,
	};
}

const TONE_CLASS: Record<Tone, string> = {
	good: "bg-success-100 text-success-900",
	bad: "bg-error-100 text-error-900",
	flat: "bg-neutral-100 text-neutral-500",
};

function DeltaPill({ delta }: { delta: Delta }) {
	const Icon =
		delta.direction === "up"
			? TrendingUp
			: delta.direction === "down"
				? TrendingDown
				: Minus;
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${TONE_CLASS[delta.tone]}`}
		>
			<Icon size={12} aria-hidden />
			{delta.text}
		</span>
	);
}

/** Axis-less mini trend behind a KPI value. */
function Sparkline({
	points,
	dataKey,
	color,
}: {
	points: ChartPoint[];
	dataKey: keyof ChartPoint;
	color: string;
}) {
	if (points.length < 2) return null;
	const id = `spark-${String(dataKey)}`;
	return (
		<div className="h-9">
			<ResponsiveContainer width="100%" height="100%" minWidth={0}>
				<AreaChart
					data={points}
					margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
				>
					<defs>
						<linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stopColor={color} stopOpacity={0.22} />
							<stop offset="100%" stopColor={color} stopOpacity={0} />
						</linearGradient>
					</defs>
					<Area
						type="monotone"
						dataKey={dataKey}
						stroke={color}
						strokeWidth={1.5}
						fill={`url(#${id})`}
						connectNulls
						dot={false}
						isAnimationActive={false}
					/>
				</AreaChart>
			</ResponsiveContainer>
		</div>
	);
}

function KpiCard({
	label,
	value,
	delta,
	points,
	dataKey,
	color,
	featured = false,
}: {
	label: string;
	value: string;
	delta: Delta | null;
	points: ChartPoint[];
	dataKey: keyof ChartPoint;
	color: string;
	featured?: boolean;
}) {
	return (
		<section
			className={`relative flex flex-col overflow-hidden rounded-xl border p-4 ${
				featured
					? "border-primary-200 bg-gradient-to-br from-primary-100/70 via-white to-white shadow-sm"
					: "border-neutral-200 bg-white"
			}`}
		>
			{featured && (
				<span
					className="absolute inset-y-0 left-0 w-1 bg-primary-500"
					aria-hidden
				/>
			)}
			<h3 className="text-sm font-medium text-neutral-600">{label}</h3>
			<p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums text-neutral-900">
				{value}
			</p>
			<div className="mt-1 min-h-5">{delta && <DeltaPill delta={delta} />}</div>
			<div className="mt-2 -mb-1">
				<Sparkline points={points} dataKey={dataKey} color={color} />
			</div>
		</section>
	);
}

function SectionHeading({
	tick,
	children,
}: {
	tick: string;
	children: ReactNode;
}) {
	return (
		<div className="mb-3 flex items-center gap-2">
			<span className={`h-3.5 w-1 rounded-full ${tick}`} aria-hidden />
			<h2 className="text-sm font-semibold tracking-tight text-neutral-900">
				{children}
			</h2>
		</div>
	);
}

function ChartCard({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<section className="rounded-xl border border-neutral-200 bg-white p-4">
			<h3 className="text-sm font-medium text-neutral-700">{title}</h3>
			<div className="mt-3 h-52 min-h-[200px]">{children}</div>
		</section>
	);
}

export default function DashboardPage() {
	const { metrics, activity, activeWorkspaceId } = useBoard();
	const [history, setHistory] = useState<MetricsHistoryBucket[] | null>(null);
	const [historyError, setHistoryError] = useState(false);

	// refreshTick bumps on every board change (SSE), keeping trends current.
	useEffect(() => {
		if (activeWorkspaceId === null) return;
		api
			.getMetricsHistory(activeWorkspaceId, HISTORY_WEEKS)
			.then(({ weeks }) => {
				setHistory(weeks);
				setHistoryError(false);
			})
			.catch(() => setHistoryError(true));
	}, [activeWorkspaceId]);

	if (history === null && !historyError) {
		return <p className="p-6 text-sm text-neutral-500">Loading dashboard...</p>;
	}

	const thisWeek = history?.at(-1);
	const lastWeek = history?.at(-2);
	const points = history ? toChartPoints(history) : [];
	const recentActivity = activity.slice(0, 5);

	return (
		<div className="mx-auto max-w-6xl space-y-8 p-6 md:p-8">
			<PageHeader
				icon={LayoutDashboard}
				title="Dashboard"
				subtitle="How work is flowing — this week compared with last."
				actions={
					<span className="rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600">
						Last 8 weeks
					</span>
				}
			/>

			{historyError && (
				<div className="rounded-md border border-error-500 bg-error-100 px-4 py-3 text-sm text-error-900">
					Couldn't load metric trends. Check your connection and try again.
				</div>
			)}

			{/* At-a-glance KPIs — throughput leads as the featured metric. */}
			<section>
				<SectionHeading tick="bg-primary-500">This week</SectionHeading>
				<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
					<KpiCard
						label="Throughput"
						value={`${thisWeek?.throughput ?? 0} done`}
						delta={countDelta(thisWeek?.throughput, lastWeek?.throughput, "up")}
						points={points}
						dataKey="throughput"
						color={COLORS.throughput}
						featured
					/>
					<KpiCard
						label="Lead time"
						value={
							thisWeek?.avgLeadTimeMs == null
								? "—"
								: formatDuration(thisWeek.avgLeadTimeMs)
						}
						delta={durationDelta(
							thisWeek?.avgLeadTimeMs,
							lastWeek?.avgLeadTimeMs,
						)}
						points={points}
						dataKey="leadDays"
						color={COLORS.leadTime}
					/>
					<KpiCard
						label="Cycle time"
						value={
							thisWeek?.avgCycleTimeMs == null
								? "—"
								: formatDuration(thisWeek.avgCycleTimeMs)
						}
						delta={durationDelta(
							thisWeek?.avgCycleTimeMs,
							lastWeek?.avgCycleTimeMs,
						)}
						points={points}
						dataKey="cycleDays"
						color={COLORS.cycleTime}
					/>
					<KpiCard
						label="Work in progress"
						value={String(metrics?.wipCount ?? thisWeek?.wipCount ?? 0)}
						delta={countDelta(
							thisWeek?.wipCount,
							lastWeek?.wipCount,
							"neutral",
						)}
						points={points}
						dataKey="wip"
						color={COLORS.wip}
					/>
				</div>
			</section>

			{/* Trends over the last 8 weeks. */}
			<section>
				<SectionHeading tick="bg-accent-500">8-week trends</SectionHeading>
				<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
					<ChartCard title="Throughput per week">
						<ResponsiveContainer width="100%" height="100%" minWidth={0}>
							<BarChart
								data={points}
								margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
							>
								<CartesianGrid stroke={COLORS.grid} vertical={false} />
								<XAxis dataKey="week" tick={AXIS_TICK} tickLine={false} />
								<YAxis
									tick={AXIS_TICK}
									tickLine={false}
									axisLine={false}
									allowDecimals={false}
								/>
								<Tooltip formatter={(v) => [`${v} cards`, "Done"]} />
								<Bar
									dataKey="throughput"
									fill={COLORS.throughput}
									radius={[4, 4, 0, 0]}
								/>
							</BarChart>
						</ResponsiveContainer>
					</ChartCard>

					<ChartCard title="Lead time trend">
						<ResponsiveContainer width="100%" height="100%" minWidth={0}>
							<LineChart
								data={points}
								margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
							>
								<CartesianGrid stroke={COLORS.grid} vertical={false} />
								<XAxis dataKey="week" tick={AXIS_TICK} tickLine={false} />
								<YAxis
									tick={AXIS_TICK}
									tickLine={false}
									axisLine={false}
									unit="d"
								/>
								<Tooltip formatter={(v) => [`${v} days`, "Avg lead time"]} />
								<Line
									type="monotone"
									dataKey="leadDays"
									stroke={COLORS.leadTime}
									strokeWidth={2}
									dot={{ r: 3 }}
									connectNulls
								/>
							</LineChart>
						</ResponsiveContainer>
					</ChartCard>

					<ChartCard title="Cycle time trend">
						<ResponsiveContainer width="100%" height="100%" minWidth={0}>
							<LineChart
								data={points}
								margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
							>
								<CartesianGrid stroke={COLORS.grid} vertical={false} />
								<XAxis dataKey="week" tick={AXIS_TICK} tickLine={false} />
								<YAxis
									tick={AXIS_TICK}
									tickLine={false}
									axisLine={false}
									unit="d"
								/>
								<Tooltip formatter={(v) => [`${v} days`, "Avg cycle time"]} />
								<Line
									type="monotone"
									dataKey="cycleDays"
									stroke={COLORS.cycleTime}
									strokeWidth={2}
									dot={{ r: 3 }}
									connectNulls
								/>
							</LineChart>
						</ResponsiveContainer>
					</ChartCard>

					<ChartCard title="Work in progress">
						<ResponsiveContainer width="100%" height="100%" minWidth={0}>
							<AreaChart
								data={points}
								margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
							>
								<CartesianGrid stroke={COLORS.grid} vertical={false} />
								<XAxis dataKey="week" tick={AXIS_TICK} tickLine={false} />
								<YAxis
									tick={AXIS_TICK}
									tickLine={false}
									axisLine={false}
									allowDecimals={false}
								/>
								<Tooltip formatter={(v) => [`${v} cards`, "WIP"]} />
								<Area
									type="monotone"
									dataKey="wip"
									stroke={COLORS.wip}
									strokeWidth={2}
									fill={COLORS.wip}
									fillOpacity={0.15}
								/>
							</AreaChart>
						</ResponsiveContainer>
					</ChartCard>
				</div>
			</section>

			{/* Drill-down: latest changes behind the numbers (secondary). */}
			<section>
				<div className="mb-3 flex items-center justify-between">
					<SectionHeading tick="bg-neutral-300">Recent activity</SectionHeading>
					{recentActivity.length > 0 && (
						<Link
							to="/activity"
							className="inline-flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
						>
							View all
							<ArrowRight size={14} aria-hidden />
						</Link>
					)}
				</div>
				<div className="rounded-xl border border-neutral-200 bg-white">
					{recentActivity.length === 0 ? (
						<EmptyState
							className="px-6 py-10"
							icon={ActivityIcon}
							title="No activity yet"
							description="As your team adds and moves cards, the latest changes will show up here."
							action={
								<Link
									to="/board"
									className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
								>
									Go to board
									<ArrowRight size={14} aria-hidden />
								</Link>
							}
						/>
					) : (
						<ol>
							{recentActivity.map((e) => (
								<li
									key={e.id}
									className="flex items-baseline justify-between gap-3 border-b border-neutral-100 px-4 py-2.5 last:border-b-0"
								>
									<p className="min-w-0 truncate text-sm text-neutral-800">
										<span className="font-medium text-neutral-900">
											{e.actor?.displayName ?? "Someone"}
										</span>{" "}
										{describeEvent(e)}
									</p>
									<span className="shrink-0 text-xs text-neutral-500">
										{formatRelativeTime(e.createdAt)}
									</span>
								</li>
							))}
						</ol>
					)}
				</div>
			</section>
		</div>
	);
}
