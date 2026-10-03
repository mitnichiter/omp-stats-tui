/**
 * The tab strip: the `Tab[]` the panel hands to `TabBar`, the one-cell `short`
 * table that keeps it on ONE row, and a `TabBarTheme` closed over OUR injected
 * `Theme` rather than the host singleton.
 *
 * WHY `short` IS A SEPARATE TABLE
 *
 * `TabBar` renders full labels and, only if they overflow, collapses the tabs
 * FURTHEST FROM THE ACTIVE ONE to `short`, then wraps (`tab-bar.ts:271-286`).
 * So `short` is not decoration — it is the budget that decides whether the strip
 * costs the body one row. Our `ScreenSpec.short` values are 6-8 cell words, and
 * `statsIcon` cannot stand in: the ascii arm of `STATS_ICONS` is VARIABLE
 * (`"tok:"` = 4 cells, `"[!!]"` = 4, `"cache"` = 5, `src/tui/icons.ts:106-124`),
 * and 12 tabs of 5 cells plus padding plus gutters is 108 columns. Hence
 * {@link TAB_SHORT}, which is one cell on all three presets and is asserted to
 * be by measurement in `test/tabs.test.ts`.
 *
 * WHY THE UNICODE ARM IS NOT `STATS_ICONS`
 *
 * Two cells is the rule for an ICON (`icons.ts:5-9`: an emoji is fine where the
 * heading reserves `ICON_GUTTER`). A tab cell has no gutter. Every emoji in the
 * unicode arm measures 2, so the strip would need 58 + 9 columns; one cell is
 * the only form that fits 80. Where a 1-cell form already exists in
 * `STATS_ICONS.unicode` (`trendUp`, `models`, `warning`) it is reused verbatim;
 * the rest are the geometric symbols that read as overview / calendar /
 * folder / chart / tools / host, and are asserted 1 cell by test rather than by
 * eye.
 *
 * WHY THE ACTIVE TAB IS A LUMINANCE STEP
 *
 * `selectedBg` + bold against `muted` foreground is a CONTRAST change
 * (`chrome/shared.ts:18-27`). A hue step between `accent` and `warning` is
 * not: they are close in some themes and in colour-blind modes.
 */

import type { SymbolPreset, Tab, TabBarTheme, Theme } from "@oh-my-pi/pi-tui";
import { SCREEN_SPECS, type ScreenSpec } from "../layout/spec";
import { STATS_ICONS, statsIcon, type IconRole } from "./icons";

export type ScreenId = ScreenSpec["id"];

/**
 * The icon each screen carries. `overview` takes `trendUp` rather than `cost`
 * so it does not collide with the `costs` row; only one is ever active, and the
 * labels disambiguate regardless. Exported because chrome.ts reuses this exact
 * mapping for the sidebar rows — one icon table, not two.
 */
export const TAB_ICON: Record<ScreenId, IconRole> = {
	overview: "trendUp",
	activity: "calendar",
	models: "models",
	costs: "cost",
	projects: "projects",
	requests: "requests",
	errors: "errors",
	tools: "tools",
	providers: "providers",
};

/**
 * One cell per preset, ALWAYS. Twelve tabs of one-cell glyphs plus padding and
 * gutters fit 58 columns; anything wider wraps the strip to two rows.
 *
 * The nerd arm is the PUA form `STATS_ICONS.nerd` already registers for the same
 * role, so a font that has the icon renders the same glyph as the heading.
 */
export const TAB_SHORT: Record<SymbolPreset, Record<ScreenId, string>> = {
	unicode: {
		overview: STATS_ICONS.unicode.trendUp,
		activity: "◫",
		models: STATS_ICONS.unicode.models,
		costs: "$",
		projects: "▣",
		requests: "≡",
		errors: STATS_ICONS.unicode.warning,
		tools: "⚒",
		providers: "◈",
	},
	nerd: {
		overview: STATS_ICONS.nerd.trendUp,
		activity: STATS_ICONS.nerd.calendar,
		models: STATS_ICONS.nerd.models,
		costs: STATS_ICONS.nerd.cost,
		projects: STATS_ICONS.nerd.projects,
		requests: STATS_ICONS.nerd.requests,
		errors: STATS_ICONS.nerd.errors,
		tools: STATS_ICONS.nerd.tools,
		providers: STATS_ICONS.nerd.providers,
	},
	ascii: {
		overview: "*",
		activity: "#",
		models: "M",
		costs: "$",
		projects: "D",
		requests: "R",
		errors: "!",
		tools: "T",
		providers: "H",
	},
};

/**
 * The `TabBarTheme` adapter. Token-for-token identical to the host's
 * `getTabBarTheme()` (`chrome/shared.ts:18-27`), but closed over the `Theme`
 * the mount hands us — that function hardcodes the `theme` singleton, which
 * would ignore ours entirely.
 *
 * `hoverTab` is unreachable while `mouseTracking` is false; it is supplied
 * anyway so enabling the mouse later is a one-line change, not a re-derivation.
 */
export function tabBarTheme(theme: Theme): TabBarTheme {
	return {
		label: (text: string) => theme.bold(theme.fg("accent", text)), // chrome/shared.ts:20
		activeTab: (text: string) => theme.bold(theme.bg("selectedBg", theme.fg("text", text))), // :21
		inactiveTab: (text: string) => theme.fg("muted", text), // :22
		mutedTab: (text: string) => theme.fg("dim", text), // :23
		hoverTab: (text: string) => theme.bg("selectedBg", theme.fg("text", text)), // :24
		hint: (text: string) => theme.fg("dim", text), // :25
	};
}

/**
 * The strip, built from the IR's `SCREEN_SPECS` filtered by `!deferred` — one
 * source of truth shared with the screen registry and the fetch needs.
 *
 * `label` is `icon + space + label`, matching `/settings`
 * (`settings-selector.ts:546-553`); `short` is {@link TAB_SHORT}.
 */
export function buildTabs(preset: SymbolPreset, theme: Theme, activeId: ScreenId): Tab[] {
	if (!SCREEN_SPECS.some(spec => spec.id === activeId)) {
		throw new Error(`unknown screen id: ${activeId}`);
	}
	return SCREEN_SPECS.filter(spec => !spec.deferred).map(spec => ({
		id: spec.id,
		label: `${statsIcon(preset, TAB_ICON[spec.id], theme)} ${spec.label}`,
		short: TAB_SHORT[preset][spec.id],
		muted: false,
	}));
}

/**
 * The one-column inset every `row()` puts inside its `│ … │` chrome
 * (`chrome/overlay-box.ts:46-49`), which is what `/settings` renders its tab
 * strip through (`settings-selector.ts:761-763`). Read from the reference
 * rather than guessed: the tab row must not collide with the panel border.
 */
export const TAB_BAR_INDENT = 1;