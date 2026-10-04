import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import { config } from "../../config.js";

// ---------------------------------------------------------------------------
// Client singleton — lazy-initialized on first call
// ---------------------------------------------------------------------------

const NATIVE = config.ANTHROPIC_BASE_URL ? false : true;
export const MODEL = config.ANTHROPIC_MODEL;

// Token budgets for extended thinking (per live-thinking.md + commit f24f292).
// OUTPUT_BUDGET preserved as headroom for report text; native Anthropic counts
// thinking inside max_tokens, so we add THINKING_BUDGET to MAX_TOKENS.
// Always send enabled+budget (MiMo accepts, native requires); never set
// temperature when thinking is on. Design: enabled for ALL columns (ignore
// _reasoning flag).
export const OUTPUT_BUDGET = 16384;
export const THINKING_BUDGET = 8192;
export const MAX_TOKENS = OUTPUT_BUDGET + THINKING_BUDGET; // 24576

let _client: Anthropic | null = null;

export function getClient(): Anthropic {
	if (!_client) {
		const opts: ClientOptions = {
			apiKey: config.ANTHROPIC_API_KEY,
		};
		// Support custom base URL for MiMo-compatible endpoints
		if (config.ANTHROPIC_BASE_URL) {
			opts.baseURL = config.ANTHROPIC_BASE_URL;
		}
		// Dual headers for MiMo compatibility: some endpoints expect `api-key`
		// instead of the default `x-api-key` Authorization header.
		if (!NATIVE) {
			opts.defaultHeaders = {
				"api-key": config.ANTHROPIC_API_KEY,
			};
		}
		_client = new Anthropic(opts);
	}
	return _client;
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

// Reasoning models (e.g. MiMo) interleave `thinking` blocks with `text`, and
// the text block is not always at index 0. Concatenate every text block so we
// never lose the answer to a thinking block sitting in front of it.
export function extractText(response: Anthropic.Message): string {
	return response.content
		.filter((block): block is Anthropic.TextBlock => block.type === "text")
		.map((block) => block.text)
		.join("");
}
