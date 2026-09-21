import { useCallback, useEffect, useRef, useState } from "react";
import {
	MAX_ATTACHMENT_COUNT,
	prepareImageAttachment,
} from "../../shared/imageAttachments";
import {
	countStagedSlots,
	createStageId,
	hasUnreadyStagedImages,
	STAGE_CAP_MESSAGE,
	type StagedImage,
} from "./addCardImageStaging";

export function useAddCardImageStaging() {
	const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);
	const [stageCapMessage, setStageCapMessage] = useState<string | null>(null);
	const previewUrlsRef = useRef<string[]>([]);
	const preparationGenerationRef = useRef(0);

	const trackPreviewUrl = useCallback((url: string) => {
		previewUrlsRef.current.push(url);
	}, []);

	const revokePreviewUrls = useCallback(() => {
		for (const url of previewUrlsRef.current) {
			URL.revokeObjectURL(url);
		}
		previewUrlsRef.current = [];
	}, []);

	useEffect(() => {
		return () => {
			preparationGenerationRef.current += 1;
			revokePreviewUrls();
		};
	}, [revokePreviewUrls]);

	const resetStagedImages = useCallback(() => {
		preparationGenerationRef.current += 1;
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
			const generation = preparationGenerationRef.current;
			setStageCapMessage(null);
			for (const file of files) {
				if (generation !== preparationGenerationRef.current) return;
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
				if (generation !== preparationGenerationRef.current) return;
				setStagedImages((current) => {
					if (!current.some((entry) => entry.id === loadingId)) return current;
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

	const hasUnreadyStaged = hasUnreadyStagedImages(stagedImages);

	return {
		stagedImages,
		setStagedImages,
		stageCapMessage,
		hasUnreadyStaged,
		stageFiles,
		removeStagedImage,
		resetStagedImages,
	};
}
