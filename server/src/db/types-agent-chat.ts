import type { Generated, Json, Timestamp } from "./types.js";

export interface AgentArtifacts {
	board_id: number;
	content: string;
	created_at: Generated<Timestamp>;
	filename: string;
	format: Generated<string>;
	id: Generated<number>;
	workspace_id: number;
}

export interface AgentBoards {
	created_at: Generated<Timestamp>;
	execution_status: Generated<string>;
	id: Generated<number>;
	original_intent: string;
	status: Generated<string>;
	template_id: Generated<string>;
	updated_at: Generated<Timestamp>;
	user_id: number;
	workspace_id: number;
}

export interface AgentCardOutputs {
	board_id: number;
	card_index: Generated<number>;
	column_slug: string;
	created_at: Generated<Timestamp>;
	id: Generated<number>;
	output: string;
	thinking: string | null;
}

export interface AgentConversations {
	board_id: number;
	content: string;
	created_at: Generated<Timestamp>;
	id: Generated<number>;
	role: string;
}

export interface AgentToolCalls {
	attempt: Generated<number>;
	board_id: number;
	column_slug: string;
	created_at: Generated<Timestamp>;
	error_code: string | null;
	id: Generated<number>;
	input: Json | null;
	result: string | null;
	tool_name: string;
}

export interface ChatAttachments {
	content: string;
	created_at: Generated<Timestamp>;
	filename: string;
	format: string;
	id: Generated<number>;
	message_id: number;
}

export interface ChatMessages {
	content: string;
	created_at: Generated<Timestamp>;
	id: Generated<number>;
	role: string;
	thinking: string | null;
	thread_id: number;
	tool_trace: Json | null;
}

export interface ChatThreads {
	created_at: Generated<Timestamp>;
	id: Generated<number>;
	title: Generated<string>;
	updated_at: Generated<Timestamp>;
	user_id: number;
}
