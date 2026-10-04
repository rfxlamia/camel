import { logger } from "../../lib/logger.js";
import { resolveColumnTools } from "./pipeline-tools.js";
import type {
	AgentBoardRecord,
	AgentBoardServiceDeps,
	ColumnInfo,
} from "./service-types.js";
import {
	buildVarsMap,
	findUnresolvedPlaceholders,
	renderSystemPrompt,
} from "./templates.js";
import {
	persistToolEvent,
	publishToolSse,
	type ToolEventPayload,
} from "./tool-events.js";

export type PipelineCardResult =
	| { halted: true }
	| { halted: false; output: string };

/**
 * Runs one pipeline card: renders the prompt, streams tokens/tool events,
 * persists output. Halts (without throwing) on any failure after marking the
 * board failed and publishing `agent.card.failed`.
 */
export async function runPipelineCard(
	deps: AgentBoardServiceDeps,
	ctx: {
		board: AgentBoardRecord;
		column: ColumnInfo;
		index: number;
		boardId: number;
		workspaceId: number;
		previousOutput: string;
		accumulator: Record<string, string>;
		slugToOutputKey: Map<string, string>;
		artifactEnabled: boolean;
	},
): Promise<PipelineCardResult> {
	const {
		board,
		column,
		index: i,
		boardId,
		workspaceId,
		previousOutput,
		accumulator,
		slugToOutputKey,
		artifactEnabled,
	} = ctx;

	await deps.publishEvent?.(workspaceId, {
		type: "agent.card.started",
		columnSlug: column.columnSlug,
		boardId,
	});

	const vars = buildVarsMap(board.originalIntent, previousOutput, accumulator);
	const rendered = renderSystemPrompt(column.systemPrompt, vars);

	const unresolved = findUnresolvedPlaceholders(rendered);
	if (unresolved.length > 0) {
		const reason = `Unresolved placeholders: ${unresolved.join(", ")}`;
		logger.error(
			{ columnSlug: column.columnSlug, reason },
			"runPipeline: card halted",
		);
		await deps.insertOutput!({
			boardId,
			columnSlug: column.columnSlug,
			cardIndex: i,
			output: "",
		});
		await deps.updateBoard!(boardId, { execution_status: "failed" });
		await deps.publishEvent?.(workspaceId, {
			type: "agent.card.failed",
			columnSlug: column.columnSlug,
			boardId,
			reason,
		});
		return { halted: true };
	}

	let tokenBuffer = "";
	let thinkingBuffer = "";
	let toolEventCount = 0;
	const batchInterval = setInterval(() => {
		if (thinkingBuffer) {
			deps.publishEvent?.(workspaceId, {
				type: "agent.card.thinking",
				columnSlug: column.columnSlug,
				boardId,
				token: thinkingBuffer,
			});
			thinkingBuffer = "";
		}
		if (tokenBuffer) {
			deps.publishEvent?.(workspaceId, {
				type: "agent.card.token",
				columnSlug: column.columnSlug,
				boardId,
				token: tokenBuffer,
			});
			tokenBuffer = "";
		}
	}, 200);

	const resolvedTools = resolveColumnTools(deps, {
		board,
		column,
		boardId,
		workspaceId,
		accumulator,
		slugToOutputKey,
		artifactEnabled,
	});
	const toolBudget = column.toolBudget ?? 3;

	const onToolEvent = (e: ToolEventPayload) => {
		// Flush thinking + token buffers before emitting tool event
		if (thinkingBuffer) {
			deps.publishEvent?.(workspaceId, {
				type: "agent.card.thinking",
				columnSlug: column.columnSlug,
				boardId,
				token: thinkingBuffer,
			});
			thinkingBuffer = "";
		}
		if (tokenBuffer) {
			deps.publishEvent?.(workspaceId, {
				type: "agent.card.token",
				columnSlug: column.columnSlug,
				boardId,
				token: tokenBuffer,
			});
			tokenBuffer = "";
		}

		if (e.phase !== "reasoning") {
			publishToolSse(deps, workspaceId, boardId, column.columnSlug, e);
		}

		if (e.phase !== "reasoning") {
			toolEventCount++;
		}
		persistToolEvent(deps, {
			boardId,
			columnSlug: column.columnSlug,
			event: e,
			attempt: toolEventCount,
		});
	};

	const isQaColumn = (column.tools ?? []).includes("create_file");
	const cardUserContent = isQaColumn
		? "Validate the final document in your system instructions against the original intent. Output your QA verdict only — do not conduct new research or answer the user directly."
		: undefined;

	try {
		const result = await deps.executeCard!(
			rendered,
			board.originalIntent,
			[],
			column.reasoning,
			(token: string) => {
				tokenBuffer += token;
			},
			resolvedTools,
			toolBudget,
			onToolEvent,
			(text: string) => {
				thinkingBuffer += text;
			},
			cardUserContent,
		);

		clearInterval(batchInterval);

		if (thinkingBuffer) {
			await deps.publishEvent?.(workspaceId, {
				type: "agent.card.thinking",
				columnSlug: column.columnSlug,
				boardId,
				token: thinkingBuffer,
			});
			thinkingBuffer = "";
		}
		if (tokenBuffer) {
			await deps.publishEvent?.(workspaceId, {
				type: "agent.card.token",
				columnSlug: column.columnSlug,
				boardId,
				token: tokenBuffer,
			});
		}

		if (result.output.trim().length === 0) {
			const reason = "Empty output";
			logger.error(
				{ columnSlug: column.columnSlug, reason },
				"runPipeline: card halted",
			);
			await deps.insertOutput!({
				boardId,
				columnSlug: column.columnSlug,
				cardIndex: i,
				output: result.output,
				thinking: result.thinking,
			});
			await deps.updateBoard!(boardId, { execution_status: "failed" });
			await deps.publishEvent?.(workspaceId, {
				type: "agent.card.failed",
				columnSlug: column.columnSlug,
				boardId,
				reason,
			});
			return { halted: true };
		}

		await deps.insertOutput!({
			boardId,
			columnSlug: column.columnSlug,
			cardIndex: i,
			output: result.output,
			thinking: result.thinking,
		});

		const preview =
			result.output.length > 120
				? result.output.slice(0, 120) + "…"
				: result.output;
		await deps.insertCard!({
			columnId: column.columnId,
			title: preview,
			position: 1.0,
			workspaceId,
		});

		await deps.publishEvent?.(workspaceId, {
			type: "agent.card.done",
			columnSlug: column.columnSlug,
			boardId,
		});

		return { halted: false, output: result.output };
	} catch (err) {
		clearInterval(batchInterval);
		if (thinkingBuffer) {
			await deps.publishEvent?.(workspaceId, {
				type: "agent.card.thinking",
				columnSlug: column.columnSlug,
				boardId,
				token: thinkingBuffer,
			});
			thinkingBuffer = "";
		}
		if (tokenBuffer) {
			await deps.publishEvent?.(workspaceId, {
				type: "agent.card.token",
				columnSlug: column.columnSlug,
				boardId,
				token: tokenBuffer,
			});
			tokenBuffer = "";
		}
		const reason = String(err);
		logger.error(
			{ columnSlug: column.columnSlug, reason },
			"runPipeline: card threw",
		);
		await deps.insertOutput!({
			boardId,
			columnSlug: column.columnSlug,
			cardIndex: i,
			output: "",
		});
		await deps.updateBoard!(boardId, { execution_status: "failed" });
		await deps.publishEvent?.(workspaceId, {
			type: "agent.card.failed",
			columnSlug: column.columnSlug,
			boardId,
			reason,
		});
		return { halted: true };
	}
}
