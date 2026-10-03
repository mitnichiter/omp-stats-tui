import type { SymbolPreset, SymbolKey, Theme } from "@oh-my-pi/pi-tui";

/**
 * Roles for section headings and inline status marks. This is the SECOND preset
 * table, deliberately separate from `glyphs.ts` because the two obey opposite
 * width rules: data ink must measure exactly 1 cell, while an icon is permitted
 * to be an emoji at 2 cells as long as the heading reserves `ICON_GUTTER` for
 * it. Conflating them is how an emoji ends up in a bar column.
 */
export type IconRole =
	| "cost"
	| "tokens"
	| "requests"
	| "time"
	| "models"
	| "providers"
	| "tools"
	| "projects"
	| "errors"
	| "calendar"
	| "gains"
	| "trendUp"
	| "trendDown"
	| "unknown"
	| "cache"
	| "warning";

/**
 * The 12 of 16 roles omp already registers in SYMBOL_PRESETS. Reading these
 * through `theme.symbol()` is what makes a future upstream change propagate to
 * the panel for free; defining them locally would freeze our values and quietly
 * diverge from the rest of the UI.
 */
export const HOST_ICON_KEYS = {
	cost: "icon.cost",
	tokens: "icon.tokens",
	requests: "cmd.stats",
	time: "icon.time",
	models: "icon.model",
	providers: "icon.host",
	tools: "icon.extensionTool",
	projects: "icon.folder",
	errors: "status.error",
	unknown: "cmd.question",
	cache: "icon.cache",
	warning: "icon.warning",
} as const satisfies Partial<Record<IconRole, SymbolKey>>;

/**
 * The only four roles this project adds. Kept as an explicit list so a test can
 * assert that each is genuinely unregistered by the host — if omp ever ships one
 * of these keys, that test fails and the role should move into HOST_ICON_KEYS.
 */
export const NEW_ICON_ROLES = [
	"calendar",
	"gains",
	"trendUp",
	"trendDown",
] as const satisfies readonly IconRole[];

/**
 * Per-preset values for every role, including the reused ones. `statsIcon`
 * prefers the host registry and falls back to this table, so a role keeps a
 * usable value even when no theme has been bound yet — which is the only way to
 * stay safe in the extension loader, where the theme singleton is undefined.
 */
export const STATS_ICONS: Record<SymbolPreset, Record<IconRole, string>> = {
	unicode: {
		cost: "💲",
		tokens: "🪙",
		requests: "📊",
		time: "⏱",
		models: "⬢",
		providers: "🛰",
		tools: "🛠",
		projects: "📁",
		errors: "❌",
		calendar: "📅",
		gains: "💹",
		trendUp: "↗",
		trendDown: "↘",
		unknown: "❓",
		cache: "💾",
		// Bare U+26A0. The VS16 form (⚠️) measures 2 cells and would break a
		// heading gutter; the host's own icon.warning is the bare form too.
		warning: "⚠",
	},
	nerd: {
		cost: "", // nf-fa-dollar U+F155 (cheat sheet)
		tokens: "", // nf-fae-coins U+E26B (cheat sheet) — not "material hex"
		requests: "", // nf-fa-line_chart U+F201 (cheat sheet)
		time: "", // nf-fa-clock_o U+F017 (cheat sheet)
		models: "", // nf-cod-chip U+EC19 (cheat sheet)
		providers: "\u{F048B}", // nf-md-server (cheat sheet)
		tools: "", // nf-fa-wrench U+F0AD (cheat sheet)
		projects: "", // nf-fa-folder_open U+F07C (cheat sheet)
		errors: "", // nf-fa-times_circle U+F057 (cheat sheet)
		calendar: "", // nf-fa-calendar U+F073 (cheat sheet)
		gains: "\u{F0535}", // nf-md-trending_up (cheat sheet)
		trendUp: "", // nf-fa-arrow_up U+F062 (cheat sheet)
		trendDown: "", // nf-fa-arrow_down U+F063 (cheat sheet)
		unknown: "", // nf-fa-circle_question U+F059 (cheat sheet)
		cache: "", // nf-fa-database U+F1C0 (cheat sheet)
		// nf-fa-warning U+F071 — never the VS16 form.
		warning: "",
	},
	ascii: {
		cost: "$",
		tokens: "tok:",
		requests: "req:",
		time: "t:",
		models: "[M]",
		providers: "host",
		tools: "TL",
		projects: "[D]",
		errors: "[!!]",
		calendar: "cal",
		gains: "+",
		trendUp: "+",
		trendDown: "-",
		unknown: "?",
		cache: "cache",
		warning: "[!]",
	},
};

/**
 * Heading gutter width per preset. Emoji are 2 cells, Nerd PUA is 1, and ASCII
 * labels are variable — the heading layout pads to this so every section title
 * starts in the same column regardless of which icon it drew.
 */
export const ICON_GUTTER: Record<SymbolPreset, number> = {
	unicode: 2,
	nerd: 1,
	ascii: 5,
};

/**
 * Resolve one icon. `theme` is optional and supplied only by the panel, which
 * holds the live singleton; calling without it reads the pure table, which keeps
 * this module load-order-safe and unit-testable.
 */
export function statsIcon(preset: SymbolPreset, role: IconRole, theme?: Theme): string {
	const key = HOST_ICON_KEYS[role as keyof typeof HOST_ICON_KEYS];
	if (key && theme) return theme.symbol(key);
	return STATS_ICONS[preset][role];
}