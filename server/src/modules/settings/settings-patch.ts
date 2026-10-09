import { type ParseResult, parseWith } from "../../validators/http.js";
import { requiredVersion } from "../../validators/schemas.js";
import { boardNameField, logoPathField } from "./settings-schemas.js";
import { validateSettingKey } from "./settings-validation.js";

export type SettingUpdate = { key: string; textValue: string };
export type PatchInput = { updates: SettingUpdate[]; clientVersion: number };

type Loose = Record<string, unknown> | null | undefined;

/** Message-only failure with the shared 400 body shape. */
function fail<T>(message: string): ParseResult<T> {
	return { ok: false, body: { error: message } };
}

function invalidKey<T>(item: Loose): ParseResult<T> {
	return fail(`Invalid setting key: ${item?.key ?? ""}`);
}

/** board_name / logo_path value rules shared by the array and `updates[]` forms. */
function parseKeyedValue(
	key: "board_name" | "logo_path",
	value: unknown,
): ParseResult<SettingUpdate> {
	const parsed =
		key === "board_name"
			? parseWith(boardNameField("board_name value must be a string"), value)
			: parseWith(
					logoPathField(
						"logo_path value must be a string",
						"logo_path cannot be empty",
					),
					value,
				);
	if (!parsed.ok) return parsed;
	return { ok: true, data: { key, textValue: parsed.data } };
}

function parseArrayBody(items: unknown[]): ParseResult<PatchInput> {
	const updates: SettingUpdate[] = [];
	let clientVersion: unknown;
	for (const raw of items) {
		const item = raw as Loose;
		// Last numeric per-item version wins; a non-numeric one is ignored here and
		// only the final version check can reject the request.
		if (typeof item?.version === "number") clientVersion = item.version;
		if (!item?.key || !validateSettingKey(item.key as string)) {
			return invalidKey(item);
		}
		const parsed = parseKeyedValue(
			item.key as "board_name" | "logo_path",
			item.textValue,
		);
		if (!parsed.ok) return parsed;
		updates.push(parsed.data);
	}
	return finish(updates, clientVersion);
}

function parseObjectBody(
	body: Record<string, unknown>,
): ParseResult<PatchInput> {
	const updates: SettingUpdate[] = [];

	if (body.boardName !== undefined) {
		const parsed = parseWith(
			boardNameField("boardName must be a string"),
			body.boardName,
		);
		if (!parsed.ok) return parsed;
		updates.push({ key: "board_name", textValue: parsed.data });
	}
	if (body.logoPath !== undefined) {
		const parsed = parseWith(
			logoPathField("logoPath must be a string", "logoPath cannot be empty"),
			body.logoPath,
		);
		if (!parsed.ok) return parsed;
		updates.push({ key: "logo_path", textValue: parsed.data });
	}

	// Explicit updates array form; entries already set above win.
	if (Array.isArray(body.updates)) {
		for (const raw of body.updates) {
			const item = raw as Loose;
			if (
				!item ||
				typeof item.key !== "string" ||
				!validateSettingKey(item.key)
			) {
				return invalidKey(item);
			}
			const parsed = parseKeyedValue(
				item.key as "board_name" | "logo_path",
				item.value,
			);
			if (!parsed.ok) return parsed;
			if (!updates.some((u) => u.key === parsed.data.key)) {
				updates.push(parsed.data);
			}
		}
	}
	return finish(updates, body.version);
}

function finish(
	updates: SettingUpdate[],
	version: unknown,
): ParseResult<PatchInput> {
	const parsed = parseWith(requiredVersion, version);
	if (!parsed.ok) return parsed;
	return { ok: true, data: { updates, clientVersion: parsed.data } };
}

/**
 * Parses a PATCH body (array form or object form) into updates plus the
 * client's version. Checks run in the original order so the first failing
 * check and its message are unchanged; the version check is always last.
 */
export function parseSettingsPatch(body: unknown): ParseResult<PatchInput> {
	if (Array.isArray(body)) return parseArrayBody(body);
	const object =
		body !== null && typeof body === "object"
			? (body as Record<string, unknown>)
			: {};
	return parseObjectBody(object);
}
