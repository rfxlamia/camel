import { logger } from "../../lib/logger.js";
import type {
	AgentBoardRecord,
	AgentBoardServiceDeps,
} from "./service-types.js";
import { assertAgentSpendAllowed } from "./spend-kill-switch.js";

async function sendPendingBoardMessage(
	deps: AgentBoardServiceDeps,
	boardId: number,
	board: AgentBoardRecord,
	message: string,
) {
	assertAgentSpendAllowed();
	await deps.insertConversation!({ boardId, role: "user", content: message });

	if (board.templateId === "status-report" && deps.detectReportPeriod) {
		return sendStatusReportMessage(
			deps,
			boardId,
			board.originalIntent,
			message,
		);
	}

	const question = await deps.generateClarificationQuestion!(
		board.originalIntent,
		board,
		message,
	);
	return { explanation: question, boardUpdated: false };
}

async function sendStatusReportMessage(
	deps: AgentBoardServiceDeps,
	boardId: number,
	originalIntent: string,
	message: string,
) {
	const mergedIntent = `${originalIntent}\n${message}`.trim();
	try {
		const periodResult = await deps.detectReportPeriod!(mergedIntent);
		if (periodResult.hasPeriod) {
			await deps.updateBoard!(boardId, { original_intent: mergedIntent });
			const reply = "Period noted. You can approve the board when ready.";
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
		return await replyWithoutReportPeriod(deps, boardId, reply);
	} catch (err) {
		logger.error({ err }, "sendMessage: detectReportPeriod failed");
		return replyWithoutReportPeriod(
			deps,
			boardId,
			"Which time period should this status report cover?",
		);
	}
}

async function replyWithoutReportPeriod(
	deps: AgentBoardServiceDeps,
	boardId: number,
	reply: string,
) {
	await deps.insertConversation!({
		boardId,
		role: "assistant",
		content: reply,
	});
	return { explanation: reply, boardUpdated: false };
}

async function sendCompletedBoardFollowUp(
	deps: AgentBoardServiceDeps,
	pendingRegenerate: Map<number, string>,
	boardId: number,
	workspaceId: number,
	board: AgentBoardRecord,
	message: string,
) {
	assertAgentSpendAllowed();
	const artifact = await deps.getArtifact?.(boardId);
	const history = (await deps.getConversationHistory?.(boardId)) ?? [];
	const result = await deps.classifyFollowUpIntent!(
		board.originalIntent,
		artifact?.content ?? null,
		history,
		message,
	);

	await deps.insertConversation!({ boardId, role: "user", content: message });
	return handleFollowUpResult(
		deps,
		pendingRegenerate,
		boardId,
		workspaceId,
		message,
		result,
	);
}

async function handleFollowUpResult(
	deps: AgentBoardServiceDeps,
	pendingRegenerate: Map<number, string>,
	boardId: number,
	workspaceId: number,
	message: string,
	result: Awaited<
		ReturnType<NonNullable<AgentBoardServiceDeps["classifyFollowUpIntent"]>>
	>,
) {
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
		case "NEW_DIRECTION":
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
		case "OFF_TOPIC":
			await deps.insertConversation!({
				boardId,
				role: "assistant",
				content: result.response,
			});
			return { explanation: result.response, boardUpdated: false };
	}
}

export async function routeBoardMessage(
	deps: AgentBoardServiceDeps,
	pendingRegenerate: Map<number, string>,
	board: AgentBoardRecord,
	boardId: number,
	workspaceId: number,
	message: string,
) {
	if (pendingRegenerate.has(boardId)) {
		return {
			explanation:
				"Menunggu konfirmasi regenerate. Gunakan tombol Ya, Regenerate atau Batal.",
			boardUpdated: false,
		};
	}

	if (board.executionStatus === "running") {
		await deps.insertConversation!({ boardId, role: "user", content: message });
		return {
			explanation: "Board sedang dalam eksekusi. Tunggu hingga selesai.",
			boardUpdated: false,
		};
	}

	if (board.status === "pending") {
		return sendPendingBoardMessage(deps, boardId, board, message);
	}

	if (board.status === "failed" || board.executionStatus === "failed") {
		await deps.insertConversation!({ boardId, role: "user", content: message });
		return {
			explanation: "Board gagal. Gunakan tombol Retry untuk mencoba lagi.",
			boardUpdated: false,
		};
	}

	if (board.status === "approved" && board.executionStatus === "done") {
		return sendCompletedBoardFollowUp(
			deps,
			pendingRegenerate,
			boardId,
			workspaceId,
			board,
			message,
		);
	}

	await deps.insertConversation!({ boardId, role: "user", content: message });
	return {
		explanation:
			"Message received. The board is already approved and executing.",
		boardUpdated: false,
	};
}
