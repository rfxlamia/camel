import { useCallback, useRef, useState } from "react";
import {
	MAX_ATTACHMENT_COUNT,
	prepareImageAttachment,
} from "../lib/imageAttachments";
import {
	countStagedSlots,
	createStageId,
	hasInvalidStagedImages,
	STAGE_CAP_MESSAGE,
	type StagedImage,
} from "./addCardImageStaging";

export function useAddCardImageStaging() {
	const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
	const [stageCapMessage, setStageCapMessage] = useState<string | null>(null);
	const previewUrlsRef = useRef<string[]>([]);

	const trackPreviewUrl = useCallback((url: string) => {
		previewUrlsRef.current.push(url);
	}, []);

	const revokePreviewUrls = useCallback(() => {
		for (const url of previewUrlsRef.current) {
			URL.revokeObjectURL(url);
		}
		previewUrlsRef.current = [];
	}, []);

	const resetStagedImages = useCallback(() => {
		revokePreviewUrls();
		setStagedImages([]);
		setStageCapMessage(null);
	}, [revokePreviewUrls]);

	const removeStagedImage = useCallback((id: string) => {
		setStagedImages((current) => {
			const removed = current.find((entry) => entry.id === id);
			if (
				removed &&
				(removed.kind === "valid" || removed.kind === "network-error")
			) {
				URL.revokeObjectURL(removed.previewUrl);
				previewUrlsRef.current = previewUrlsRef.current.filter(
					(url) => url !== removed.previewUrl,
				);
			}
			return current.filter((entry) => entry.id !== id);
		});
		setStageCapMessage(null);
	}, []);

	const stageFiles = useCallback(
		async (files: File[]) => {
			setStageCapMessage(null);
			for (const file of files) {
				const loadingId = createStageId();
				let rejected = false;
				setStagedImages((current) => {
					if (countStagedSlots(current) >= MAX_ATTACHMENT_COUNT) {
						rejected = true;
						return current;
					}
					return [
						...current,
						{ id: loadingId, kind: "loading", name: file.name },
					];
				});
				if (rejected) {
					setStageCapMessage(STAGE_CAP_MESSAGE);
					return;
				}

				const result = await prepareImageAttachment(file);
				setStagedImages((current) => {
					const next = current.filter((entry) => entry.id !== loadingId);
					if (result.kind === "invalid") {
						return [
							...next,
							{
								id: createStageId(),
								kind: "invalid",
								name: result.file.name,
								file: result.file,
								error: result.error,
							},
						];
					}
					const previewUrl = URL.createObjectURL(result.original);
					trackPreviewUrl(previewUrl);
					return [
						...next,
						{
							id: createStageId(),
							kind: "valid",
							name: result.original.name,
							prepared: result.prepared,
							previewUrl,
						},
					];
				});
			}
		},
		[trackPreviewUrl],
	);

	const hasInvalidStaged = hasInvalidStagedImages(stagedImages);

	return {
		stagedImages,
		setStagedImages,
		stageCapMessage,
		hasInvalidStaged,
		stageFiles,
		removeStagedImage,
		resetStagedImages,
	};
}
