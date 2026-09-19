import { useSyncExternalStore } from "react";
import { useInRouterContext, useSearchParams } from "react-router";
import type { MyWorkItem, MyWorkScope } from "../../shared/myWorkTypes";
import {
	getMyWorkMutationSnapshot,
	type MyWorkMutationSnapshot,
	myWorkMutationIdentity,
	subscribeToMyWorkMutations,
} from "../../shared/workItemMutations";
import MyWorkDoneAction, {
	type MyWorkDoneActionProps,
} from "./MyWorkDoneAction";
import { createRowView, RowButton, rowIdentity } from "./MyWorkRowParts";

function useRowMutationSnapshot(
	item: MyWorkItem,
): MyWorkMutationSnapshot | undefined {
	const identity = myWorkMutationIdentity(item);
	return useSyncExternalStore(
		subscribeToMyWorkMutations,
		() => getMyWorkMutationSnapshot(identity),
		() => undefined,
	);
}

export interface MyWorkRowProps
	extends Partial<Omit<MyWorkDoneActionProps, "item">> {
	item: MyWorkItem;
	/** Called when the row's read-only selection action is activated. */
	onSelect?: (item: MyWorkItem) => void;
	/** Alias kept for callers that describe the row action as opening it. */
	onOpen?: (item: MyWorkItem) => void;
	/** Compact mode keeps the same metadata while tightening the mobile rhythm. */
	compact?: boolean;
	/** Scope controls whether a successful item is hidden or retained as Done. */
	scope?: MyWorkScope;
}

function activateRow(
	item: MyWorkItem,
	onSelect?: (item: MyWorkItem) => void,
	onOpen?: (item: MyWorkItem) => void,
) {
	if (onSelect) onSelect(item);
	else onOpen?.(item);
}

function RowShell({
	item,
	onSelect,
	onOpen,
	compact = false,
	scope = "active",
	...actionProps
}: MyWorkRowProps & { scope: MyWorkScope }) {
	const snapshot = useRowMutationSnapshot(item);
	if (
		snapshot?.status === "unavailable" ||
		(scope === "active" &&
			(snapshot?.status === "pending" || snapshot?.status === "success"))
	) {
		return null;
	}
	const displayItem =
		scope === "all" && snapshot?.status === "success" ? snapshot.item : item;
	const view = createRowView(displayItem);
	return (
		<li
			data-testid={`my-work-row-${rowIdentity(item)}`}
			data-work-item-key={item.key}
			className="border-neutral-200 border-b last:border-b-0"
		>
			<div className="flex min-w-0 items-stretch bg-white">
				<RowButton
					item={displayItem}
					compact={compact}
					view={view}
					onActivate={() => activateRow(displayItem, onSelect, onOpen)}
				/>
				<div
					data-testid="my-work-done-gutter"
					className={`flex shrink-0 items-center justify-center border-neutral-100 border-l bg-white [&:not(:has(*))]:hidden ${
						compact ? "px-2" : "px-2 md:px-3"
					}`}
				>
					<MyWorkDoneAction item={displayItem} {...actionProps} />
				</div>
			</div>
		</li>
	);
}

function RoutedMyWorkRow(props: MyWorkRowProps) {
	const [searchParams] = useSearchParams();
	const scope: MyWorkScope =
		searchParams.get("scope") === "all" ? "all" : "active";
	return <RowShell {...props} scope={props.scope ?? scope} />;
}

/** A responsive work row with the shared My Work Mark done action. */
export default function MyWorkRow(props: MyWorkRowProps) {
	const inRouter = useInRouterContext();
	if (props.scope !== undefined || !inRouter) {
		return <RowShell {...props} scope={props.scope ?? "active"} />;
	}
	return <RoutedMyWorkRow {...props} />;
}
