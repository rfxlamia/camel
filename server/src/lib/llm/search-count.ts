/** Count numbered search hits in web_search tool_result content (e.g. "1. Title"). */
export function countSearchResults(content: string): number {
	if (/no results found/i.test(content)) return 0;
	const matches = content.match(/^\d+\./gm);
	return matches?.length ?? 0;
}
