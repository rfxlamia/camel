import { Router, type Request, type Response } from "express";
import type { AuthUser } from "../auth.js";
import { requireAuth } from "../auth.js";
import {
	checkCompleteness,
	type TicketExtraction,
} from "../agent/ticket-intake/completeness.js";
import { getTicketHistory } from "../agent/ticket-intake/history.js";
import { extractTicketFields } from "../agent/ticket-intake/llm.js";
import {
	createLinearComment,
	createLinearIssue,
	getLabelId,
} from "../agent/ticket-intake/linear-client.js";
import {
	checkChatLimit,
	peekSubmitLimit,
	recordSubmitSuccess,
} from "../agent/ticket-intake/rate-limits.js";
import { executeWithRetry } from "../agent/ticket-intake/retry.js";
import { pool } from "../db/pool.js";
import { publishEvent } from "../realtime.js";
import { lookupMembership, recordActivity } from "./helpers.js";

export const ticketIntakeRouter = Router();

const CLASSIFIER_QUESTION =
	"What kind of issue is this — a bug, a feature request, or an improvement?";

interface SubmitBody {
	title: string;
	description: string;
	type: string;
	cardId?: number;
	source?: string;
}

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

function buildCommentBody(
	user: AuthUser,
	source?: string,
	cardId?: number,
): string {
	const reporter = user.email
		? `${user.displayName} (${user.email})`
		: user.displayName;
	const lines = [`Reported by ${reporter}`];
	if (source) lines.push(`Source: ${source}`);
	if (cardId !== undefined) lines.push(`Card ID: ${cardId}`);
	return lines.join("\n");
}

function parseSubmitBody(body: unknown): SubmitBody | null {
	if (!body || typeof body !== "object") return null;
	const { title, description, type, cardId, source } = body as Record<
		string,
		unknown
	>;
	if (typeof title !== "string" || !title.trim()) return null;
	if (typeof description !== "string") return null;
	if (typeof type !== "string" || !type.trim()) return null;
	if (cardId !== undefined && !Number.isInteger(cardId)) return null;
	if (source !== undefined && typeof source !== "string") return null;
	return {
		title: title.trim(),
		description,
		type: type.trim(),
		cardId: cardId as number | undefined,
		source: source as string | undefined,
	};
}

function extractSubmitFailure(error: unknown): {
	retryable: boolean;
	message: string;
} {
	if (error && typeof error === "object" && "retryable" in error) {
		return {
			retryable: Boolean((error as { retryable: boolean }).retryable),
			message: "Submission failed",
		};
	}
	return {
		retryable: false,
		message: error instanceof Error ? error.message : "Submission failed",
	};
}

async function runSubmitInBackground(
	workspaceId: number,
	user: AuthUser,
	body: SubmitBody,
): Promise<void> {
	try {
		const labelId = await getLabelId(body.type);
		const result = await executeWithRetry(
			() =>
				createLinearIssue({
					title: body.title,
					description: body.description,
					labelIds: [labelId],
				}),
			{ maxAttempts: 10 },
		);

		await recordSubmitSuccess(user.id);
		await recordActivity(pool, user, workspaceId, "linear_ticket_created", {
			cardId: body.cardId ?? null,
			payload: {
				issueUrl: result.issueUrl,
				issueIdentifier: result.issueIdentifier,
				title: body.title,
			},
		});

		const issueId =
			(result as { issueId?: string }).issueId ?? result.issueIdentifier;
		try {
			await createLinearComment({
				issueId,
				body: buildCommentBody(user, body.source, body.cardId),
			});
		} catch (err) {
			console.error("createLinearComment failed:", err);
		}

		await publishEvent(workspaceId, {
			type: "ticket_intake.submit_result",
			success: true,
			issueUrl: result.issueUrl,
			issueIdentifier: result.issueIdentifier,
			cardId: body.cardId,
		});
	} catch (error) {
		const failure = extractSubmitFailure(error);
		await publishEvent(workspaceId, {
			type: "ticket_intake.submit_result",
			success: false,
			retryable: failure.retryable,
			errorMessage: failure.message,
			cardId: body.cardId,
		});
	}
}

async function handleSubmit(
	req: Request,
	res: Response,
	skipRateLimitCheck: boolean,
): Promise<void> {
	const workspaceId = Number(req.params.workspaceId);
	if (!Number.isInteger(workspaceId)) {
		res.status(400).json({ error: "workspaceId must be an integer" });
		return;
	}

	const body = parseSubmitBody(req.body);
	if (!body) {
		res.status(400).json({ error: "Invalid submit body" });
		return;
	}

	const membership = await lookupMembership(req.user!.id, workspaceId);
	if (!membership) {
		res.status(404).json({ error: "Not found" });
		return;
	}

	if (!skipRateLimitCheck) {
		const rateLimit = await peekSubmitLimit(req.user!.id);
		if (rateLimit.isLocked) {
			res.status(409).json({ error: "Submit rate limit exceeded" });
			return;
		}
	}

	res.status(202).json({ status: "submitting" });

	void runSubmitInBackground(workspaceId, req.user!, body);
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
		const workspaceId = Number(req.params.workspaceId);
		if (!Number.isInteger(workspaceId)) {
			return res
				.status(400)
				.json({ error: "workspaceId must be an integer" });
		}

		const cardId = Number(req.query.cardId);
		if (!Number.isInteger(cardId)) {
			return res.status(400).json({ error: "cardId must be an integer" });
		}

		const membership = await lookupMembership(req.user!.id, workspaceId);
		if (!membership) {
			return res.status(404).json({ error: "Not found" });
		}

		const tickets = await getTicketHistory(pool, workspaceId, cardId);
		return res.json({ tickets });
	},
);
