export type ToolRiskTier = "read-only" | "write" | "destructive";

export interface ToolResult {
	ok: boolean;
	content: string;
	errorCode?: string;
}

export interface Tool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	riskTier: ToolRiskTier;
	execute: (input: Record<string, unknown>) => Promise<ToolResult>;
}

export type ToolEvent =
	| {
			phase: "started";
			toolName?: string;
			query?: string;
			attempt?: number;
	  }
	| {
			phase: "result";
			toolName?: string;
			query?: string;
			resultCount?: number;
			attempt?: number;
	  }
	| {
			phase: "failed";
			toolName?: string;
			query?: string;
			errorCode?: string;
			attempt?: number;
	  }
	| {
			phase: "reasoning";
			text?: string;
	  };
