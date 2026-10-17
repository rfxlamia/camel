export interface AgentColumn {
	id: number;
	slug: string;
	name: string;
	position: number;
	reasoning: boolean;
	systemPrompt: string;
	cards: AgentCard[];
}

export interface ToolTraceItem {
	columnSlug?: string;
	toolName: string;
	query?: string;
	resultCount?: number;
	errorCode?: string;
	attempt?: number;
	createdAt?: string;
	reasoningText?: string;
}

export interface AgentCard {
	id: number;
	columnId: number;
	title: string;
	position: number;
}

export interface AgentBoard {
	id: number;
	workspaceId: number;
	templateId: string;
	originalIntent: string;
	status: "pending" | "approved";
	executionStatus: "idle" | "running" | "done" | "failed";
	createdAt: string;
	columns: AgentColumn[];
	toolTrace?: ToolTraceItem[];
	conversations?: Array<{ role: string; content: string }>;
}

export interface AgentCardOutput {
	columnSlug: string;
	output: string;
	thinking?: string;
}

export interface AgentArtifact {
	filename: string;
	format: "md";
	content: string;
}

export interface AgentEvent {
	type:
		| "agent.board.generating"
		| "agent.board.ready"
		| "agent.board.failed"
		| "agent.card.started"
		| "agent.card.token"
		| "agent.card.done"
		| "agent.card.failed"
		| "agent.card.thinking"
		| "agent.tool.started"
		| "agent.tool.result"
		| "agent.tool.failed"
		| "agent.artifact.ready"
		| "agent.execution.done";
	columnSlug?: string;
	token?: string;
	boardId?: number;
	error?: string;
	reason?: string;
	toolName?: string;
	query?: string;
	resultCount?: number;
	errorCode?: string;
	attempt?: number;
}
