export const MAX_ATTACHMENT_COUNT = 3;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 4096;

const MAX_THUMBNAIL_DIMENSION = 1024;
const MIME_TO_EXTENSION = {
	"image/png": "png",
	"image/jpeg": "jpg",
} as const;

export const IMAGE_VALIDATION_MESSAGES = {
	unsupported: "Only PNG and JPEG accepted",
	tooLarge: "File size must be under 10MB",
	tooLargeDimensions: "Image dimensions must be 4096px or smaller",
	unreadableDimensions: "Image dimensions could not be read",
} as const;

export interface PreparedImagePair {
	thumbnail: File;
	original: File;
}

export type InvalidImagePreparation = {
	kind: "invalid";
	file: File;
	original: File;
	error: string;
};

export type ValidImagePreparation = {
	kind: "valid";
	file: File;
	original: File;
	thumbnail: File;
	prepared: PreparedImagePair;
};

export type ImagePreparationResult =
	| InvalidImagePreparation
	| ValidImagePreparation;

type ImageDimensions = {
	width: number;
	height: number;
};

type DecodedImage = {
	element: HTMLImageElement;
	dimensions: ImageDimensions;
	objectUrl: string;
};

function extensionForMime(mimeType: string): string | null {
	return MIME_TO_EXTENSION[mimeType as keyof typeof MIME_TO_EXTENSION] ?? null;
}

function fileForInput(input: Blob, extension: string | null): File {
	if (typeof File !== "undefined" && input instanceof File) {
		return input;
	}

	const safeExtension = extension ?? "bin";
	return new File([input], `pasted-image.${safeExtension}`, {
		type: input.type,
	});
}

function invalid(file: File, error: string): InvalidImagePreparation {
	return { kind: "invalid", file, original: file, error };
}

function readImageDimensions(file: File): Promise<DecodedImage> {
	return new Promise((resolve, reject) => {
		const image = document.createElement("img");
		const objectUrl = URL.createObjectURL(file);
		let settled = false;

		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			callback();
		};

		image.onload = () => {
			const width = image.naturalWidth || image.width;
			const height = image.naturalHeight || image.height;
			if (width > 0 && height > 0) {
				finish(() =>
					resolve({
						element: image,
						dimensions: { width, height },
						objectUrl,
					}),
				);
				return;
			}
			finish(() => reject(new Error("missing image dimensions")));
		};
		image.onerror = () => finish(() => reject(new Error("image decode failed")));
		image.src = objectUrl;

		if (typeof image.decode === "function") {
			void image.decode().then(
				() => image.onload?.(new Event("load")),
				() => image.onerror?.(new Event("error")),
			);
		}
	});
}

function fallbackPair(file: File): PreparedImagePair {
	return { thumbnail: file, original: file };
}

async function createThumbnail(
	file: File,
	decodedImage: DecodedImage,
): Promise<PreparedImagePair> {
	const releaseObjectUrl = () => URL.revokeObjectURL(decodedImage.objectUrl);
	try {
		const { dimensions, element: image } = decodedImage;
		const canvas = document.createElement("canvas");
		const scale = Math.min(
			1,
			MAX_THUMBNAIL_DIMENSION / dimensions.width,
			MAX_THUMBNAIL_DIMENSION / dimensions.height,
		);
		const width = Math.max(1, Math.round(dimensions.width * scale));
		const height = Math.max(1, Math.round(dimensions.height * scale));
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d");
		if (!context) {
			releaseObjectUrl();
			return fallbackPair(file);
		}

		context.drawImage(image, 0, 0, width, height);
		const thumbnailBlob = await new Promise<Blob | null>((resolve) => {
			try {
				canvas.toBlob(resolve, file.type, 0.85);
			} catch {
				resolve(null);
			}
		});
		releaseObjectUrl();
		if (!thumbnailBlob) return fallbackPair(file);

		const extension = extensionForMime(file.type) ?? "bin";
		const thumbnail = new File(
			[thumbnailBlob],
			`${file.name.replace(/\.[^/.]+$/, "") || "image"}-thumbnail.${extension}`,
			{ type: file.type },
		);
		return { thumbnail, original: file };
	} catch {
		releaseObjectUrl();
		return fallbackPair(file);
	}
}

export async function prepareImageAttachment(
	input: Blob,
): Promise<ImagePreparationResult> {
	const extension = extensionForMime(input.type);
	const file = fileForInput(input, extension);
	if (!extension) return invalid(file, IMAGE_VALIDATION_MESSAGES.unsupported);
	if (file.size > MAX_ATTACHMENT_BYTES) {
		return invalid(file, IMAGE_VALIDATION_MESSAGES.tooLarge);
	}

	let decodedImage: DecodedImage;
	try {
		decodedImage = await readImageDimensions(file);
	} catch {
		return invalid(file, IMAGE_VALIDATION_MESSAGES.unreadableDimensions);
	}
	if (
		decodedImage.dimensions.width > MAX_IMAGE_DIMENSION ||
		decodedImage.dimensions.height > MAX_IMAGE_DIMENSION
	) {
		URL.revokeObjectURL(decodedImage.objectUrl);
		return invalid(file, IMAGE_VALIDATION_MESSAGES.tooLargeDimensions);
	}

	const prepared = await createThumbnail(file, decodedImage);
	return {
		kind: "valid",
		file,
		original: prepared.original,
		thumbnail: prepared.thumbnail,
		prepared,
	};
}

export const prepareImageForUpload = prepareImageAttachment;
