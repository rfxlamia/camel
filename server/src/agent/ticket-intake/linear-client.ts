/**
 * Linear GraphQL client for ticket-intake — issue/comment creation and label lookup.
 *
 * Pure async wrappers around raw GraphQL fetch. No Express/DB coupling.
 * Feature-gated via optional LINEAR_API_KEY / LINEAR_TEAM_ID in config.
 */

import { config } from "../../config.js";

export const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

export class LinearApiError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = "LinearApiError";
		this.status = status;
	}
}

export interface LinearClientDeps {
	fetchFn?: typeof fetch;
	apiKey?: string;
	teamId?: string;
}

interface GraphQLResponse<T> {
	data?: T;
	errors?: Array<{ message: string }>;
}

function resolveApiKey(deps?: LinearClientDeps): string {
	const apiKey = deps?.apiKey ?? config.LINEAR_API_KEY;
	if (!apiKey) {
		throw new LinearApiError("Linear API is not configured (LINEAR_API_KEY unset)", 503);
	}
	return apiKey;
}

function resolveTeamId(deps?: LinearClientDeps): string {
	const teamId = deps?.teamId ?? config.LINEAR_TEAM_ID;
	if (!teamId) {
		throw new LinearApiError("Linear API is not configured (LINEAR_TEAM_ID unset)", 503);
	}
	return teamId;
}

async function linearGraphQL<T>(
	query: string,
	variables: Record<string, unknown>,
	deps?: LinearClientDeps,
): Promise<T> {
	const fetchFn = deps?.fetchFn ?? fetch;
	const apiKey = resolveApiKey(deps);

	const response = await fetchFn(LINEAR_GRAPHQL_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: apiKey,
		},
		body: JSON.stringify({ query, variables }),
	});

	const body = (await response.json()) as GraphQLResponse<T>;

	if (!response.ok || body.errors?.length) {
		const message =
			body.errors?.[0]?.message ??
			`Linear GraphQL request failed with status ${response.status}`;
		throw new LinearApiError(message, response.status);
	}

	if (!body.data) {
		throw new LinearApiError(
			"Linear GraphQL response missing data",
			response.status,
		);
	}

	return body.data;
}

export interface CreateLinearIssueInput {
	title: string;
	description: string;
	labelIds: string[];
	teamId?: string;
}

export interface CreateLinearIssueResult {
	issueId: string;
	issueUrl: string;
	issueIdentifier: string;
}

export function isTicketIntakeConfigured(): boolean {
	return Boolean(config.LINEAR_API_KEY?.trim() && config.LINEAR_TEAM_ID?.trim());
}

const ISSUE_CREATE_MUTATION = `
mutation IssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue {
      id
      identifier
      url
    }
  }
}`;

export async function createLinearIssue(
	input: CreateLinearIssueInput,
	deps?: LinearClientDeps,
): Promise<CreateLinearIssueResult> {
	const teamId = input.teamId ?? resolveTeamId(deps);

	const data = await linearGraphQL<{
		issueCreate: {
			success: boolean;
			issue: { id: string; identifier: string; url: string } | null;
		};
	}>(
		ISSUE_CREATE_MUTATION,
		{
			input: {
				title: input.title,
				description: input.description,
				teamId,
				labelIds: input.labelIds,
			},
		},
		deps,
	);

	if (!data.issueCreate.success || !data.issueCreate.issue) {
		throw new LinearApiError("Linear issueCreate returned success=false", 502);
	}

	return {
		issueId: data.issueCreate.issue.id,
		issueUrl: data.issueCreate.issue.url,
		issueIdentifier: data.issueCreate.issue.identifier,
	};
}

export interface CreateLinearCommentInput {
	issueId: string;
	body: string;
}

const COMMENT_CREATE_MUTATION = `
mutation CommentCreate($input: CommentCreateInput!) {
  commentCreate(input: $input) {
    success
    comment {
      id
    }
  }
}`;

export async function createLinearComment(
	input: CreateLinearCommentInput,
	deps?: LinearClientDeps,
): Promise<void> {
	const data = await linearGraphQL<{
		commentCreate: { success: boolean; comment: { id: string } | null };
	}>(
		COMMENT_CREATE_MUTATION,
		{
			input: {
				issueId: input.issueId,
				body: input.body,
			},
		},
		deps,
	);

	if (!data.commentCreate.success) {
		throw new LinearApiError("Linear commentCreate returned success=false", 502);
	}
}

const TEAM_LABELS_QUERY = `
query TeamLabels($teamId: String!) {
  team(id: $teamId) {
    labels {
      nodes {
        id
        name
      }
    }
  }
}`;

export async function getLabelId(
	labelName: string,
	deps?: LinearClientDeps,
): Promise<string> {
	const teamId = resolveTeamId(deps);

	const data = await linearGraphQL<{
		team: { labels: { nodes: Array<{ id: string; name: string }> } } | null;
	}>(TEAM_LABELS_QUERY, { teamId }, deps);

	const labels = data.team?.labels.nodes ?? [];
	const match = labels.find(
		(label) => label.name.toLowerCase() === labelName.toLowerCase(),
	);

	if (!match) {
		throw new LinearApiError(
			`Linear label "${labelName}" not found for team ${teamId}`,
			404,
		);
	}

	return match.id;
}
