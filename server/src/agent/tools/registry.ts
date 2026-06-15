import type { Tool, ToolInputSchema } from "./types.js";

export interface ToolRegistry {
	resolveTools(names: string[]): Tool[];
}

export interface AnthropicToolDef {
	name: string;
	description: string;
	input_schema: ToolInputSchema;
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

export function toAnthropicToolDefs(tools: Tool[]): AnthropicToolDef[] {
	return tools.map(({ name, description, inputSchema }) => ({
		name,
		description,
		input_schema: inputSchema,
	}));
}
