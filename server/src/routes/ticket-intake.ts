import { Router } from "express";
import { requireAuth } from "../auth.js";
import {
	checkCompleteness,
	type TicketExtraction,
} from "../agent/ticket-intake/completeness.js";
import { extractTicketFields } from "../agent/ticket-intake/llm.js";
import { checkChatLimit } from "../agent/ticket-intake/rate-limits.js";
import { lookupMembership } from "./helpers.js";

export const ticketIntakeRouter = Router();

const CLASSIFIER_QUESTION =
	"What kind of issue is this — a bug, a feature request, or an improvement?";

function buildExtractionInput(
	message: string,
	conversationHistory?: Array<{ role: string; content: string }>,
): string {
	if (!conversationHistory?.length) return message;
	const lines = conversationHistory.map(
		(entry) => `${entry.role}: ${entry.content}`,
	);
	lines.push(`user: ${message}`);
	return lines.join("\n");
}

ticketIntakeRouter.post(
	"/workspaces/:workspaceId/ticket-intake/chat",
	requireAuth,
	async (req, res) => {
		const workspaceId = Number(req.params.workspaceId);
		if (!Number.isInteger(workspaceId)) {
			return res
				.status(400)
				.json({ error: "workspaceId must be an integer" });
		}

		const { message, isFirstTurn, autoError, conversationHistory } =
			req.body ?? {};

		if (typeof message !== "string" || !message.trim()) {
			return res.status(400).json({ error: "message is required" });
		}

		const membership = await lookupMembership(req.user!.id, workspaceId);
		if (!membership) {
			return res.status(404).json({ error: "Not found" });
		}

		if (isFirstTurn && !autoError) {
			return res.json({
				ready: false,
				question: CLASSIFIER_QUESTION,
			});
		}

		const rateLimit = await checkChatLimit(req.user!.id);
		if (rateLimit.isLocked) {
			return res.status(429).json({ error: "Too many chat messages" });
		}

		const extractionInput = buildExtractionInput(
			message.trim(),
			conversationHistory,
		);

		let extraction: TicketExtraction =
			await extractTicketFields(extractionInput);

		if (autoError) {
			extraction = { ...extraction, type: "Bug" };
		}

		const completeness = checkCompleteness(extraction);

		if (completeness.ready) {
			return res.json({ ready: true, draft: extraction });
		}

		return res.json({
			ready: false,
			question: completeness.question,
		});
	},
);
