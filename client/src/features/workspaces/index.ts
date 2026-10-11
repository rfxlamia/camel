import { createWorkspacesApi } from "./workspacesApi";

// Load transport factories before UI re-exports, which can import the facade.
export { createWorkspacesApi };
