import { createAuthApi } from "./authApi";

// Load transport factories before UI re-exports, which can import the facade.
export { createAuthApi };
