import type { MyWorkItem, MyWorkScope } from "../shared/myWorkTypes";
import {
	getMyWorkMutationSnapshot,
	myWorkMutationIdentity,
	reconcileMyWorkMutationSnapshot,
} from "../shared/workItemMutations";
import { isActiveMyWorkItem } from "./myWorkStatus";

/** Drop stale mutation overlays once a fresher authoritative row is available. */
export function reconcileMyWorkMutations(
	authoritativeItems: readonly MyWorkItem[],
): void {
	for (const item of authoritativeItems) {
		const snapshot = getMyWorkMutationSnapshot(item);
		if (!snapshot || snapshot.status === "pending") continue;
		if (snapshot.status === "unavailable") {
			reconcileMyWorkMutationSnapshot(myWorkMutationIdentity(item));
			continue;
		}
		if (snapshot.status !== "success") continue;
		const reopenedOnServer =
			isActiveMyWorkItem(item) && !isActiveMyWorkItem(snapshot.item);
		if (item.version > snapshot.item.version || reopenedOnServer) {
			reconcileMyWorkMutationSnapshot(myWorkMutationIdentity(item));
		}
	}
}

/** Apply settled mutation projections before grouping, counts, and pagination. */
export function projectMyWorkListItems(
	items: readonly MyWorkItem[],
	scope: MyWorkScope,
): MyWorkItem[] {
	const projected: MyWorkItem[] = [];
	for (const item of items) {
		const snapshot = getMyWorkMutationSnapshot(item);
		if (snapshot?.status === "unavailable") continue;
		if (
			scope === "active" &&
			(snapshot?.status === "pending" || snapshot?.status === "success")
		) {
			continue;
		}
		projected.push(
			scope === "all" && snapshot?.status === "success" ? snapshot.item : item,
		);
	}
	return projected;
}
