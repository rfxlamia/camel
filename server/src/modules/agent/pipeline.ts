import { finalizeArtifact } from "./pipeline-artifact.js";
import { runPipelineCard } from "./pipeline-card.js";
import type { AgentBoardServiceDeps } from "./service-types.js";
import { getTemplate } from "./templates.js";
import {
	persistToolEvent,
	publishToolSse,
	type ToolEventPayload,
} from "./tool-events.js";

export function createPipeline(deps: AgentBoardServiceDeps) {
	return {
		// ---- triggerExecution ----
		async triggerExecution({
			boardId,
			workspaceId,
		}: {
			boardId: number;
			workspaceId: number;
		}) {
			// Load board — must use original_intent from DB, not from caller
			const board = await deps.getBoard!(boardId);
			if (!board) return;

			// Read first card metadata from columns table (slug, system_prompt, reasoning)
			const firstCard = await deps.getFirstCard!(boardId);
			if (!firstCard) return;

			await deps.publishEvent?.(workspaceId, {
				type: "agent.card.started",
				columnSlug: firstCard.columnSlug,
				boardId,
			});

			// Token batching via setInterval(200ms)
			let tokenBuffer = "";
			let toolEventCount = 0;
			const batchInterval = setInterval(() => {
				if (tokenBuffer) {
					deps.publishEvent?.(workspaceId, {
						type: "agent.card.token",
						columnSlug: firstCard.columnSlug,
						boardId,
						token: tokenBuffer,
					});
					tokenBuffer = "";
				}
			}, 200);

			const resolvedTools =
				deps.toolRegistry?.resolveTools(firstCard.tools ?? []) ?? [];
			const toolBudget = firstCard.toolBudget ?? 3;

			const onToolEvent = (e: ToolEventPayload) => {
				// Flush token buffer before emitting tool event
				if (tokenBuffer) {
					deps.publishEvent?.(workspaceId, {
						type: "agent.card.token",
						columnSlug: firstCard.columnSlug,
						boardId,
						token: tokenBuffer,
					});
					tokenBuffer = "";
				}

				if (e.phase !== "reasoning") {
					publishToolSse(deps, workspaceId, boardId, firstCard.columnSlug, e);
				}

				if (e.phase !== "reasoning") {
					toolEventCount++;
				}
				persistToolEvent(deps, {
					boardId,
					columnSlug: firstCard.columnSlug,
					event: e,
					attempt: toolEventCount,
				});
			};

			try {
				const result = await deps.executeCard!(
					firstCard.systemPrompt,
					board.originalIntent,
					[],
					firstCard.reasoning,
					(token: string) => {
						tokenBuffer += token;
					},
					resolvedTools,
					toolBudget,
					onToolEvent,
				);

				clearInterval(batchInterval);

				// Flush remaining tokens
				if (tokenBuffer) {
					await deps.publishEvent?.(workspaceId, {
						type: "agent.card.token",
						columnSlug: firstCard.columnSlug,
						boardId,
						token: tokenBuffer,
					});
				}

				// Persist output to agent_card_outputs (NOT card_events)
				await deps.insertOutput!({
					boardId,
					columnSlug: firstCard.columnSlug,
					cardIndex: 0,
					output: result.output,
					thinking: result.thinking,
				});

				// Create a card in the column so the board visual has a clickable handle.
				// The card title is a preview of the output; full output lives in agent_card_outputs.
				const preview =
					result.output.length > 120
						? result.output.slice(0, 120) + "…"
						: result.output;
				await deps.insertCard!({
					columnId: firstCard.columnId,
					title: preview,
					position: 1.0,
					workspaceId,
				});

				await deps.updateBoard!(boardId, { execution_status: "done" });
				await deps.publishEvent?.(workspaceId, {
					type: "agent.card.done",
					columnSlug: firstCard.columnSlug,
					boardId,
				});
			} catch (err) {
				clearInterval(batchInterval);

				await deps.updateBoard!(boardId, { execution_status: "failed" });
				await deps.publishEvent?.(workspaceId, {
					type: "agent.card.failed",
					columnSlug: firstCard.columnSlug,
					boardId,
					error: String(err),
				});
			}
		},

		// ---- runPipeline ----
		async runPipeline({
			boardId,
			workspaceId,
		}: {
			boardId: number;
			workspaceId: number;
		}) {
			const board = await deps.getBoard!(boardId);
			if (!board) return;

			const columns = await deps.getColumns!(boardId);
			if (!columns || columns.length === 0) return;

			const template = getTemplate(board.templateId ?? "");
			const slugToOutputKey = new Map<string, string>(
				(template?.columns ?? [])
					.filter((c) => c.output_key)
					.map((c) => [c.slug, c.output_key!]),
			);

			const artifactEnabled =
				!!deps.insertArtifact && !!deps.getArtifact && !!deps.getOutput;

			const accumulator: Record<string, string> = {};
			let previousOutput = "";

			for (let i = 0; i < columns.length; i++) {
				const column = columns[i];
				const result = await runPipelineCard(deps, {
					board,
					column,
					index: i,
					boardId,
					workspaceId,
					previousOutput,
					accumulator,
					slugToOutputKey,
					artifactEnabled,
				});
				if (result.halted) return;

				const outputKey = slugToOutputKey.get(column.columnSlug);
				if (outputKey) {
					accumulator[outputKey] = result.output;
				}
				previousOutput = result.output;
			}

			const artifactForNotify = await finalizeArtifact(deps, {
				board,
				columns,
				boardId,
				workspaceId,
				slugToOutputKey,
				artifactEnabled,
			});

			await deps.updateBoard!(boardId, { execution_status: "done" });
			await deps.publishEvent?.(workspaceId, {
				type: "agent.execution.done",
				boardId,
			});
			if (artifactForNotify) {
				await deps.publishEvent?.(workspaceId, {
					type: "agent.artifact.ready",
					boardId,
				});
			}
		},
	};
}
