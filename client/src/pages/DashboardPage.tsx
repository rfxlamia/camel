import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
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
import type { MetricsHistoryBucket } from "../types";
import { formatDuration, formatRelativeTime } from "../types";
import { useBoard } from "../context/BoardContext";
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
      b.avgCycleTimeMs === null ? null : +(b.avgCycleTimeMs / DAY_MS).toFixed(1),
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
  if (diff === 0) return { direction: "flat", tone: "flat", text: "same as last week" };
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
  good: "text-success-900",
  bad: "text-error-900",
  flat: "text-neutral-500",
};

function KpiCard({ label, value, delta }: { label: string; value: string; delta: Delta | null }) {
  const Icon =
    delta?.direction === "up"
      ? TrendingUp
      : delta?.direction === "down"
        ? TrendingDown
        : Minus;
  return (
    <section className="rounded-md border border-neutral-200 bg-white p-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-600">
        {label}
      </h3>
      <p className="mt-1 text-xl font-semibold text-neutral-900">{value}</p>
      {delta && (
        <p className={`mt-1 flex items-center gap-1 text-xs ${TONE_CLASS[delta.tone]}`}>
          <Icon size={13} aria-hidden />
          {delta.text}
        </p>
      )}
    </section>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-neutral-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
      <div className="mt-3 h-52">{children}</div>
    </section>
  );
}

export default function DashboardPage() {
  const { metrics, activity, refreshTick, activeWorkspaceId } = useBoard();
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
  }, [refreshTick, activeWorkspaceId]);

  if (history === null && !historyError) {
    return <p className="p-6 text-sm text-neutral-500">Loading dashboard...</p>;
  }

  const thisWeek = history?.at(-1);
  const lastWeek = history?.at(-2);
  const points = history ? toChartPoints(history) : [];
  const recentActivity = activity.slice(0, 8);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      {historyError && (
        <div className="rounded-md border border-error-500 bg-error-100 px-4 py-3 text-sm text-error-900">
          Couldn't load metric trends. Check your connection and try again.
        </div>
      )}

      {/* At-a-glance KPIs (this week, compared with last week). */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Throughput (this week)"
          value={`${thisWeek?.throughput ?? 0} done`}
          delta={countDelta(thisWeek?.throughput, lastWeek?.throughput, "up")}
        />
        <KpiCard
          label="Lead time (this week)"
          value={
            thisWeek?.avgLeadTimeMs == null
              ? "—"
              : formatDuration(thisWeek.avgLeadTimeMs)
          }
          delta={durationDelta(thisWeek?.avgLeadTimeMs, lastWeek?.avgLeadTimeMs)}
        />
        <KpiCard
          label="Cycle time (this week)"
          value={
            thisWeek?.avgCycleTimeMs == null
              ? "—"
              : formatDuration(thisWeek.avgCycleTimeMs)
          }
          delta={durationDelta(thisWeek?.avgCycleTimeMs, lastWeek?.avgCycleTimeMs)}
        />
        <KpiCard
          label="WIP (now)"
          value={String(metrics?.wipCount ?? thisWeek?.wipCount ?? 0)}
          delta={countDelta(thisWeek?.wipCount, lastWeek?.wipCount, "neutral")}
        />
      </div>

      {/* Trends over the last 8 weeks. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Throughput per week">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="week" tick={AXIS_TICK} tickLine={false} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip formatter={(v) => [`${v} cards`, "Done"]} />
              <Bar dataKey="throughput" fill={COLORS.throughput} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Lead time trend">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="week" tick={AXIS_TICK} tickLine={false} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} unit="d" />
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
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="week" tick={AXIS_TICK} tickLine={false} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} unit="d" />
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
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="week" tick={AXIS_TICK} tickLine={false} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
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

      {/* Drill-down: latest changes behind the numbers. */}
      <section className="rounded-md border border-neutral-200 bg-white">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-neutral-900">Recent activity</h3>
          <Link
            to="/activity"
            className="text-sm text-primary-600 hover:text-primary-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
          >
            View all
          </Link>
        </div>
        <ol>
          {recentActivity.length === 0 && (
            <li className="px-4 py-4 text-sm text-neutral-500">
              Nothing here yet. Changes your team makes will show up here.
            </li>
          )}
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
      </section>
    </div>
  );
}
