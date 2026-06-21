export interface Card {
	id: number;
	columnId: number;
	title: string;
	description: string;
	position: number;
	version: number;
	createdAt: string;
	startedAt: string | null;
	doneAt: string | null;
	workspaceId?: number;
}

export interface User {
	id: number;
	username: string;
	displayName: string;
}

export interface PresenceUser extends User {
	lastSeen: string;
}

export interface ActivityEvent {
	id: number;
	type: "create" | "update" | "move" | "delete";
	cardId: number | null;
	cardTitle: string | null;
	fromColumn: string | null;
	toColumn: string | null;
	actor: { username: string; displayName: string } | null;
	createdAt: string;
}

export interface BoardEvent {
	type: string;
	actor: User;
	cardId?: number;
	at: string;
}

// ---- Agent Template Names (shared across components) ----

export const TEMPLATE_NAMES: Record<string, string> = {
	"research-report": "Research & Report",
	"status-report": "Status Report",
};

export function templateName(templateId: string): string {
	return TEMPLATE_NAMES[templateId] ?? templateId;
}

export function formatRelativeTime(iso: string): string {
	const ms = Date.now() - new Date(iso).getTime();
	const minute = 60 * 1000;
	const hour = 60 * minute;
	const day = 24 * hour;
	if (ms < minute) return "just now";
	if (ms < hour) return `${Math.floor(ms / minute)}m ago`;
	if (ms < day) return `${Math.floor(ms / hour)}h ago`;
	return `${Math.floor(ms / day)}d ago`;
}

export interface Column {
	id: number;
	title: string;
	position: number;
	wipLimit: number | null;
	policy: string;
	isDone: boolean;
	cards: Card[];
}

export interface Board {
	columns: Column[];
}

export interface FlowMetrics {
	throughput: number;
	avgLeadTimeMs: number | null;
	avgCycleTimeMs: number | null;
	wipCount: number;
}

export interface MetricsHistoryBucket {
	weekStart: string;
	throughput: number;
	avgLeadTimeMs: number | null;
	avgCycleTimeMs: number | null;
	wipCount: number;
}

export type WipStatus = "unlimited" | "under" | "at" | "over";

export function wipStatus(count: number, wipLimit: number | null): WipStatus {
	if (wipLimit === null) return "unlimited";
	if (count < wipLimit) return "under";
	if (count === wipLimit) return "at";
	return "over";
}

export function formatDuration(ms: number): string {
	const hour = 60 * 60 * 1000;
	const day = 24 * hour;
	if (ms < hour) return `${Math.max(1, Math.round(ms / (60 * 1000)))}m`;
	if (ms < day) return `${(ms / hour).toFixed(1).replace(/\.0$/, "")}h`;
	return `${(ms / day).toFixed(1).replace(/\.0$/, "")}d`;
}

export interface Setting {
	key: string;
	textValue: string | null;
	boolValue: boolean | null;
	version: number;
	updatedAt: string;
}

export interface SettingsMap {
	boardName: string;
	logoPath: string;
	version: number;
}

export type WorkspaceRole = "owner" | "admin" | "member";

export interface Workspace {
	id: number;
	name: string;
	role: WorkspaceRole;
	isPersonal: boolean;
	memberCount: number;
}

export interface WorkspaceMember {
	userId: number;
	username: string;
	displayName: string;
	role: WorkspaceRole;
}

export interface WorkspaceInvite {
	id: number;
	workspaceId: number;
	workspaceName: string;
	role: WorkspaceRole;
}

export interface WorkspaceListResponse {
	workspaces: Workspace[];
	pendingInvites: WorkspaceInvite[];
}

export interface WorkspaceSelectionState {
	activeWorkspaceId: number | null;
	pickerRequired: boolean;
	workspacesReady: boolean;
}

export type SwitchConfirmState =
	| { open: false }
	| { open: true; pendingWorkspaceId: number };

export interface WorkspaceCreateState {
	open: boolean;
	name: string;
	busy: boolean;
	error: string | null;
}

// ---- Agent ----

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
	columnSlug: string;
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
