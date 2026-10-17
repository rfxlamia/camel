import { createActivityApi } from "./activityApi";

export type { ActivityEvent, AttachmentActivityPayload } from "./activityTypes";
// Load transport factories before UI re-exports, which can import the facade.
export { createActivityApi };
