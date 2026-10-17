import {
	createAgentApi,
	type TicketHistoryEntry,
	type TicketIntakeChatResponse,
	type TicketIntakeDraft,
} from "./agentApi";

// Load transport factories before UI re-exports, which can import the facade.
export { default as AgentBoardHeader } from "./AgentBoardHeader";
export { default as AgentBoardVisual } from "./AgentBoardVisual";
export { default as AgentCardDetail } from "./AgentCardDetail";
export { default as AgentChatPanel } from "./AgentChatPanel";
export { default as AgentComposer } from "./AgentComposer";
export type {
	AgentArtifact,
	AgentBoard,
	AgentCard,
	AgentCardOutput,
	AgentColumn,
	AgentEvent,
	ToolTraceItem,
} from "./agentTypes";
export { useAgentBoard } from "./useAgentBoard";
export { useAgentChat } from "./useAgentChat";
export {
	createAgentApi,
	type TicketHistoryEntry,
	type TicketIntakeChatResponse,
	type TicketIntakeDraft,
};
