import {
	COLUMN_STYLES,
	type ColumnColor,
} from "./columnColors";
import { deriveBackgroundColor, isStoredOklchColor } from "./columnColorUtils";

export type ColumnAppearance =
	| { kind: "wip"; className: string }
	| { kind: "default"; className: string }
	| { kind: "legacy"; className: string }
	| {
			kind: "inline";
			style: { borderColor: string; backgroundColor: string };
	  };

const WIP_CLASSES = "border-error-300 bg-error-100/40";
const DEFAULT_CLASSES = "border-neutral-200 bg-neutral-100";

function isLegacyColumnColor(color: string): color is ColumnColor {
	return color in COLUMN_STYLES;
}

export function resolveColumnAppearance(
	color: string | null,
	isWipOver: boolean,
): ColumnAppearance {
	if (isWipOver) {
		return { kind: "wip", className: WIP_CLASSES };
	}

	if (!color) {
		return { kind: "default", className: DEFAULT_CLASSES };
	}

	if (isLegacyColumnColor(color)) {
		return { kind: "legacy", className: COLUMN_STYLES[color] };
	}

	if (isStoredOklchColor(color)) {
		return {
			kind: "inline",
			style: {
				borderColor: color,
				backgroundColor: deriveBackgroundColor(color),
			},
		};
	}

	return { kind: "default", className: DEFAULT_CLASSES };
}
