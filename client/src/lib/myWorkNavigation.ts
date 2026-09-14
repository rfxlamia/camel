import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { MyWorkIdentity, MyWorkItem } from "../types/myWork";

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

export function useMyWorkDetailState(
	selection: MyWorkDetailSelection | null,
	refreshToken = 0,
) {
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
		void refreshToken;
		return requestMyWorkDetail(
			workspaceId,
			source,
			key,
			sequenceRef.current,
			setState,
		);
	}, [key, refreshToken, source, workspaceId]);
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

export * from "./myWorkSourceNavigation";
