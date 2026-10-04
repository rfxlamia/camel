/**
 * Agent Board Service — pure business logic with dependency injection.
 *
 * All external calls (DB, LLM, SSE) are injected via deps, making this
 * module fully unit-testable without real databases or API keys.
 *
 * CRITICAL: Agent card execution output writes to agent_card_outputs,
 * NOT card_events — human Activity Feed must stay clean.
 */

import { logger } from "../../lib/logger.js";
import { createBoardConversation } from "./board-conversation.js";
import { createBoardQueries } from "./board-queries.js";
import { createPipeline } from "./pipeline.js";
import type { AgentBoardServiceDeps } from "./service-types.js";
import { getTemplate } from "./templates.js";

export type {
	AgentBoardRecord,
	AgentBoardServiceDeps,
	BoardListItem,
	ColumnInfo,
	FirstCardInfo,
} from "./service-types.js";

export function createAgentBoardService(deps: AgentBoardServiceDeps) {
	const pipeline = createPipeline(deps);
	const conversation = createBoardConversation(deps, pipeline.runPipeline);
	const queries = createBoardQueries(deps);

	return {
		// ---- createBoard ----
		async createBoard({
			workspaceId,
			userId,
			intent,
		}: {
			workspaceId: number;
			userId: number;
			intent: string;
		}) {
			const classifyResult = await deps.classifyIntent!(intent);

			if (!classifyResult.templateId) {
				return {
					status: 422 as const,
					message: classifyResult.explanation,
				};
			}

			let explanation = classifyResult.explanation;
			if (
				classifyResult.templateId === "status-report" &&
				deps.detectReportPeriod
			) {
				try {
					const periodResult = await deps.detectReportPeriod(intent);
					if (!periodResult.hasPeriod) {
						explanation =
							periodResult.question ??
							"Which time period should this status report cover?";
					}
				} catch (err) {
					logger.error({ err }, "createBoard: detectReportPeriod failed");
					explanation = "Which time period should this status report cover?";
				}
			}

			const board = await deps.insertBoard!({
				workspaceId,
				userId,
				templateId: classifyResult.templateId,
				originalIntent: intent,
				status: "pending",
			});

			// Store conversation thread (user intent + assistant explanation)
			await deps.insertConversation!({
				boardId: board.id,
				role: "user",
				content: intent,
			});
			await deps.insertConversation!({
				boardId: board.id,
				role: "assistant",
				content: explanation,
			});

			// Insert template columns with board_id linkage
			const template = getTemplate(classifyResult.templateId);
			if (template) {
				await deps.insertColumns!({
					boardId: board.id,
					workspaceId,
					columns: template.columns,
				});
			}

			await deps.publishEvent?.(workspaceId, {
				type: "agent.board.ready",
			});

			return { boardId: board.id, explanation };
		},

		// ---- approveBoard ----
		async approveBoard({
			boardId,
			userId,
			workspaceId,
		}: {
			boardId: number;
			userId: number;
			workspaceId: number;
		}) {
			const board = await deps.getBoard!(boardId);
			if (!board) return { status: 404 as const };
			if (board.workspaceId !== workspaceId) return { status: 404 as const };
			if (board.userId !== userId) return { status: 403 as const };

			if (board.templateId === "status-report" && deps.detectReportPeriod) {
				try {
					const periodResult = await deps.detectReportPeriod(
						board.originalIntent,
					);
					if (!periodResult.hasPeriod) {
						return {
							status: 422 as const,
							message:
								periodResult.question ??
								"Which time period should this status report cover?",
						};
					}
				} catch (err) {
					logger.error({ err }, "approveBoard: detectReportPeriod failed");
					return {
						status: 422 as const,
						message: "Which time period should this status report cover?",
					};
				}
			}

			// Atomic status transition: only one concurrent request wins
			if (deps.approveBoardAtomic) {
				const { rowCount } = await deps.approveBoardAtomic(boardId);
				if (rowCount === 0) return { status: 409 as const };
			} else {
				// Fallback for tests that don't provide approveBoardAtomic
				if (board.status !== "pending") return { status: 409 as const };
				await deps.updateBoard!(boardId, {
					status: "approved",
					execution_status: "running",
				});
			}

			await deps.publishEvent?.(workspaceId, {
				type: "agent.board.generating",
			});
		},

		...pipeline,
		...conversation,
		...queries,
	};
}
