import { Router } from "express";
import { requireAuth } from "../../../auth.js";
import { db } from "../../../db/kysely.js";
import { lookupMembership } from "../../../lib/helpers.js";
import { parseWith, sendValidationError } from "../../../validators/http.js";
import {
	legacyIntegerParam,
	trimmedRequired,
} from "../../../validators/schemas.js";
import {
	checkCompleteness,
	inferTypeFromClassifierAnswer,
	type TicketExtraction,
} from "./completeness.js";
import { getTicketHistory } from "./history.js";
import { isTicketIntakeConfigured } from "./linear-client.js";
import { extractTicketFields } from "./llm.js";
import { checkChatLimit, peekChatLimit } from "./rate-limits.js";
import { handleSubmit } from "./submit.js";

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

function applyClassifierTypeFallback(
	extraction: TicketExtraction,
	message: string,
	conversationHistory?: Array<{ role: string; content: string }>,
): TicketExtraction {
	if (extraction.type) return extraction;
	const candidates = [
		...(conversationHistory ?? []).filter((entry) => entry.role === "user"),
		{ role: "user", content: message },
	];
	for (let i = candidates.length - 1; i >= 0; i--) {
		const inferred = inferTypeFromClassifierAnswer(candidates[i].content);
		if (inferred) return { ...extraction, type: inferred };
	}
	return extraction;
}

ticketIntakeRouter.get("/ticket-intake/config", requireAuth, (_req, res) => {
	res.json({ enabled: isTicketIntakeConfigured() });
});

ticketIntakeRouter.get(
	"/workspaces/:workspaceId/ticket-intake/chat-limit",
	requireAuth,
	async (req, res) => {
		const parsedWorkspaceId = parseWith(
			legacyIntegerParam("workspaceId must be an integer"),
			req.params.workspaceId,
		);
		if (!parsedWorkspaceId.ok) {
			return sendValidationError(res, parsedWorkspaceId.body);
		}
		const workspaceId = parsedWorkspaceId.data;

		const membership = await lookupMembership(req.user!.id, workspaceId);
		if (!membership) {
			return res.status(404).json({ error: "Not found" });
		}

		const limit = await peekChatLimit(req.user!.id);
		return res.json({
			isLocked: limit.isLocked,
			...(limit.retryAfterMs !== undefined
				? { retryAfterMs: limit.retryAfterMs }
				: {}),
		});
	},
);

ticketIntakeRouter.post(
	"/workspaces/:workspaceId/ticket-intake/chat",
	requireAuth,
	async (req, res) => {
		if (!isTicketIntakeConfigured()) {
			return res.status(503).json({ error: "Ticket intake is not configured" });
		}

		const parsedWorkspaceId = parseWith(
			legacyIntegerParam("workspaceId must be an integer"),
			req.params.workspaceId,
		);
		if (!parsedWorkspaceId.ok) {
			return sendValidationError(res, parsedWorkspaceId.body);
		}
		const workspaceId = parsedWorkspaceId.data;

		const { message, isFirstTurn, autoError, conversationHistory } =
			req.body ?? {};

		const parsedMessage = parseWith(
			trimmedRequired("message is required"),
			message,
		);
		if (!parsedMessage.ok) {
			return sendValidationError(res, parsedMessage.body);
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
			return res.status(429).json({
				error: "Too many chat messages",
				...(rateLimit.retryAfterMs !== undefined
					? { retryAfterMs: rateLimit.retryAfterMs }
					: {}),
			});
		}

		const extractionInput = buildExtractionInput(
			parsedMessage.data,
			conversationHistory,
		);

		let extraction: TicketExtraction = applyClassifierTypeFallback(
			await extractTicketFields(extractionInput),
			parsedMessage.data,
			conversationHistory,
		);

		if (autoError) {
			extraction = { ...extraction, type: "Bug" };
		}

		const completeness = checkCompleteness(extraction);

		if (completeness.ready) {
			return res.json({ ready: true, draft: extraction });
		}

		return res.json({
			ready: false,
			question: completeness.question ?? CLASSIFIER_QUESTION,
		});
	},
);

ticketIntakeRouter.post(
	"/workspaces/:workspaceId/ticket-intake/submit",
	requireAuth,
	async (req, res) => handleSubmit(req, res, false),
);

ticketIntakeRouter.post(
	"/workspaces/:workspaceId/ticket-intake/resubmit",
	requireAuth,
	async (req, res) => handleSubmit(req, res, true),
);

ticketIntakeRouter.get(
	"/workspaces/:workspaceId/ticket-intake/history",
	requireAuth,
	async (req, res) => {
		const parsedWorkspaceId = parseWith(
			legacyIntegerParam("workspaceId must be an integer"),
			req.params.workspaceId,
		);
		if (!parsedWorkspaceId.ok) {
			return sendValidationError(res, parsedWorkspaceId.body);
		}
		const workspaceId = parsedWorkspaceId.data;

		const parsedCardId = parseWith(
			legacyIntegerParam("cardId must be an integer"),
			req.query.cardId,
		);
		if (!parsedCardId.ok) {
			return sendValidationError(res, parsedCardId.body);
		}
		const cardId = parsedCardId.data;

		const membership = await lookupMembership(req.user!.id, workspaceId);
		if (!membership) {
			return res.status(404).json({ error: "Not found" });
		}

		const tickets = await getTicketHistory(db, workspaceId, cardId);
		return res.json({ tickets });
	},
);
