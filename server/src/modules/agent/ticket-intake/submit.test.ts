import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPublishEvent = vi.fn();
const mockCreateLinearIssue = vi.fn();
const mockCreateLinearComment = vi.fn();
const mockGetLabelId = vi.fn();

vi.mock("../../../realtime.js", () => ({
	publishEvent: (...args: unknown[]) => mockPublishEvent(...args),
}));
vi.mock("../../../db/kysely.js", () => ({ db: {} }));
const mockRecordActivity = vi.fn();
const mockRecordSubmitSuccess = vi.fn();
vi.mock("../../../lib/helpers.js", () => ({
	lookupMembership: vi.fn(),
	recordActivity: (...args: unknown[]) => mockRecordActivity(...args),
}));
vi.mock("./rate-limits.js", () => ({
	peekSubmitLimit: vi.fn(),
	recordSubmitSuccess: (...args: unknown[]) => mockRecordSubmitSuccess(...args),
}));
vi.mock("./linear-client.js", () => ({
	createLinearIssue: (...args: unknown[]) => mockCreateLinearIssue(...args),
	createLinearComment: (...args: unknown[]) => mockCreateLinearComment(...args),
	getLabelId: (...args: unknown[]) => mockGetLabelId(...args),
	isTicketIntakeConfigured: () => true,
}));

// Skip real retry/backoff: the failures below are thrown as-is to
// runSubmitInBackground, as executeWithRetry does once attempts are exhausted.
vi.mock("./retry.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./retry.js")>();
	return {
		...actual,
		executeWithRetry: async (fn: () => Promise<unknown>) => fn(),
	};
});

import { RetryError } from "./retry.js";
import { extractSubmitFailure, runSubmitInBackground } from "./submit.js";

const user = { id: 1, displayName: "Ada", email: "ada@example.com" } as never;
const body = { title: "T", description: "D", type: "bug" };

describe("extractSubmitFailure", () => {
	it("keeps the message of a retryable failure", () => {
		expect(
			extractSubmitFailure(new RetryError("Linear is down", true)),
		).toEqual({ retryable: true, message: "Linear is down" });
	});

	it("keeps the message of a non-retryable failure", () => {
		expect(extractSubmitFailure(new RetryError("Bad label", false))).toEqual({
			retryable: false,
			message: "Bad label",
		});
	});

	it("classifies untagged HTTP errors by status", () => {
		const http = (status: number) =>
			Object.assign(new Error(`HTTP ${status}`), { status });
		expect(extractSubmitFailure(http(503))).toEqual({
			retryable: true,
			message: "HTTP 503",
		});
		expect(extractSubmitFailure(http(404))).toEqual({
			retryable: false,
			message: "HTTP 404",
		});
		expect(extractSubmitFailure(new Error("boom"))).toEqual({
			retryable: false,
			message: "boom",
		});
	});

	it("falls back to a generic message for non-Error values", () => {
		expect(extractSubmitFailure({ retryable: true })).toEqual({
			retryable: true,
			message: "Submission failed",
		});
		expect(extractSubmitFailure("boom")).toEqual({
			retryable: false,
			message: "Submission failed",
		});
	});
});

describe("runSubmitInBackground", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetLabelId.mockResolvedValue("label-1");
		mockCreateLinearComment.mockResolvedValue(undefined);
		mockRecordActivity.mockResolvedValue(undefined);
		mockRecordSubmitSuccess.mockResolvedValue(undefined);
	});

	it("publishes a failure result with the error message", async () => {
		mockCreateLinearIssue.mockRejectedValue(
			new RetryError("Linear is down", true),
		);
		mockPublishEvent.mockResolvedValue(undefined);
		await runSubmitInBackground(7, user, body);
		expect(mockPublishEvent).toHaveBeenCalledWith(
			7,
			expect.objectContaining({
				success: false,
				retryable: true,
				errorMessage: "Linear is down",
			}),
		);
	});

	it("does not reject when publishing the failure result rejects", async () => {
		mockCreateLinearIssue.mockRejectedValue(new Error("nope"));
		mockPublishEvent.mockRejectedValue(new Error("redis down"));
		await expect(runSubmitInBackground(7, user, body)).resolves.toBeUndefined();
	});

	it("does not report failure for a created ticket when the success publish rejects", async () => {
		mockCreateLinearIssue.mockResolvedValue({
			issueId: "i1",
			issueUrl: "https://linear.app/x/1",
			issueIdentifier: "X-1",
		});
		mockPublishEvent.mockRejectedValue(new Error("redis down"));
		await expect(runSubmitInBackground(7, user, body)).resolves.toBeUndefined();
		expect(mockPublishEvent).toHaveBeenCalledTimes(1);
		expect(mockPublishEvent).toHaveBeenCalledWith(
			7,
			expect.objectContaining({ success: true }),
		);
	});
	it.each([
		["recordActivity", mockRecordActivity],
		["recordSubmitSuccess", mockRecordSubmitSuccess],
	])("still publishes success when %s rejects after the ticket was created", async (_name, failing) => {
		mockCreateLinearIssue.mockResolvedValue({
			issueId: "i1",
			issueUrl: "https://linear.app/x/1",
			issueIdentifier: "X-1",
		});
		failing.mockRejectedValue(new Error("db down"));
		mockPublishEvent.mockResolvedValue(undefined);
		await runSubmitInBackground(7, user, body);
		expect(mockPublishEvent).toHaveBeenCalledTimes(1);
		expect(mockPublishEvent).toHaveBeenCalledWith(
			7,
			expect.objectContaining({ success: true, issueIdentifier: "X-1" }),
		);
	});
});
