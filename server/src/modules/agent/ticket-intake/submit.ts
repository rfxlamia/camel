import type { Request, Response } from "express";
import type { AuthUser } from "../../../auth.js";
import { db } from "../../../db/kysely.js";
import { lookupMembership, recordActivity } from "../../../lib/helpers.js";
import { logger } from "../../../lib/logger.js";
import { publishEvent } from "../../../realtime.js";
import {
	createLinearComment,
	createLinearIssue,
	getLabelId,
	isTicketIntakeConfigured,
} from "./linear-client.js";
import { peekSubmitLimit, recordSubmitSuccess } from "./rate-limits.js";
import { executeWithRetry } from "./retry.js";

interface SubmitBody {
	title: string;
	description: string;
	type: string;
	cardId?: number;
	source?: string;
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
		await recordActivity(db, user, workspaceId, "linear_ticket_created", {
			cardId: body.cardId ?? null,
			payload: {
				issueUrl: result.issueUrl,
				issueIdentifier: result.issueIdentifier,
				title: body.title,
			},
		});

		const issueId = result.issueId;
		try {
			await createLinearComment({
				issueId,
				body: buildCommentBody(user, body.source, body.cardId),
			});
		} catch (err) {
			logger.error({ err }, "createLinearComment failed");
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

export async function handleSubmit(
	req: Request,
	res: Response,
	skipRateLimitCheck: boolean,
): Promise<void> {
	if (!isTicketIntakeConfigured()) {
		res.status(503).json({ error: "Ticket intake is not configured" });
		return;
	}

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
