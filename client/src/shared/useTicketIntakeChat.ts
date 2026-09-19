import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type TicketIntakeDraft } from "../api";

export type TicketIntakeMessage = {
	role: "user" | "assistant";
	content: string;
};

export type TicketIntakeSubmitState =
	| { status: "idle"; lastError?: string }
	| { status: "submitting" }
	| { status: "success"; issueUrl: string; issueIdentifier: string }
	| { status: "graceful_failure"; errorMessage?: string; retryable?: boolean }
	| { status: "rate_limited" };

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

// Keep in sync with server/src/routes/ticket-intake.ts CLASSIFIER_QUESTION
export const CLASSIFIER_QUESTION =
	"What kind of issue is this — a bug, a feature request, or an improvement?";

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
	const [submitState, setSubmitState] = useState<TicketIntakeSubmitState>({
		status: "idle",
	});
	const [panelOpen, setPanelOpen] = useState(variant === "autoError");
	const [isSending, setIsSending] = useState(false);
	const [chatCooldownUntil, setChatCooldownUntil] = useState<number | null>(
		null,
	);
	const [sendError, setSendError] = useState<string | null>(null);
	const [chatSendBlocked, setChatSendBlocked] = useState(false);

	const effectiveVariant = activeSession?.variant ?? variant;
	const effectivePrefill = activeSession?.prefill ?? prefill;

	const cardContextUsedRef = useRef(false);
	const autoErrorInitRef = useRef(false);
	const processedEventCountRef = useRef(0);
	const messagesRef = useRef(messages);
	messagesRef.current = messages;

	const applyChatCooldown = useCallback((retryAfterMs?: number) => {
		const delayMs = retryAfterMs ?? 10_000;
		setChatCooldownUntil(Date.now() + delayMs);
		setChatSendBlocked(true);
	}, []);

	const refreshChatLimit = useCallback(async () => {
		if (!workspaceId) return;
		try {
			const limit = await api.ticketIntake.getChatLimit(workspaceId);
			if (limit.isLocked && limit.retryAfterMs !== undefined) {
				setChatCooldownUntil(Date.now() + limit.retryAfterMs);
				setChatSendBlocked(true);
			} else {
				setChatSendBlocked(false);
				setChatCooldownUntil(null);
			}
		} catch {
			// Non-fatal — server still enforces on send.
		}
	}, [workspaceId]);

	useEffect(() => {
		if (!panelOpen || !workspaceId) return;
		void refreshChatLimit();
	}, [panelOpen, workspaceId, refreshChatLimit]);

	useEffect(() => {
		if (!chatCooldownUntil) return;
		const remaining = chatCooldownUntil - Date.now();
		if (remaining <= 0) {
			setChatSendBlocked(false);
			setChatCooldownUntil(null);
			return;
		}
		const timer = setTimeout(() => {
			setChatSendBlocked(false);
			setChatCooldownUntil(null);
		}, remaining);
		return () => clearTimeout(timer);
	}, [chatCooldownUntil]);

	const resetSession = useCallback(() => {
		setMessages([]);
		setDraft(null);
		setPreviewReady(false);
		setSubmitState({ status: "idle" });
		setIsSending(false);
		setSendError(null);
		cardContextUsedRef.current = false;
		autoErrorInitRef.current = false;
		processedEventCountRef.current = 0;
	}, []);

	const seedClassifier = useCallback(() => {
		setMessages([{ role: "assistant", content: CLASSIFIER_QUESTION }]);
	}, []);

	const open = useCallback(
		(openConfig: TicketIntakeOpenConfig) => {
			resetSession();
			setActiveSession({
				variant: openConfig.variant,
				prefill: openConfigToPrefill(openConfig),
			});
			if (openConfig.variant !== "autoError") {
				seedClassifier();
			}
			setPanelOpen(true);
		},
		[resetSession, seedClassifier],
	);

	const openPanel = useCallback(() => {
		resetSession();
		setActiveSession(null);
		seedClassifier();
		setPanelOpen(true);
	}, [resetSession, seedClassifier]);

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
			if (!workspaceId || chatSendBlocked || isSending) return;

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
			const isFirstUserMessage = !priorMessages.some((m) => m.role === "user");
			const isFirstApiTurn = priorMessages.length === 0;
			const nextMessages: TicketIntakeMessage[] = [
				...priorMessages,
				{ role: "user", content: trimmed },
			];
			setMessages(nextMessages);
			setIsSending(true);
			setSendError(null);

			const conversationHistory = isFirstApiTurn
				? undefined
				: priorMessages.map((m) => ({
						role: m.role,
						content: m.content,
					}));

			try {
				const response = await api.ticketIntake.sendMessage(workspaceId, {
					message: outbound,
					isFirstTurn: isFirstApiTurn,
					...(effectiveVariant === "autoError" && isFirstApiTurn
						? { autoError: true }
						: {}),
					conversationHistory,
				});

				if (!isFirstUserMessage) {
					applyChatCooldown();
				}

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
			} catch (err) {
				setMessages(priorMessages);
				if (err instanceof ApiError && err.status === 429) {
					applyChatCooldown(err.retryAfterMs);
					setSendError("Please wait a moment before sending another message.");
				} else {
					const message =
						err instanceof Error ? err.message : "Failed to send message";
					setSendError(message);
				}
			} finally {
				setIsSending(false);
			}
		},
		[
			workspaceId,
			effectiveVariant,
			effectivePrefill,
			chatSendBlocked,
			isSending,
			applyChatCooldown,
		],
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
		if (submitState.status !== "submitting") return;

		for (
			let i = processedEventCountRef.current;
			i < ticketIntakeEvents.length;
			i++
		) {
			const event = ticketIntakeEvents[i];
			if (event.type !== "ticket_intake.submit_result") continue;

			processedEventCountRef.current = i + 1;
			if (event.success) {
				setSubmitState({
					status: "success",
					issueUrl: event.issueUrl ?? "",
					issueIdentifier: event.issueIdentifier ?? "",
				});
			} else {
				setSubmitState({
					status: "graceful_failure",
					errorMessage: event.errorMessage,
					retryable: event.retryable,
				});
			}
			return;
		}
	}, [ticketIntakeEvents, submitState]);

	const editDraft = useCallback((patch: Partial<TicketIntakeDraft>) => {
		setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
	}, []);

	const confirm = useCallback(
		async (patch?: Partial<Pick<TicketIntakeDraft, "title" | "description">>) => {
			const currentDraft =
				patch && draft ? { ...draft, ...patch } : draft;
			if (!workspaceId || !currentDraft || !currentDraft.title?.trim()) return;

			setSubmitState({ status: "submitting" });
			try {
				await api.ticketIntake.submit(
					workspaceId,
					submitBodyFromDraft(currentDraft),
				);
			} catch (err) {
				if (err instanceof ApiError && err.status === 409) {
					setSubmitState({ status: "rate_limited" });
					return;
				}
				const message =
					err instanceof Error ? err.message : "Failed to submit ticket";
				setSubmitState({ status: "idle", lastError: message });
			}
		},
		[workspaceId, draft, submitBodyFromDraft],
	);

	const resubmit = useCallback(async () => {
		if (!workspaceId || !draft || !draft.title?.trim()) return;

		setSubmitState({ status: "submitting" });
		try {
			await api.ticketIntake.resubmit(
				workspaceId,
				submitBodyFromDraft(draft),
			);
		} catch (err) {
			if (err instanceof ApiError && err.status === 409) {
				setSubmitState({ status: "rate_limited" });
				return;
			}
			const message =
				err instanceof Error ? err.message : "Failed to resubmit ticket";
			setSubmitState({
				status: "graceful_failure",
				errorMessage: message,
			});
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
		openPanel,
		close,
		panelOpen,
		isSending,
		chatSendBlocked,
		sendError,
		activeVariant: effectiveVariant,
		activePrefill: effectivePrefill,
	};
}
