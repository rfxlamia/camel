import type { Tool, ToolInputSchema } from "./tool-types.js";

export interface AnthropicToolDef {
	name: string;
	description: string;
	input_schema: ToolInputSchema;
}

export function toAnthropicToolDefs(tools: Tool[]): AnthropicToolDef[] {
	return tools.map(({ name, description, inputSchema }) => ({
		name,
		description,
		input_schema: inputSchema,
	}));
}
