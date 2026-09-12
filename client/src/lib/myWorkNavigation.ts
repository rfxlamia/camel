import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import { useBoard } from "../context/BoardContext";
import type { MyWorkIdentity, MyWorkItem } from "../types/myWork";
import {
	getSwitchAttemptState,
	type SwitchAttemptInput,
	type SwitchAttemptState,
} from "./workspaceSwitcher";

export interface MyWorkDetailSelection extends MyWorkIdentity {}

export type MyWorkDetailState =
	| { status: "loading"; item: null; error: null }
	| { status: "ready"; item: MyWorkItem; error: null }
	| { status: "unavailable"; item: null; error: unknown }
	| { status: "error"; item: null; error: unknown };

export const MY_WORK_DETAIL_QUERY_KEYS = {
	workspaceId: "detailWorkspaceId",
	source: "detailSource",
	key: "detailKey",
} as const;

function parseWorkspaceId(value: string | null): number | null {
	if (!value || !/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseDetailValue(value: string): MyWorkDetailSelection | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(value);
	} catch {
		return null;
	}
	const match = /^(\d+)[/:](board|tracker)[/:](.+)$/.exec(decoded);
	if (!match || !match[1] || !match[2] || !match[3]) return null;
	const workspaceId = parseWorkspaceId(match[1]);
	if (!workspaceId) return null;
	return {
		workspaceId,
		source: match[2] as MyWorkDetailSelection["source"],
		key: match[3],
	};
}

/** Read the URL-addressable detail identity without performing any I/O. */
export function parseMyWorkDetailState(
	input: URLSearchParams | string,
): MyWorkDetailSelection | null {
	const params = typeof input === "string" ? new URLSearchParams(input) : input;
	const workspaceId = parseWorkspaceId(
		params.get(MY_WORK_DETAIL_QUERY_KEYS.workspaceId),
	);
	const sourceValue = params.get(MY_WORK_DETAIL_QUERY_KEYS.source);
	const key = params.get(MY_WORK_DETAIL_QUERY_KEYS.key)?.trim();
	if (
		workspaceId &&
		(sourceValue === "board" || sourceValue === "tracker") &&
		key
	) {
		return { workspaceId, source: sourceValue, key };
	}
	const legacyDetail = params.get("detail");
	return legacyDetail ? parseDetailValue(legacyDetail) : null;
}

/** Return a cloned search state with the selected detail identity appended. */
export function withMyWorkDetail(
	input: URLSearchParams | string,
	selection: MyWorkDetailSelection,
): URLSearchParams {
	const params =
		typeof input === "string"
			? new URLSearchParams(input)
			: new URLSearchParams(input);
	params.delete("detail");
	params.set(
		MY_WORK_DETAIL_QUERY_KEYS.workspaceId,
		String(selection.workspaceId),
	);
	params.set(MY_WORK_DETAIL_QUERY_KEYS.source, selection.source);
	params.set(MY_WORK_DETAIL_QUERY_KEYS.key, selection.key);
	return params;
}

/** Return a cloned search state with all detail-only query parameters removed. */
export function withoutMyWorkDetail(
	input: URLSearchParams | string,
): URLSearchParams {
	const params =
		typeof input === "string"
			? new URLSearchParams(input)
			: new URLSearchParams(input);
	params.delete("detail");
	params.delete(MY_WORK_DETAIL_QUERY_KEYS.workspaceId);
	params.delete(MY_WORK_DETAIL_QUERY_KEYS.source);
	params.delete(MY_WORK_DETAIL_QUERY_KEYS.key);
	return params;
}

function requestMyWorkDetail(
	workspaceId: number,
	source: MyWorkDetailSelection["source"],
	key: string,
	sequenceRef: { current: number },
	setState: (state: MyWorkDetailState) => void,
) {
	const requestSeq = ++sequenceRef.current;
	let active = true;
	setState({ status: "loading", item: null, error: null });
	void api
		.getMyWorkItem(workspaceId, source, key)
		.then((item) => {
			if (!active || requestSeq !== sequenceRef.current) return;
			if (!item || typeof item !== "object") {
				setState({ status: "unavailable", item: null, error: null });
				return;
			}
			setState({ status: "ready", item, error: null });
		})
		.catch((error: unknown) => {
			if (!active || requestSeq !== sequenceRef.current) return;
			setState({
				status: isMyWorkDetailUnavailable(error) ? "unavailable" : "error",
				item: null,
				error,
			});
		});
	return () => {
		active = false;
	};
}

export function useMyWorkDetailState(selection: MyWorkDetailSelection | null) {
	const [state, setState] = useState<MyWorkDetailState>({
		status: "loading",
		item: null,
		error: null,
	});
	const sequenceRef = useRef({ current: 0 });
	const workspaceId = selection?.workspaceId ?? null;
	const source = selection?.source ?? null;
	const key = selection?.key ?? null;
	const loadDetail = useCallback(() => {
		if (workspaceId === null || source === null || key === null) return;
		return requestMyWorkDetail(
			workspaceId,
			source,
			key,
			sequenceRef.current,
			setState,
		);
	}, [key, source, workspaceId]);
	useEffect(() => loadDetail(), [loadDetail]);
	return { state, retry: loadDetail, workspaceId, source, key };
}

export function isMyWorkDetailUnavailable(error: unknown): boolean {
	if (error === null || typeof error !== "object") return false;
	const candidate = error as { status?: unknown; code?: unknown };
	return (
		candidate.status === 401 ||
		candidate.status === 403 ||
		candidate.status === 404 ||
		candidate.code === "unauthorized" ||
		candidate.code === "auth_required" ||
		candidate.code === "session_expired" ||
		candidate.code === "not_authenticated" ||
		candidate.code === "not_found"
	);
}

export function myWorkDetailErrorMessage(error: unknown): string {
	if (error && typeof error === "object" && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) return message;
	}
	return "Couldn't load this work item. Check your connection and try again.";
}

export function getMyWorkSourcePath(
	item: Pick<MyWorkItem, "id" | "key" | "source">,
): string {
	return item.source === "board"
		? `/board/card/${item.id}`
		: `/tracker/${encodeURIComponent(item.key)}`;
}

export interface MyWorkSourceNavigation {
	to: string;
	workspaceId: number;
	guardState: SwitchAttemptState;
}

/** Plan an explicit source transition using the existing workspace guard state. */
export function planMyWorkSourceNavigation(
	item: Pick<MyWorkItem, "id" | "key" | "source" | "workspaceId">,
	context: SwitchAttemptInput,
): MyWorkSourceNavigation {
	return {
		to: getMyWorkSourcePath(item),
		workspaceId: item.workspaceId,
		guardState: getSwitchAttemptState(context),
	};
}

interface PendingSourceNavigation {
	to: string;
	workspaceId: number;
	confirmationRequired: boolean;
}

function usePendingSourceTransition(
	pending: PendingSourceNavigation | null,
	setPending: (value: PendingSourceNavigation | null) => void,
	activeWorkspaceId: number | null,
	switchConfirm: { open: boolean },
	navigate: (to: string) => void,
) {
	const confirmationObservedRef = useRef(false);
	useEffect(() => {
		if (!pending) return;
		if (activeWorkspaceId === pending.workspaceId) {
			setPending(null);
			confirmationObservedRef.current = false;
			navigate(pending.to);
			return;
		}
		if (pending.confirmationRequired && switchConfirm.open) {
			confirmationObservedRef.current = true;
		} else if (
			pending.confirmationRequired &&
			confirmationObservedRef.current
		) {
			setPending(null);
			confirmationObservedRef.current = false;
		}
	}, [activeWorkspaceId, navigate, pending, setPending, switchConfirm.open]);
}

interface SourceNavigationRuntime {
	item: MyWorkItem | null;
	activeWorkspaceId: number | null;
	attemptSwitchWorkspace: (workspaceId: number) => void;
	hasUnsavedCardEdits: boolean;
	hasActiveFocusSession: boolean;
	focusSessionHydrated: boolean;
	navigate: (to: string) => void;
	setPending: (value: PendingSourceNavigation | null) => void;
}

function executeMyWorkSourceNavigation({
	item,
	activeWorkspaceId,
	attemptSwitchWorkspace,
	hasUnsavedCardEdits,
	hasActiveFocusSession,
	focusSessionHydrated,
	navigate,
	setPending,
}: SourceNavigationRuntime) {
	if (!item) return;
	const plan = planMyWorkSourceNavigation(item, {
		activeWorkspaceId,
		targetWorkspaceId: item.workspaceId,
		hasUnsavedCardEdits,
		hasActiveFocusSession,
		focusSessionHydrated,
	});
	if (plan.guardState.status === "noop") {
		navigate(plan.to);
		return;
	}
	attemptSwitchWorkspace(item.workspaceId);
	if (
		plan.guardState.status === "switch" ||
		plan.guardState.status === "confirm-required"
	) {
		setPending({
			to: plan.to,
			workspaceId: item.workspaceId,
			confirmationRequired: plan.guardState.status === "confirm-required",
		});
	}
}

/** Execute explicit source navigation only after the existing workspace guard. */
export function useMyWorkSourceNavigation(item: MyWorkItem | null) {
	const navigate = useNavigate();
	const {
		activeWorkspaceId,
		attemptSwitchWorkspace,
		hasUnsavedCardEdits,
		hasActiveFocusSession,
		focusSessionHydrated,
		switchConfirm = { open: false },
	} = useBoard();
	const [pending, setPending] = useState<PendingSourceNavigation | null>(null);
	usePendingSourceTransition(
		pending,
		setPending,
		activeWorkspaceId,
		switchConfirm,
		navigate,
	);
	const handleSourceNavigation = useCallback(
		() =>
			executeMyWorkSourceNavigation({
				item,
				activeWorkspaceId,
				attemptSwitchWorkspace,
				hasUnsavedCardEdits,
				hasActiveFocusSession,
				focusSessionHydrated,
				navigate,
				setPending,
			}),
		[
			activeWorkspaceId,
			attemptSwitchWorkspace,
			focusSessionHydrated,
			hasActiveFocusSession,
			hasUnsavedCardEdits,
			item,
			navigate,
		],
	);
	return { handleSourceNavigation, pending: pending !== null };
}
