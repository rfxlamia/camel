import type { Tool } from "../../../lib/llm/tool-types.js";

export interface ToolRegistry {
	resolveTools(names: string[]): Tool[];
}

export function createToolRegistry(tools: Tool[]): ToolRegistry {
	const byName = new Map(tools.map((tool) => [tool.name, tool]));

	return {
		resolveTools(names: string[]): Tool[] {
			return names
				.map((name) => byName.get(name))
				.filter((tool): tool is Tool => tool !== undefined);
		},
	};
}
