import type { FlowMetrics } from "../types";
import { formatDuration } from "../types";

interface Props {
  metrics: FlowMetrics | null;
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-info-100 px-2.5 py-1">
      <span className="text-xs font-medium uppercase tracking-wide text-info-900/70">
        {label}
      </span>
      <span className="text-sm font-semibold text-info-900">{value}</span>
    </div>
  );
}

export default function MetricsBar({ metrics }: Props) {
  if (!metrics) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip label="Throughput" value={`${metrics.throughput} done`} />
      <Chip
        label="Lead time"
        value={
          metrics.avgLeadTimeMs === null
            ? "—"
            : formatDuration(metrics.avgLeadTimeMs)
        }
      />
      <Chip
        label="Cycle time"
        value={
          metrics.avgCycleTimeMs === null
            ? "—"
            : formatDuration(metrics.avgCycleTimeMs)
        }
      />
      <Chip label="WIP" value={String(metrics.wipCount)} />
    </div>
  );
}
