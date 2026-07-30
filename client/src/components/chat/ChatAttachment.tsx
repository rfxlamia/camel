import { Download } from "lucide-react";
import { useCallback, useState } from "react";
import { api } from "../../api";
import type { ChatAttachment } from "../../types";

interface ChatAttachmentProps {
	attachment: ChatAttachment;
}

export function ChatAttachment({ attachment }: ChatAttachmentProps) {
	const [downloading, setDownloading] = useState(false);

	const handleDownload = useCallback(async () => {
		setDownloading(true);
		try {
			const blob = await api.chat.downloadAttachment(attachment.id);
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = attachment.filename;
			anchor.click();
			URL.revokeObjectURL(url);
		} finally {
			setDownloading(false);
		}
	}, [attachment.filename, attachment.id]);

	return (
		<button
			type="button"
			onClick={() => void handleDownload()}
			disabled={downloading}
			className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800 hover:bg-neutral-100 disabled:opacity-50"
		>
			<Download size={14} aria-hidden />
			<span>{attachment.filename}</span>
		</button>
	);
}
