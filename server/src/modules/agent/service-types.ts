import type { CardTimestamps } from "../../core/metrics.js";
import type { Tool } from "../../lib/llm/tool-types.js";
import type { ActivityItem } from "./tools/queryBoardData.js";

export interface AgentBoardRecord {
	id: number;
	status: string;
	workspaceId: number;
	userId: number;
	originalIntent: string;
	templateId?: string;
	executionStatus?: string;
	createdAt?: string;
}

export interface BoardListItem {
	id: number;
	originalIntent: string;
	templateId: string;
	status: string;
	executionStatus: string;
	createdAt: string;
}

export interface FirstCardInfo {
	columnId: number;
	columnSlug: string;
	systemPrompt: string;
	reasoning: boolean;
	tools?: string[];
	toolBudget?: number | null;
}

export interface ColumnInfo {
	columnId: number;
	columnSlug: string;
	systemPrompt: string;
	reasoning: boolean;
	tools?: string[];
	toolBudget?: number | null;
}

export interface AgentBoardServiceDeps {
	classifyIntent?: (
		intent: string,
	) => Promise<{ templateId: string | null; explanation: string }>;

	insertBoard?: (data: {
		workspaceId: number;
		userId: number;
		templateId: string;
		originalIntent: string;
		status: string;
	}) => Promise<{ id: number }>;

	insertConversation?: (data: {
		boardId: number;
		role: string;
		content: string;
	}) => Promise<void>;

	insertColumns?: (data: {
		boardId: number;
		workspaceId: number;
		columns: Array<{
			slug: string;
			name: string;
			position: number;
			reasoning: boolean;
			system_prompt: string;
		}>;
	}) => Promise<void>;

	publishEvent?: (
		workspaceId: number,
		event: Record<string, unknown>,
	) => Promise<void>;

	getBoard?: (boardId: number) => Promise<AgentBoardRecord | null>;

	updateBoard?: (
		boardId: number,
		data: Record<string, unknown>,
	) => Promise<void>;

	approveBoardAtomic?: (boardId: number) => Promise<{ rowCount: number }>;

	listBoards?: (workspaceId: number) => Promise<BoardListItem[]>;

	getFirstCard?: (boardId: number) => Promise<FirstCardInfo | null>;

	getColumns?: (boardId: number) => Promise<ColumnInfo[]>;

	executeCard?: (
		systemPrompt: string,
		intent: string,
		previousOutputs: string[],
		reasoning: boolean,
		onToken: (token: string) => void,
		tools?: Tool[],
		toolBudget?: number,
		onToolEvent?: (e: {
			phase: string;
			toolName?: string;
			query?: string;
			resultCount?: number;
			errorCode?: string;
			attempt?: number;
			text?: string;
		}) => void,
		onThinking?: (text: string) => void,
		userContent?: string,
	) => Promise<{ output: string; thinking?: string }>;

	insertOutput?: (data: {
		boardId: number;
		columnSlug: string;
		cardIndex: number;
		output: string;
		thinking?: string;
	}) => Promise<void>;

	insertCard?: (data: {
		columnId: number;
		title: string;
		position: number;
		workspaceId: number;
	}) => Promise<void>;

	insertToolCall?: (data: {
		boardId: number;
		columnSlug: string;
		toolName: string;
		input: Record<string, unknown> | null;
		result: string | null;
		errorCode?: string;
		attempt: number;
	}) => Promise<void>;

	toolRegistry?: {
		resolveTools(names: string[]): Tool[];
	};

	getOutput?: (data: {
		boardId: number;
		columnSlug: string;
	}) => Promise<{ output: string; thinking: string | null } | null>;

	insertArtifact?: (data: {
		boardId: number;
		workspaceId: number;
		filename: string;
		format: "md";
		content: string;
	}) => Promise<void>;

	getArtifact?: (boardId: number) => Promise<{
		filename: string;
		format: "md";
		content: string;
	} | null>;

	generateClarificationQuestion?: (
		intent: string,
		board: unknown,
		feedback: string,
	) => Promise<string>;

	classifyFollowUpIntent?: (
		originalIntent: string,
		artifactContent: string | null,
		conversationHistory: Array<{ role: string; content: string }>,
		userMessage: string,
	) => Promise<{
		intent: "ASK" | "REFINE" | "NEW_DIRECTION" | "OFF_TOPIC";
		response: string;
		confidence: number;
	}>;

	getConversationHistory?: (
		boardId: number,
	) => Promise<Array<{ role: string; content: string }>>;

	deleteOutputsForBoard?: (boardId: number) => Promise<void>;

	deleteCardsForBoard?: (boardId: number) => Promise<void>;

	fetchCardTimestamps?: (workspaceId: number) => Promise<CardTimestamps[]>;

	fetchActivityEvents?: (
		workspaceId: number,
		limit: number,
	) => Promise<ActivityItem[]>;

	detectReportPeriod?: (
		intent: string,
	) => Promise<{ hasPeriod: boolean; question?: string }>;
}
