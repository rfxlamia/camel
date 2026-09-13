import {
	type MyWorkDoneActionControllerOptions,
	useMyWorkDoneAction,
} from "./useMyWorkDoneAction";
import MyWorkDoneActionView from "./MyWorkDoneActionView";

export type { MyWorkDoneMutation } from "./useMyWorkDoneAction";
export {
	isUnavailableError,
	isVersionConflict,
	unavailableReason,
} from "./useMyWorkDoneAction";

export interface MyWorkDoneActionProps
	extends MyWorkDoneActionControllerOptions {
	className?: string;
}

/** The single My Work write affordance; all source writes go through the router. */
export default function MyWorkDoneAction({
	className = "",
	...options
}: MyWorkDoneActionProps) {
	const controller = useMyWorkDoneAction(options);
	return <MyWorkDoneActionView {...controller} className={className} />;
}
