import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
	config: {
		LINEAR_API_KEY: "test-linear-key",
		LINEAR_TEAM_ID: "team-123",
	},
}));

import {
	createLinearComment,
	createLinearIssue,
	getLabelId,
	LinearApiError,
} from "./linear-client.js";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

function mockFetchResponse(
	status: number,
	body: unknown,
): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: vi.fn().mockResolvedValue(body),
	} as unknown as Response;
}

describe("createLinearIssue", () => {
	const fetchFn = vi.fn();

	beforeEach(() => {
		fetchFn.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns issueUrl and issueIdentifier on success", async () => {
		fetchFn.mockResolvedValue(
			mockFetchResponse(200, {
				data: {
					issueCreate: {
						success: true,
						issue: {
							id: "issue-id",
							identifier: "CAM-42",
							url: "https://linear.app/camel/issue/CAM-42",
						},
					},
				},
			}),
		);

		const result = await createLinearIssue(
			{
				title: "Login redirect broken",
				description: "Steps to reproduce...",
				labelIds: ["label-bug"],
			},
			{ fetchFn },
		);

		expect(result).toEqual({
			issueUrl: "https://linear.app/camel/issue/CAM-42",
			issueIdentifier: "CAM-42",
		});
		expect(fetchFn).toHaveBeenCalledWith(
			LINEAR_GRAPHQL_URL,
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "test-linear-key",
				}),
				body: expect.stringContaining("issueCreate"),
			}),
		);
	});

	it("throws LinearApiError with HTTP status for GraphQL errors", async () => {
		fetchFn.mockResolvedValue(
			mockFetchResponse(400, {
				errors: [{ message: "Invalid input" }],
			}),
		);

		await expect(
			createLinearIssue(
				{
					title: "Bad request",
					description: "Missing fields",
					labelIds: [],
				},
				{ fetchFn },
			),
		).rejects.toMatchObject({
			status: 400,
			message: expect.stringContaining("Invalid input"),
		});
	});
});

describe("createLinearComment", () => {
	const fetchFn = vi.fn();

	beforeEach(() => {
		fetchFn.mockReset();
	});

	it("creates a comment on an issue", async () => {
		fetchFn.mockResolvedValue(
			mockFetchResponse(200, {
				data: {
					commentCreate: {
						success: true,
						comment: { id: "comment-id" },
					},
				},
			}),
		);

		await createLinearComment(
			{ issueId: "issue-id", body: "Reporter: Jane Doe" },
			{ fetchFn },
		);

		expect(fetchFn).toHaveBeenCalledWith(
			LINEAR_GRAPHQL_URL,
			expect.objectContaining({
				body: expect.stringContaining("commentCreate"),
			}),
		);
	});
});

describe("getLabelId", () => {
	const fetchFn = vi.fn();

	beforeEach(() => {
		fetchFn.mockReset();
	});

	it("returns the label ID for a matching team label", async () => {
		fetchFn.mockResolvedValue(
			mockFetchResponse(200, {
				data: {
					team: {
						labels: {
							nodes: [
								{ id: "label-bug", name: "Bug" },
								{ id: "label-feature", name: "Feature" },
							],
						},
					},
				},
			}),
		);

		const labelId = await getLabelId("Bug", { fetchFn });

		expect(labelId).toBe("label-bug");
	});

	it("throws a descriptive error when the label is not found", async () => {
		fetchFn.mockResolvedValue(
			mockFetchResponse(200, {
				data: {
					team: {
						labels: {
							nodes: [{ id: "label-bug", name: "Bug" }],
						},
					},
				},
			}),
		);

		await expect(getLabelId("Improvement", { fetchFn })).rejects.toThrow(
			'Linear label "Improvement" not found for team team-123',
		);
	});

	it("throws LinearApiError with HTTP status for transport failures", async () => {
		fetchFn.mockResolvedValue(
			mockFetchResponse(503, {
				errors: [{ message: "Service unavailable" }],
			}),
		);

		await expect(getLabelId("Bug", { fetchFn })).rejects.toBeInstanceOf(
			LinearApiError,
		);
		await expect(getLabelId("Bug", { fetchFn })).rejects.toMatchObject({
			status: 503,
		});
	});
});
