import { tavily } from "@tavily/core";
import type { Tool, ToolResult } from "./types.js";

const MAX_RESULTS = 10;
const SNIPPET_MAX = 300;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 10;

type SearchErrorCode = "RATE_LIMIT" | "API_ERROR" | "NETWORK_ERROR" | "UNKNOWN";

function classifyError(err: unknown): SearchErrorCode {
	const message = err instanceof Error ? err.message : String(err);

	if (/rate.?limit/i.test(message)) return "RATE_LIMIT";
	if (/invalid api key|unauthorized|401|403/i.test(message)) return "API_ERROR";
	if (
		/timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|fetch failed|network/i.test(message)
	) {
		return "NETWORK_ERROR";
	}
	return "UNKNOWN";
}

function isRetryable(code: SearchErrorCode): boolean {
	return (
		code === "RATE_LIMIT" || code === "NETWORK_ERROR" || code === "UNKNOWN"
	);
}

function truncateSnippet(text: string): string {
	if (text.length <= SNIPPET_MAX) return text;
	return text.slice(0, SNIPPET_MAX) + "…";
}

interface TavilyResult {
	title?: string;
	url?: string;
	content?: string;
}

function formatResults(results: TavilyResult[], query: string): string {
	if (results.length === 0) {
		return `no results found for ${query}`;
	}

	return results
		.slice(0, MAX_RESULTS)
		.map((result, index) => {
			const title = result.title ?? "Untitled";
			const url = result.url ?? "";
			const snippet = truncateSnippet(result.content ?? "");
			return `${index + 1}. ${title}\n   ${url}\n   ${snippet}`;
		})
		.join("\n\n");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchWithRetry(
	query: string,
	apiKey: string,
): Promise<ToolResult> {
	let lastErrorCode: SearchErrorCode = "UNKNOWN";

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const client = tavily({ apiKey });
			const response = await client.search(query, { maxResults: MAX_RESULTS });
			const results = (response.results ?? []) as TavilyResult[];

			return {
				ok: true,
				content: formatResults(results, query),
			};
		} catch (err) {
			lastErrorCode = classifyError(err);

			if (!isRetryable(lastErrorCode) || attempt === MAX_ATTEMPTS) {
				return {
					ok: false,
					content: err instanceof Error ? err.message : String(err),
					errorCode: lastErrorCode,
				};
			}

			await sleep(BACKOFF_MS * attempt);
		}
	}

	return {
		ok: false,
		content: `Search failed after ${MAX_ATTEMPTS} attempts`,
		errorCode: lastErrorCode,
	};
}

export const webSearch: Tool = {
	name: "web_search",
	description: "Search the web for current information on a topic.",
	riskTier: "read-only",
	inputSchema: {
		type: "object",
		properties: {
			query: { type: "string" },
		},
		required: ["query"],
	},
	async execute(input: Record<string, unknown>): Promise<ToolResult> {
		try {
			const query = String(input.query ?? "");

			const apiKey = process.env.TAVILY_API_KEY;
			if (!apiKey) {
				return {
					ok: false,
					content: "TAVILY_API_KEY is not configured",
					errorCode: "ENV_VAR_MISSING",
				};
			}

			return await searchWithRetry(query, apiKey);
		} catch (err) {
			return {
				ok: false,
				content: err instanceof Error ? err.message : String(err),
				errorCode: classifyError(err),
			};
		}
	},
};
