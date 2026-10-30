import { createNotificationsApi } from "./notificationsApi";

// Load transport factories before UI re-exports, which can import the facade.
export {
	NotificationsProvider,
	useNotificationsContext,
} from "./NotificationsContext";
export { createNotificationsApi };
