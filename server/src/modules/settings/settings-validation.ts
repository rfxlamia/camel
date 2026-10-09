export const VALID_SETTING_KEYS = new Set(["board_name", "logo_path"]);

export function validateBoardName(
	name: string,
): { valid: false; error: string } | { valid: true; trimmed: string } {
	const trimmed = name.trim();
	if (trimmed === "") return { valid: false, error: "Name is required" };
	if (trimmed.length > 15) return { valid: false, error: "Max 15 characters" };
	return { valid: true, trimmed };
}

export function validateSettingKey(key: string): boolean {
	return VALID_SETTING_KEYS.has(key);
}

export const MAX_LOGO_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg"]);

export function validateLogoFile(mimetype: string): {
	valid: boolean;
	error?: string;
} {
	if (!ALLOWED_MIME_TYPES.has(mimetype)) {
		return { valid: false, error: "Only .png and .jpg files are accepted" };
	}
	return { valid: true };
}

export function validateFileSize(size: number): {
	valid: boolean;
	error?: string;
} {
	if (size > MAX_LOGO_SIZE_BYTES) {
		return { valid: false, error: "File size must be under 10MB" };
	}
	return { valid: true };
}

export function generateLogoFilename(mimetype: string): string {
	const ext = mimetype === "image/jpeg" ? "jpg" : "png";
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 8);
	return `logo-${timestamp}-${random}.${ext}`;
}
