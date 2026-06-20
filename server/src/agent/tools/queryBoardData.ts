import {
	computeFlowMetrics,
	computeMetricsHistory,
	type CardTimestamps,
} from "../../core/metrics.js";
import type { Tool, ToolResult } from "./types.js";

export interface ActivityItem {
	type: string;
	cardTitle?: string | null;
	at?: string;
	id?: number;
	[key: string]: unknown;
}

export interface QueryBoardDataCtx {
	workspaceId: number;
	fetchCardTimestamps: (workspaceId: number) => Promise<CardTimestamps[]>;
	fetchActivityEvents: (
		workspaceId: number,
		limit: number,
	) => Promise<ActivityItem[]>;
	now?: Date;
}

type DataType = "metrics" | "activity" | "history";

const ALL_DATA_TYPES: DataType[] = ["metrics", "activity", "history"];
const DEFAULT_WEEKS = 8;
const DEFAULT_ACTIVITY_LIMIT = 50;
const MIN_WEEKS = 1;
const MAX_WEEKS = 26;
const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 365;

function parseDataTypes(input: Record<string, unknown>): DataType[] {
	const raw = input.data_types;
	if (!Array.isArray(raw) || raw.length === 0) {
		return [...ALL_DATA_TYPES];
	}
	const valid = raw.filter(
		(v): v is DataType =>
			v === "metrics" || v === "activity" || v === "history",
	);
	return valid.length > 0 ? valid : [...ALL_DATA_TYPES];
}

function clampInt(
	value: unknown,
	min: number,
	max: number,
	fallback: number,
): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, Math.floor(value)));
}

export function makeQueryBoardData(ctx: QueryBoardDataCtx): Tool {
	return {
		name: "query_board_data",
		description:
			"Read workspace flow data for managerial reporting. Use data_types to select sections: metrics (throughput, lead/cycle time, WIP), activity (recent card events), history (weekly metric trends). Optional windowDays limits the metrics window; weeks sets history bucket count (1–26, default 8). Workspace scope is server-bound — do not pass workspace or board ids.",
		riskTier: "read-only",
		inputSchema: {
			type: "object",
			properties: {
				data_types: {
					type: "array",
					items: {
						type: "string",
						enum: ["metrics", "activity", "history"],
					},
					description:
						"Which data sections to return. Omit to fetch metrics, activity, and history.",
				},
				windowDays: {
					type: "number",
					description:
						"Limit metrics to cards completed within this many days (1–365). Omit for all-time.",
				},
				weeks: {
					type: "number",
					description:
						"Number of weekly history buckets to return (1–26, default 8).",
				},
			},
		},
		async execute(input: Record<string, unknown>): Promise<ToolResult> {
			const dataTypes = parseDataTypes(input);
			const now = ctx.now ?? new Date();
			const windowDays =
				input.windowDays !== undefined
					? clampInt(
							input.windowDays,
							MIN_WINDOW_DAYS,
							MAX_WINDOW_DAYS,
							MIN_WINDOW_DAYS,
						)
					: undefined;
			const weeks = clampInt(input.weeks, MIN_WEEKS, MAX_WEEKS, DEFAULT_WEEKS);

			try {
				const payload: Record<string, unknown> = {};
				const needsCards =
					dataTypes.includes("metrics") || dataTypes.includes("history");

				let cards: CardTimestamps[] | null = null;
				if (needsCards) {
					cards = await ctx.fetchCardTimestamps(ctx.workspaceId);
				}

				if (dataTypes.includes("metrics")) {
					const metrics = computeFlowMetrics(cards as CardTimestamps[], {
						windowDays,
						now,
					});
					payload.metrics = {
						...metrics,
						completedCount: metrics.throughput,
						hasData: metrics.throughput > 0,
					};
				}

				if (dataTypes.includes("history")) {
					payload.history = computeMetricsHistory(cards as CardTimestamps[], {
						weeks,
						now,
					});
				}

				if (dataTypes.includes("activity")) {
					payload.activity = await ctx.fetchActivityEvents(
						ctx.workspaceId,
						DEFAULT_ACTIVITY_LIMIT,
					);
				}

				return {
					ok: true,
					content: JSON.stringify(payload),
				};
			} catch {
				return {
					ok: false,
					content: "data fetch failed",
					errorCode: "DB_ERROR",
				};
			}
		},
	};
}
