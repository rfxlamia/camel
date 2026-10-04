import { logger } from "../../lib/logger.js";
import type { AgentBoardServiceDeps } from "./service-types.js";

export function createBoardConversation(
	deps: AgentBoardServiceDeps,
	runPipeline: (args: {
		boardId: number;
		workspaceId: number;
	}) => Promise<void>,
) {
	const pendingRegenerate = new Map<number, string>();

	return {
		// ---- sendMessage (Generate-Explain-Refine loop) ----
		async sendMessage({
			boardId,
			userId,
			workspaceId,
			message,
		}: {
			boardId: number;
			userId: number;
			workspaceId: number;
			message: string;
		}) {
			const board = await deps.getBoard!(boardId);
			if (!board) return { status: 404 as const };
			if (board.workspaceId !== workspaceId) return { status: 404 as const };
			if (board.userId !== userId) return { status: 403 as const };

			if (pendingRegenerate.has(boardId)) {
				return {
					explanation:
						"Menunggu konfirmasi regenerate. Gunakan tombol Ya, Regenerate atau Batal.",
					boardUpdated: false,
				};
			}

			if (board.executionStatus === "running") {
				await deps.insertConversation!({
					boardId,
					role: "user",
					content: message,
				});
				return {
					explanation: "Board sedang dalam eksekusi. Tunggu hingga selesai.",
					boardUpdated: false,
				};
			}

			if (board.status === "pending") {
				await deps.insertConversation!({
					boardId,
					role: "user",
					content: message,
				});

				if (board.templateId === "status-report" && deps.detectReportPeriod) {
					const mergedIntent = `${board.originalIntent}\n${message}`.trim();
					try {
						const periodResult = await deps.detectReportPeriod(mergedIntent);
						if (periodResult.hasPeriod) {
							await deps.updateBoard!(boardId, {
								original_intent: mergedIntent,
							});
							const reply =
								"Period noted. You can approve the board when ready.";
							await deps.insertConversation!({
								boardId,
								role: "assistant",
								content: reply,
							});
							return { explanation: reply, boardUpdated: true };
						}

						const reply =
							periodResult.question ??
							"Which time period should this status report cover?";
						await deps.insertConversation!({
							boardId,
							role: "assistant",
							content: reply,
						});
						return { explanation: reply, boardUpdated: false };
					} catch (err) {
						logger.error({ err }, "sendMessage: detectReportPeriod failed");
						const reply = "Which time period should this status report cover?";
						await deps.insertConversation!({
							boardId,
							role: "assistant",
							content: reply,
						});
						return { explanation: reply, boardUpdated: false };
					}
				}

				const question = await deps.generateClarificationQuestion!(
					board.originalIntent,
					board,
					message,
				);
				return { explanation: question, boardUpdated: false };
			}

			if (board.status === "approved" && board.executionStatus === "done") {
				const artifact = await deps.getArtifact?.(boardId);
				const history = (await deps.getConversationHistory?.(boardId)) ?? [];

				const result = await deps.classifyFollowUpIntent!(
					board.originalIntent,
					artifact?.content ?? null,
					history,
					message,
				);

				await deps.insertConversation!({
					boardId,
					role: "user",
					content: message,
				});

				switch (result.intent) {
					case "ASK":
					case "REFINE": {
						await deps.publishEvent?.(workspaceId, {
							type: "agent.card.token",
							columnSlug: "__notfirst__",
							boardId,
							token: result.response,
						});
						await deps.insertConversation!({
							boardId,
							role: "assistant",
							content: result.response,
						});
						return {
							explanation: result.response,
							streamed: true as const,
							boardUpdated: false,
						};
					}
					case "NEW_DIRECTION": {
						pendingRegenerate.set(boardId, message);
						await deps.insertConversation!({
							boardId,
							role: "assistant",
							content: result.response,
						});
						return {
							explanation: result.response,
							pendingRegenerate: true,
							boardUpdated: false,
						};
					}
					case "OFF_TOPIC": {
						await deps.insertConversation!({
							boardId,
							role: "assistant",
							content: result.response,
						});
						return {
							explanation: result.response,
							boardUpdated: false,
						};
					}
				}
			}

			await deps.insertConversation!({
				boardId,
				role: "user",
				content: message,
			});
			return {
				explanation:
					"Message received. The board is already approved and executing.",
				boardUpdated: false,
			};
		},

		// ---- confirmRegenerateBoard ----
		async confirmRegenerateBoard({
			boardId,
			userId,
			workspaceId,
		}: {
			boardId: number;
			userId: number;
			workspaceId: number;
		}) {
			const board = await deps.getBoard!(boardId);
			if (!board || board.workspaceId !== workspaceId)
				return { status: 404 as const };
			if (board.userId !== userId) return { status: 403 as const };

			// Atomic claim: delete() returns true only for the first caller
			// CRITICAL: get() and delete() must remain synchronous and adjacent — do not insert await between them
			const newIntent = pendingRegenerate.get(boardId);
			if (!newIntent || !pendingRegenerate.delete(boardId)) {
				return { ok: true as const };
			}

			await deps.insertConversation!({
				boardId,
				role: "assistant",
				content: `Regenerating board with new direction: ${newIntent}`,
			});

			await deps.updateBoard!(boardId, {
				original_intent: newIntent,
				execution_status: "running",
			});
			await deps.deleteOutputsForBoard!(boardId);
			await deps.deleteCardsForBoard!(boardId);

			await deps.publishEvent?.(workspaceId, {
				type: "agent.board.generating",
			});

			runPipeline({ boardId, workspaceId }).catch((err: unknown) => {
				logger.error({ err }, "confirmRegenerateBoard: runPipeline failed");
			});

			return { ok: true as const };
		},

		// ---- cancelRegenerateBoard ----
		async cancelRegenerateBoard({
			boardId,
			userId,
			workspaceId,
		}: {
			boardId: number;
			userId: number;
			workspaceId: number;
		}) {
			const board = await deps.getBoard!(boardId);
			if (!board || board.workspaceId !== workspaceId)
				return { status: 404 as const };
			if (board.userId !== userId) return { status: 403 as const };

			pendingRegenerate.delete(boardId);

			await deps.insertConversation!({
				boardId,
				role: "assistant",
				content: "Regeneration cancelled.",
			});

			return { ok: true as const };
		},
	};
}
