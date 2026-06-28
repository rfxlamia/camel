// Column color palette names (must match server validation)
export const COLUMN_COLORS = [
	"powder-blue",
	"pale-sky",
	"light-cyan",
	"frozen-water",
	"turquoise",
] as const;

export type ColumnColor = (typeof COLUMN_COLORS)[number];

// Preview colors for the picker (shade 200 for visibility)
export const COLOR_PREVIEWS: Record<ColumnColor, string> = {
	"powder-blue": "var(--color-powder-blue-200)",
	"pale-sky": "var(--color-pale-sky-200)",
	"light-cyan": "var(--color-light-cyan-200)",
	"frozen-water": "var(--color-frozen-water-200)",
	turquoise: "var(--color-turquoise-200)",
};

// Human-readable labels
export const COLOR_LABELS: Record<ColumnColor, string> = {
	"powder-blue": "Powder Blue",
	"pale-sky": "Pale Sky",
	"light-cyan": "Light Cyan",
	"frozen-water": "Frozen Water",
	turquoise: "Turquoise",
};

// Static Tailwind class lookup for column colors
// Using static strings ensures Tailwind's JIT compiler can detect and include these classes
export const COLUMN_STYLES: Record<ColumnColor, string> = {
	"powder-blue":
		"border-[var(--color-powder-blue-200)] bg-[var(--color-powder-blue-50)]",
	"pale-sky":
		"border-[var(--color-pale-sky-200)] bg-[var(--color-pale-sky-50)]",
	"light-cyan":
		"border-[var(--color-light-cyan-200)] bg-[var(--color-light-cyan-50)]",
	"frozen-water":
		"border-[var(--color-frozen-water-200)] bg-[var(--color-frozen-water-50)]",
	turquoise:
		"border-[var(--color-turquoise-200)] bg-[var(--color-turquoise-50)]",
};
