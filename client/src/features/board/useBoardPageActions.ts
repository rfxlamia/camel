import { useCallback, useState } from "react";
import { ApiError, api } from "../../api";
import type { useShowToast } from "../../shared/ToastContext";
import type { BoardCreatePayload } from "../../shared/taskCreateContracts";
import type { useBoard } from "./BoardContext";
import type { WorkspaceTemplate } from "./templates";

export function useBoardPageActions({
	activeWorkspaceId,
	board,
	showToast,
}: {
	activeWorkspaceId: number | null;
	board: ReturnType<typeof useBoard>;
	showToast: ReturnType<typeof useShowToast>;
}) {
	const { cancelScheduledRefresh, refresh } = board;
	const [pickerState, setPickerState] = useState<
		"idle" | "loading" | "success"
	>("idle");
	const [startBlank, setStartBlank] = useState(false);
	const onAddCard = useCallback(
		async (payload: BoardCreatePayload) => {
			if (activeWorkspaceId === null) return;
			try {
				cancelScheduledRefresh();
				await api.createCard(activeWorkspaceId, payload);
			} catch (err) {
				if (err instanceof ApiError && err.status === 409) {
					showToast("WIP limit reached — finish something first.", "warning");
				} else {
					showToast(
						"Couldn't add the card. Check your connection and try again.",
						"error",
					);
				}
				throw err;
			}
			try {
				await refresh();
			} catch {
				showToast(
					"Card created, but the board couldn't refresh — retrying in the background.",
					"warning",
				);
				void refresh();
			}
		},
		[activeWorkspaceId, cancelScheduledRefresh, refresh, showToast],
	);

	const onUpdateColumn = useCallback(
		async (
			id: number,
			patch: {
				title?: string;
				wipLimit?: number | null;
				policy?: string;
				isDone?: boolean;
				isSignable?: boolean;
				signableAssigneeId?: number | null;
				color?: string | null;
			},
		) => {
			if (activeWorkspaceId === null) return;
			try {
				cancelScheduledRefresh();
				await api.updateColumn(activeWorkspaceId, id, patch);
				await refresh();
			} catch {
				showToast("Couldn't update the column. Try again.", "error");
			}
		},
		[activeWorkspaceId, cancelScheduledRefresh, refresh, showToast],
	);

	const onAddColumn = useCallback(
		async (title: string) => {
			if (activeWorkspaceId === null) return;
			try {
				cancelScheduledRefresh();
				await api.createColumn(activeWorkspaceId, title);
				await refresh();
			} catch {
				showToast(
					"Couldn't add the column. Check your connection and try again.",
					"error",
				);
			}
		},
		[activeWorkspaceId, cancelScheduledRefresh, refresh, showToast],
	);

	const onStartBlank = useCallback(() => {
		setStartBlank(true);
	}, []);

	const onApplyTemplate = useCallback(
		async (template: WorkspaceTemplate) => {
			if (activeWorkspaceId === null) return;
			setPickerState("loading");
			try {
				cancelScheduledRefresh();
				await api.applyTemplate(activeWorkspaceId, {
					templateName: template.name,
					columns: template.columns,
				});
				setPickerState("success");
				window.setTimeout(() => {
					void refresh().then(() => setPickerState("idle"));
				}, 2000);
			} catch (err) {
				if (err instanceof ApiError && err.status === 409) {
					await refresh();
					setPickerState("idle");
				} else {
					showToast(
						"Couldn't apply the template. Check your connection and try again.",
						"error",
					);
					setPickerState("idle");
				}
			}
		},
		[activeWorkspaceId, cancelScheduledRefresh, refresh, showToast],
	);

	return {
		onAddCard,
		onAddColumn,
		onApplyTemplate,
		onStartBlank,
		onUpdateColumn,
		pickerState,
		startBlank,
	};
}
