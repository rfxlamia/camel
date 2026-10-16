// Historical `../types` import path for shared app types. Each domain's types
// live in its feature module; this barrel keeps existing import sites working.
// Value helpers come from the import-free shared/formatting.ts leaf so the
// api.ts hub never cycles through a feature barrel (hub↔barrel cycles split
// module identity under vi.mock — see HUB_TO_LEAF_ALLOWLIST).
export type {
	ActivityEvent,
	AttachmentActivityPayload,
} from "./features/activity";
export type {
	AgentArtifact,
	AgentBoard,
	AgentCard,
	AgentCardOutput,
	AgentColumn,
	AgentEvent,
	ToolTraceItem,
} from "./features/agent";
export type { PresenceUser, User } from "./features/auth";
export type {
	Board,
	BoardEvent,
	BoardEventType,
	Card,
	CardAssignee,
	CardAttachment,
	Column,
	FlowMetrics,
	MetricsHistoryBucket,
} from "./features/board";
// chat/index.ts exports a ChatMessage component, so the data-type cluster is
// re-exported from the pure leaf instead of the barrel.
export type {
	ChatAttachment,
	ChatAttachmentFormat,
	ChatMessage,
	ChatMessageRole,
	ChatThread,
	ChatToolEvent,
	StreamEvent,
} from "./features/chat/chatTypes";
export type {
	FocusSession,
	FocusSessionGetResponse,
	FocusSessionState,
} from "./features/focus";
export type {
	AppNotification,
	AppNotificationType,
	NotificationsResponse,
} from "./features/notifications";
export type { Setting, SettingsMap } from "./features/settings";
export type {
	TrackerEvent,
	TrackerItem,
	TrackerItemAssignee,
	TrackerPhase,
	TrackerProject,
	TrackerStatusCategory,
	TrackerVocabulary,
	TrackerVocabularyKind,
	WorkItem,
	WorkItemSource,
} from "./features/tracker";
export type {
	SwitchConfirmState,
	Workspace,
	WorkspaceCreateState,
	WorkspaceInvite,
	WorkspaceListResponse,
	WorkspaceMember,
	WorkspaceRole,
	WorkspaceSelectionState,
} from "./features/workspaces";
export type { WipStatus } from "./shared/formatting";
export {
	formatDuration,
	formatRelativeTime,
	TEMPLATE_NAMES,
	templateName,
	wipStatus,
} from "./shared/formatting";
export type * from "./shared/myWorkTypes";
