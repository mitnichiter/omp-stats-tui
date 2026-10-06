/**
 * `src/tui/showcase/nav.ts` — the showcase's OWN nav: a fork, declared as such.
 *
 * WHY THIS FILE EXISTS AT ALL, stated once so nobody has to rediscover it:
 * `chrome.ts`'s `sidebar()` and `tabs.ts`'s `buildTabs()` are both closed over the
 * REAL screen registry — `NAV_GROUPS` is built from a private `GROUPS` map
 * resolved against `SCREEN_SPECS`, and `TAB_ICON` is typed
 * `Record<ScreenId, IconRole>`, so a section id that is not a real screen id does
 * not type-check. `/stats-test` has its own sections (`tiles`, `charts`, `tables`,
 * `awkward`, `states`, `empty`), so it can call neither.
 *
 * THE GAP, precisely, so it can be closed once instead of twice:
 * `sidebar(theme, preset, groups: readonly NavGroup[], activeId, hoveredId?)`.
 * Every measurement inside it — the icon column, the label column, the jump-key
 * column and the total width — is derived from the nav it is handed, so
 * parameterising it is mechanical. It is not done here because `chrome.ts` and
 * `tabs.ts` belong to another session that is mid-change on them, and a fork
 * written beside a live refactor is how two nav grammars end up shipped.
 *
 * WHAT IS NOT FORKED — the part that matters. The INK LADDER is not re-invented
 * here: every heading, row, icon and jump hint wears a named level from
 * `SIDEBAR_INK` in palette.ts, and the tab strip borrows `tabs.ts`'s own
 * `TabBarTheme` adapter wholesale. Those levels carry a `styles.css` citation
 * each and are machine-checked by `test/palette.test.ts`. A showcase nav that
 * picked its own tokens would be the flat-heading defect again, one file over.
 *
 * The GEOMETRY is copied rather than imported, and is the part that would drift if
 * the source changes. Each constant below names its source so a retune in
 * chrome.ts has a counterpart to move.
 */

import type { SymbolPreset, Tab, TabBarTheme, Theme } from "@oh-my-pi/pi-tui";
import { visibleWidth } from "@oh-my-pi/pi-tui";

import { JUMP_KEY_PREFIX, PREFIX_WIDTH, SIDEBAR_GAP } from "../chrome";
import { statsIcon, type IconRole } from "../icons";
import { SIDEBAR_INK } from "../palette";
import { tabBarTheme } from "../tabs";
import { SHOWCASE_SECTIONS } from "./spec";

// Re-exported so `panel.ts` (and its consumers) have one showcase entry point:
// the nav and the sections are one module from a caller’s point of view.
export { SHOWCASE_SECTIONS };

// ─── Geometry, copied from chrome.ts's `sidebar` with its reasons ────────────

/**
 * The host's 2-column prefix slot: cursor + space on the active row, two spaces
 * otherwise (`settings-list.ts:939-940`). `chrome.ts` calls it `PREFIX_WIDTH`;
 * it is imported rather than restated, so a retune flows through.
 */
const CURSOR_WIDTH = PREFIX_WIDTH;
/** One cell between the icon and the label, so an icon never touches its label. */
const ICON_GAP = 1;
/** `G <letter>` is a closed shape, so its width is a constant of the format. */
const JUMP_KEY_WIDTH = visibleWidth(JUMP_KEY_PREFIX) + 1;

// ─── The nav ─────────────────────────────────────────────────────────────────

/** One row in a group. */
export interface ShowcaseNavItem {
	readonly id: string;
	readonly label: string;
	/** Second key of the `g <key>` jump. */
	readonly hotkey: string;
	readonly icon: IconRole;
}

/** One group of rows, under one heading. */
export interface ShowcaseNavGroup {
	readonly heading: string;
	readonly items: readonly ShowcaseNavItem[];
}

/**
 * THE ICON PER SECTION. Reusing the real screen icons where one exists keeps the
 * two navs visually related — a reader who knows the panel's sidebar reads the
 * showcase's without a key. The sections with no real counterpart take the nearest
 * geometric role rather than a new glyph.
 */
const ICONS: Readonly<Record<string, IconRole>> = {
	tiles: "tokens",
	charts: "cost",
	tables: "requests",
	awkward: "warning",
	states: "cache",
	empty: "unknown",
};

/**
 * THE NAV, in three groups, so the sidebar's own grouping is exercised too: a
 * playground that drew one flat list would never show whether the heading ink
 * ladder reads at three groups or at one, nor whether a one-item group looks
 * broken.
 */
export const SHOWCASE_NAV: readonly ShowcaseNavGroup[] = Object.freeze([
	{ heading: "Grammar", items: [navItem("tiles"), navItem("charts"), navItem("tables")] },
	{ heading: "Edges", items: [navItem("awkward"), navItem("states")] },
	{ heading: "Ranges", items: [navItem("empty")] },
]);

function navItem(id: string): ShowcaseNavItem {
	const section = SHOWCASE_SECTIONS.find(candidate => candidate.id === id);
	if (!section) throw new Error(`showcase nav references unknown section "${id}"`);
	return { id: section.id, label: section.label, hotkey: section.hotkey, icon: ICONS[section.id] ?? "unknown" };
}

// ─── The sidebar ─────────────────────────────────────────────────────────────

/** One painted sidebar: its lines and the width they occupy. */
export interface ShowcaseSidebar {
	readonly width: number;
	readonly lines: readonly string[];
}

/**
 * THE FULL GROUPED SIDEBAR, ALIGNED AS A COLUMN — chrome.ts's `sidebar` with the
 * item list injected.
 *
 * `.nav-row` in the web is a flex row whose label carries `flex: 1`, which pushes
 * the jump hint to the row's TRAILING edge so the hints form one right-hand column
 * instead of a staircase hanging off eight different label lengths. That is
 * reproduced by a fixed label column plus a fixed trailing gap, which is why
 * `labelWidth` is measured rather than the label used inline.
 *
 * The active row carries the host's `selectedBg` band and hover splits from
 * active on INK rather than on the band — a terminal has one background token and
 * no alpha to separate them by. That is the whole of `SIDEBAR_INK`'s contract,
 * which is why this file imports those levels instead of naming tokens.
 */
export function showcaseSidebar(
	theme: Theme,
	preset: SymbolPreset,
	activeId: string,
	hoveredId?: string | null,
): ShowcaseSidebar {
	const items = SHOWCASE_NAV.flatMap(group => group.items);
	// Measured, not assumed: the preset's icon width is data ink, and the host
	// registry does not always agree with `STATS_ICONS`.
	const iconWidth = Math.max(...items.map(item => visibleWidth(statsIcon(preset, item.icon, theme))));
	const labelWidth = Math.max(...items.map(item => visibleWidth(item.label)));
	const width = CURSOR_WIDTH + iconWidth + ICON_GAP + labelWidth + SIDEBAR_GAP + JUMP_KEY_WIDTH;

	const activeGroup = SHOWCASE_NAV.find(group => group.items.some(item => item.id === activeId));
	const lines: string[] = [];
	const tail = " ".repeat(SIDEBAR_GAP);
	for (const group of SHOWCASE_NAV) {
		const heading =
			group === activeGroup
				? theme.bold(theme.fg(SIDEBAR_INK.headingActive, group.heading))
				: theme.fg(SIDEBAR_INK.headingInactive, group.heading);
		lines.push(pad(`  ${heading}`, width));
		for (const item of group.items) {
			const icon = pad(statsIcon(preset, item.icon, theme), iconWidth);
			const label = pad(item.label, labelWidth);
			const key = `${JUMP_KEY_PREFIX}${item.hotkey.toUpperCase()}`;
			if (item.id === activeId) {
				// The cursor slot IS the 2-column prefix, so the active row spends no
				// more prefix than any other row. The jump hint stays INSIDE the band
				// because `.nav-row kbd` is a child of the row (styles.css:565-570).
				lines.push(
					theme.bg(
						"selectedBg",
						`${theme.fg(SIDEBAR_INK.rowActive, `${theme.nav.cursor} `)}${theme.bold(
							theme.fg(SIDEBAR_INK.iconActive, `${icon} ${label}`),
						)}${theme.fg(SIDEBAR_INK.jumpKey, tail + key)}`,
					),
				);
				continue;
			}
			if (item.id === hoveredId) {
				// Hover brightens rather than fills: it must never impersonate the
				// keyboard cursor, and it must never move the cursor.
				lines.push(
					`  ${theme.fg(SIDEBAR_INK.iconActive, icon)} ${theme.fg(SIDEBAR_INK.rowHover, label)}` +
						theme.fg(SIDEBAR_INK.jumpKey, tail + key),
				);
				continue;
			}
			lines.push(
				`  ${theme.fg(SIDEBAR_INK.iconInactive, icon)} ${theme.fg(SIDEBAR_INK.rowInactive, label)}` +
					theme.fg(SIDEBAR_INK.jumpKey, tail + key),
			);
		}
	}
	return { width, lines };
}

/** Pad `text` to `width` terminal cells. Width is measured, never assumed. */
function pad(text: string, width: number): string {
	const gap = width - visibleWidth(text);
	return gap > 0 ? text + " ".repeat(gap) : text;
}

// ─── Hit testing ─────────────────────────────────────────────────────────────

/**
 * Which section a sidebar body-row means, or null for a heading and for padding.
 *
 * Derived by walking `SHOWCASE_NAV` exactly the way `showcaseSidebar` paints it —
 * one heading row per group, then one row per item — so a regrouped nav moves its
 * own rows and the two can never disagree. The real panel's `sidebarHit` does this
 * over `NAV_GROUPS`; this is the same walk over the showcase's list, and it is part
 * of the fork rather than a new idea.
 */
export function showcaseSidebarHit(navRow: number): string | null {
	if (!Number.isInteger(navRow) || navRow < 0) return null;
	let row = 0;
	for (const group of SHOWCASE_NAV) {
		if (navRow === row) return null;
		row++;
		for (const item of group.items) {
			if (navRow === row) return item.id;
			row++;
		}
	}
	return null;
}

// ─── The tab strip ───────────────────────────────────────────────────────────

/**
 * The `TabBarTheme` adapter, reused verbatim from `tabs.ts` rather than rebuilt.
 *
 * It is a host-shaped six-callback object closed over the injected `Theme` rather
 * than the singleton, and every one of its inks already carries a `styles.css`
 * citation. A showcase strip with its own adapter would be a second ink ladder,
 * which is exactly the drift `TAB_INK` was extracted to prevent — so the adapter
 * is the real one and only the TAB LIST is ours.
 */
export function showcaseTabBarTheme(theme: Theme): TabBarTheme {
	return tabBarTheme(theme);
}

/**
 * The strip's tabs, from the showcase's sections rather than `SCREEN_SPECS`.
 *
 * `activeId` is read from the theme's own preset so the `short` form is the one
 * that preset can actually draw — the rule `TAB_SHORT` obeys, because a strip that
 * wraps costs the body a row.
 */
export function buildShowcaseTabs(theme: Theme): Tab[] {
	const preset = theme.getSymbolPreset();
	return SHOWCASE_SECTIONS.map(section => ({
		id: section.id,
		label: section.label,
		short: section.short[preset],
	}));
}