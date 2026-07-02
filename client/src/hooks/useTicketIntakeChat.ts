import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type TicketIntakeDraft } from "../api";

export type TicketIntakeMessage = {
	role: "user" | "assistant";
	content: string;
};

export type TicketIntakeSubmitState =
	| "idle"
	| "submitting"
	| "success"
	| "graceful_failure"
	| "rate_limited";

export type TicketIntakeResultEvent = {
	type: "ticket_intake.submit_result";
	success: boolean;
	issueUrl?: string;
	issueIdentifier?: string;
	errorMessage?: string;
	retryable?: boolean;
	cardId?: number;
};

export type TicketIntakePrefill = {
	cardId?: number;
	cardTitle?: string;
	cardDescription?: string;
	endpoint?: string;
	status?: number;
	errorMessage?: string;
	timestamp?: string;
	userAction?: string;
};

export type TicketIntakeOpenConfig =
	| {
			variant: "card";
			prefill: {
				title: string;
				description: string;
				cardId: number;
				cardLink?: string;
			};
	  }
	| {
			variant: "autoError";
			prefill: TicketIntakePrefill;
	  };

type ActiveSession = {
	variant: "card" | "autoError";
	prefill: TicketIntakePrefill;
};

export interface UseTicketIntakeChatConfig {
	workspaceId: number | null;
	variant: "global" | "card" | "autoError";
	prefill?: TicketIntakePrefill;
	ticketIntakeEvents?: TicketIntakeResultEvent[];
}

function buildAutoErrorMessage(prefill: TicketIntakePrefill): string {
	const parts = [
		prefill.userAction ? `User action: ${prefill.userAction}` : null,
		prefill.endpoint ? `Endpoint: ${prefill.endpoint}` : null,
		prefill.status !== undefined ? `Status: ${prefill.status}` : null,
		prefill.errorMessage ? `Error: ${prefill.errorMessage}` : null,
		prefill.timestamp ? `Time: ${prefill.timestamp}` : null,
	].filter((part): part is string => part !== null);
	return parts.join("\n");
}

function buildCardContext(prefill: TicketIntakePrefill): string {
	const parts = [
		prefill.cardTitle ? `Card: ${prefill.cardTitle}` : null,
		prefill.cardDescription ? `Description: ${prefill.cardDescription}` : null,
	].filter((part): part is string => part !== null);
	return parts.join("\n");
}

function sourceForVariant(
	variant: UseTicketIntakeChatConfig["variant"],
): string {
	switch (variant) {
		case "card":
			return "card";
		case "autoError":
			return "error";
		default:
			return "global";
	}
}

function openConfigToPrefill(
	config: TicketIntakeOpenConfig,
): TicketIntakePrefill {
	if (config.variant === "card") {
		return {
			cardId: config.prefill.cardId,
			cardTitle: config.prefill.title,
			cardDescription: config.prefill.description,
		};
	}
	return config.prefill;
}

export function useTicketIntakeChat(config: UseTicketIntakeChatConfig) {
	const { workspaceId, variant, prefill, ticketIntakeEvents = [] } = config;

	const [activeSession, setActiveSession] = useState<ActiveSession | null>(
		null,
	);
	const [messages, setMessages] = useState<TicketIntakeMessage[]>([]);
	const [draft, setDraft] = useState<TicketIntakeDraft | null>(null);
	const [previewReady, setPreviewReady] = useState(false);
	const [submitState, setSubmitState] =
		useState<TicketIntakeSubmitState>("idle");
	const [panelOpen, setPanelOpen] = useState(variant === "autoError");

	const effectiveVariant = activeSession?.variant ?? variant;
	const effectivePrefill = activeSession?.prefill ?? prefill;

	const cardContextUsedRef = useRef(false);
	const autoErrorInitRef = useRef(false);
	const processedEventCountRef = useRef(0);
	const messagesRef = useRef(messages);
	messagesRef.current = messages;

	const resetSession = useCallback(() => {
		setMessages([]);
		setDraft(null);
		setPreviewReady(false);
		setSubmitState("idle");
		cardContextUsedRef.current = false;
		autoErrorInitRef.current = false;
		processedEventCountRef.current = 0;
	}, []);

	const open = useCallback(
		(openConfig: TicketIntakeOpenConfig) => {
			resetSession();
			setActiveSession({
				variant: openConfig.variant,
				prefill: openConfigToPrefill(openConfig),
			});
			setPanelOpen(true);
		},
		[resetSession],
	);

	const close = useCallback(() => {
		setPanelOpen(false);
		setActiveSession(null);
		autoErrorInitRef.current = false;
	}, []);

	const submitBodyFromDraft = useCallback(
		(currentDraft: TicketIntakeDraft) => ({
			title: currentDraft.title ?? "",
			description: currentDraft.description ?? "",
			type: currentDraft.type ?? "Bug",
			...(effectivePrefill?.cardId !== undefined
				? { cardId: effectivePrefill.cardId }
				: {}),
			source: sourceForVariant(effectiveVariant),
		}),
		[effectivePrefill?.cardId, effectiveVariant],
	);

	const sendMessage = useCallback(
		async (message: string) => {
			if (!workspaceId) return;

			const trimmed = message.trim();
			if (!trimmed) return;

			let outbound = trimmed;
			if (
				effectiveVariant === "card" &&
				effectivePrefill &&
				!cardContextUsedRef.current
			) {
				const context = buildCardContext(effectivePrefill);
				if (context) {
					outbound = `${context}\n\n${trimmed}`;
					cardContextUsedRef.current = true;
				}
			}

			const priorMessages = messagesRef.current;
			const isFirstTurn = !priorMessages.some((m) => m.role === "user");
			const nextMessages: TicketIntakeMessage[] = [
				...priorMessages,
				{ role: "user", content: trimmed },
			];
			setMessages(nextMessages);

			const conversationHistory = isFirstTurn
				? undefined
				: nextMessages.map((m) => ({
						role: m.role,
						content: m.content,
					}));

			try {
				const response = await api.ticketIntake.sendMessage(workspaceId, {
					message: outbound,
					isFirstTurn,
					...(effectiveVariant === "autoError" && isFirstTurn
						? { autoError: true }
						: {}),
					conversationHistory,
				});

				if (response.ready) {
					setDraft(response.draft);
					setPreviewReady(true);
					return;
				}

				setPreviewReady(false);
				setDraft(null);
				setMessages((prev) => [
					...prev,
					{ role: "assistant", content: response.question },
				]);
			} catch {
				setMessages(priorMessages);
			}
		},
		[workspaceId, effectiveVariant, effectivePrefill],
	);

	useEffect(() => {
		if (effectiveVariant !== "autoError" || !workspaceId || !effectivePrefill) {
			return;
		}
		if (!panelOpen) return;
		if (autoErrorInitRef.current) return;
		autoErrorInitRef.current = true;
		void sendMessage(buildAutoErrorMessage(effectivePrefill));
	}, [
		effectiveVariant,
		workspaceId,
		effectivePrefill,
		panelOpen,
		sendMessage,
	]);

	useEffect(() => {
		if (variant !== "autoError" || activeSession !== null) return;
		if (!workspaceId || !prefill) return;
		if (!panelOpen) return;
		if (autoErrorInitRef.current) return;
		autoErrorInitRef.current = true;
		void sendMessage(buildAutoErrorMessage(prefill));
	}, [
		variant,
		activeSession,
		workspaceId,
		prefill,
		panelOpen,
		sendMessage,
	]);

	useEffect(() => {
		if (submitState !== "submitting") return;

		for (
			let i = processedEventCountRef.current;
			i < ticketIntakeEvents.length;
			i++
		) {
			const event = ticketIntakeEvents[i];
			if (event.type !== "ticket_intake.submit_result") continue;

			processedEventCountRef.current = i + 1;
			setSubmitState(event.success ? "success" : "graceful_failure");
			return;
		}
	}, [ticketIntakeEvents, submitState]);

	const editDraft = useCallback((patch: Partial<TicketIntakeDraft>) => {
		setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
	}, []);

	const confirm = useCallback(async () => {
		if (!workspaceId || !draft || !draft.title?.trim()) return;

		setSubmitState("submitting");
		try {
			await api.ticketIntake.submit(workspaceId, submitBodyFromDraft(draft));
		} catch (err) {
			if (err instanceof ApiError && err.status === 409) {
				setSubmitState("rate_limited");
				return;
			}
			setSubmitState("idle");
		}
	}, [workspaceId, draft, submitBodyFromDraft]);

	const resubmit = useCallback(async () => {
		if (!workspaceId || !draft || !draft.title?.trim()) return;

		setSubmitState("submitting");
		try {
			await api.ticketIntake.resubmit(
				workspaceId,
				submitBodyFromDraft(draft),
			);
		} catch (err) {
			if (err instanceof ApiError && err.status === 409) {
				setSubmitState("rate_limited");
				return;
			}
			setSubmitState("graceful_failure");
		}
	}, [workspaceId, draft, submitBodyFromDraft]);

	return {
		messages,
		sendMessage,
		previewReady,
		draft,
		submitState,
		confirm,
		editDraft,
		resubmit,
		open,
		close,
		panelOpen,
		activeVariant: effectiveVariant,
		activePrefill: effectivePrefill,
	};
}
