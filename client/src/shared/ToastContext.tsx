import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";

export type ToastType = "success" | "error" | "warning" | "info";

export const TOAST_DISMISS_MS = 3500;

export type ToastState = { message: string; type: ToastType } | null;

export type ShowToast = (message: string, type?: ToastType) => void;

const ShowToastContext = createContext<ShowToast | undefined>(undefined);
const ToastStateContext = createContext<ToastState | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
	const [toast, setToast] = useState<ToastState>(null);
	const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const showToast = useCallback((message: string, type: ToastType = "info") => {
		setToast({ message, type });
		if (toastTimer.current) clearTimeout(toastTimer.current);
		toastTimer.current = setTimeout(() => setToast(null), TOAST_DISMISS_MS);
	}, []);

	useEffect(() => {
		return () => {
			if (toastTimer.current) clearTimeout(toastTimer.current);
		};
	}, []);

	return (
		<ShowToastContext.Provider value={showToast}>
			<ToastStateContext.Provider value={toast}>
				{children}
			</ToastStateContext.Provider>
		</ShowToastContext.Provider>
	);
}

export function useShowToast(): ShowToast {
	const ctx = useContext(ShowToastContext);
	if (ctx === undefined) {
		throw new Error("useShowToast must be used within ToastProvider");
	}
	return ctx;
}

export function useToastState(): ToastState {
	const ctx = useContext(ToastStateContext);
	if (ctx === undefined) {
		throw new Error("useToastState must be used within ToastProvider");
	}
	return ctx;
}
