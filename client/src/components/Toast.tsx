import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ToastType } from "../context/BoardContext";

interface Props {
	message: string;
	type?: ToastType;
}

const config: Record<
	ToastType,
	{ icon: React.ReactNode; classes: string }
> = {
	success: {
		icon: <CheckCircle2 size={15} className="shrink-0 text-success-500" />,
		classes:
			"border-success-500/30 bg-success-100 text-success-900",
	},
	error: {
		icon: <XCircle size={15} className="shrink-0 text-error-500" />,
		classes: "border-error-500/30 bg-error-100 text-error-900",
	},
	warning: {
		icon: <AlertTriangle size={15} className="shrink-0 text-warning-500" />,
		classes:
			"border-warning-500/30 bg-warning-100 text-warning-900",
	},
	info: {
		icon: <Info size={15} className="shrink-0 text-info-500" />,
		classes: "border-info-500/30 bg-info-100 text-info-900",
	},
};

export default function Toast({ message, type = "info" }: Props) {
	const { icon, classes } = config[type];
	return (
		<div
			role="status"
			aria-live={type === "error" ? "assertive" : "polite"}
			aria-atomic="true"
			className={`fixed bottom-6 left-1/2 z-50 flex animate-toast-in items-center gap-2 rounded-md border px-3.5 py-2.5 text-sm font-medium shadow-sm ${classes}`}
		>
			{icon}
			{message}
		</div>
	);
}
