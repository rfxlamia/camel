import { createActivityApi } from "./features/activity";
import { createAgentApi } from "./features/agent";
import { createAuthApi } from "./features/auth";
import { createBoardApi } from "./features/board";
import { createChatApi } from "./features/chat";
import { createFocusApi } from "./features/focus";
import { createMyWorkApi } from "./features/my-work";
import { createNotificationsApi } from "./features/notifications";
import { createSettingsApi } from "./features/settings";
import { createTrackerApi, createWorkItemApi } from "./features/tracker";
import { createWorkspacesApi } from "./features/workspaces";
import { createApiRequest } from "./shared/apiRequest";

export {
	type TicketHistoryEntry,
	type TicketIntakeChatResponse,
	type TicketIntakeDraft,
} from "./features/agent";
export {
	type CardAttachmentUploadResponse,
	cardAttachmentDownloadUrl,
	cardAttachmentOriginalUrl,
	cardAttachmentThumbnailUrl,
} from "./features/board";
export {
	ApiError,
	configureRequestBoundaryForTests,
	resetRequestBoundaryForTests,
} from "./shared/apiRequest";

const request = createApiRequest();

export const api = {
	...createMyWorkApi(request),
	...createBoardApi(request),
	...createAuthApi(request),
	...createActivityApi(request),
	...createNotificationsApi(request),
	...createSettingsApi(request),
	...createWorkspacesApi(request),
	...createWorkItemApi(request),
	...createTrackerApi(request),
	...createAgentApi(request),
	...createChatApi(request),
	...createFocusApi(request),
};
