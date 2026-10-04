/**
 * Web-shell chrome port: sidebar nav, topbar, live chip, progress line.
 *
 * Source of truth is the omp-stats web Shell (read-only host files, never
 * modified): `app/Shell.tsx` (topbar + sidebar + progress three-state),
 * `app/nav.ts` (NAV groups, hotkeys), `app/LiveChip.tsx` (chip branch order),
 * `client/data/range.ts` (TIME_RANGES order). Deviations from the web are
 * marked OURS with reasoning; everything else cites the web line it mirrors.
 *
 * KEYMAP DECISION (stated once, see also test/chrome.test.ts header):
 * digits (`1`-`9`/`0`) and `g`-letters are ALIASES for the same target
 * (screen). The web's digits-as-range half is deliberately NOT mirrored:
 * our digits already select screens and a digit cannot pick both a range and
 * a screen. Range stays on `r`/`R` cycle. While the `g` prefix is armed the
 * next letter is consumed even on no match (web parity); a stale prefix
 * (>1200 ms) falls through (web parity: timestamp check, no timer).
 *
 * MODES come from `framePolicy` (responsive.ts), never a local width table:
 * wide shows the full grouped sidebar + full topbar, medium/narrow show the
 * icon rail + condensed topbar (chip dropped, mirroring `topbar-hide-narrow`),
 * tiny hides the sidebar and keeps brand + active range. The panel additionally
 * degrades full → rail → hidden on SHORT terminals so the frame never exceeds
 * the terminal height; that call lives in panel.ts, not here.
 *
 * PURE. Theme and preset arrive as arguments; the module holds no singleton
 * (the `theme` binding is undefined until init) and reads no terminal or data.
 */

import { rangeMeta } from "@oh-my-pi/omp-stats/client/data/range";
import type { Theme } from "@oh-my-pi/pi-tui/theme";
import { truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui/utils";
import { RANGES, type Range } from "../data/ranges";
import { SCREEN_SPECS, type ScreenSpec } from "../layout/spec";
import { describeSyncProgress, type SyncEvent } from "../sync/client";
import { formatInteger } from "./format";
import type { SymbolPreset } from "./glyphs";
import { statsIcon } from "./icons";
import { HORIZONTAL_INSET } from "./layout";
import { framePolicy } from "./responsive";
import { TAB_ICON, TAB_SHORT, tabBarTheme } from "./tabs";

/** The web's `pendingG` window (Shell.tsx: `Date.now() - pendingG < 1200`). */
export const JUMP_TIMEOUT_MS = 1200;

/** Dirty hours above which the web calls the backlog worth showing (LiveChip.tsx: `INDEXING_VISIBLE_HOURS = 24`). */
const INDEXING_VISIBLE_HOURS = 24;

export interface NavItem {
	id: ScreenSpec["id"];
	label: string;
	/** Second key of the `g <key>` jump (nav.ts: `hotkey`). */
	hotkey: string;
}

export interface NavGroup {
	heading: string;
	items: readonly NavItem[];
}

/**
 * Second keys of the `g <key>` jumps. The web's verbatim (nav.ts) except
 * `activity`, which has no web section (OURS: the free initial `a`).
 * Undrawable screens have NO entry: `providers` is deferred (network I/O),
 * `gain`/`traces`/`frustration` have no spec or are excluded — a jump that
 * paints a page the panel cannot honestly fill wastes the keystroke.
 */
const HOTKEYS: Record<string, string> = {
	overview: "o",
	models: "m",
	costs: "c",
	activity: "a",
	requests: "r",
	errors: "e",
	tools: "l",
	projects: "j",
};

/**
 * Sidebar structure; the order here is the order on screen (nav.ts: `the
 * order here is the order on screen`). Usage keeps the web's order minus
 * deferred `providers`; Activity leads with the OURS `activity` summary, then
 * the web's `requests`, `errors` (excluded `traces` has no row); Insights
 * keeps `tools`, `projects` (excluded `frustration`, spec-less `gain` persisting
 * only as a scaffold have no row).
 */
const GROUPS: Record<string, readonly string[]> = {
	Usage: ["overview", "models", "costs"],
	Activity: ["activity", "requests", "errors"],
	Insights: ["tools", "projects"],
};

/**
 * The nav, with labels resolved from the layout IR so the sidebar cannot drift
 * from the tab strip: both read the same `SCREEN_SPECS`.
 */
export const NAV_GROUPS: readonly NavGroup[] = Object.entries(GROUPS).map(([heading, ids]) => ({
	heading,
	items: ids.flatMap(id => {
		const spec = SCREEN_SPECS.find(candidate => candidate.id === id);
		const hotkey = HOTKEYS[id] ?? "";
		return spec && hotkey !== "" ? [{ id: spec.id, label: spec.label, hotkey }] : [];
	}),
}));

/**
 * Resolve one jump letter to its screen, case-insensitively like the web's
 * `e.key.toLowerCase()` lookup. Null for digits, for undrawable screens, and
 * for anything that is not a single letter.
 */
export function screenForHotkey(key: string): ScreenSpec["id"] | null {
	if (key.length !== 1) return null;
	const lower = key.toLowerCase();
	for (const group of NAV_GROUPS) {
		for (const item of group.items) {
			if (item.hotkey === lower) return item.id;
		}
	}
	return null;
}

/** The web's `ago` (LiveChip.tsx): relative sync age for the settled chip. */
export function ago(now: number, lastSyncedAt: number | null): string {
	if (lastSyncedAt === null) return "";
	const s = Math.max(0, Math.round((now - lastSyncedAt) / 1000));
	if (s < 45) return "just now";
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** Everything the live chip reads. The panel derives this from its sync state; see panel.ts render. */
export interface ChromeSync {
	syncing: boolean;
	current: number;
	total: number;
	/** True only for ingest progress with a known total — scan/rollup are indeterminate by phase. */
	determinate: boolean;
	error: string | null;
	dirtyHours: number;
	lastSyncedAt: number | null;
	now: number;
}

/**
 * The topbar ingest status. Branch order mirrors LiveChip.tsx exactly —
 * syncing, then error, then backlog, then Live — with two deliberate OURS
 * deviations: no `Reconnecting` state (the TUI has no SSE; a dead child
 * surfaces as `error`) and error takes precedence over a concurrently alive
 * child handle (the web's single phase value cannot express both at once).
 * Marks reuse the host `status.*` symbols so the preset, not this module,
 * decides the glyph.
 */
export function chipFor(theme: Theme, sync: ChromeSync): string {
	if (sync.error !== null) {
		return `${theme.fg("error", theme.symbol("status.error"))} Sync failed`;
	}
	if (sync.syncing) {
		const mark = theme.fg("accent", theme.symbol("status.running"));
		if (sync.determinate && sync.total > 0) {
			return `${mark} Syncing ${theme.fg("dim", `${formatInteger(sync.current)}/${formatInteger(sync.total)}`)}`;
		}
		return `${mark} Syncing`;
	}
	if (sync.dirtyHours > INDEXING_VISIBLE_HOURS) {
		const mark = theme.fg("accent", theme.symbol("status.running"));
		return `${mark} Indexing ${theme.fg("dim", `${formatInteger(sync.dirtyHours)}h left`)}`;
	}
	const mark = theme.fg("success", theme.symbol("status.enabled"));
	const age = ago(sync.now, sync.lastSyncedAt);
	return age === "" ? `${mark} Live` : `${mark} Live ${theme.fg("dim", age)}`;
}

/**
 * The thin progress line under the topbar. Shell.tsx three-state: hidden when
 * settled, determinate fill when the total is known, indeterminate otherwise.
 * Only `ingest` carries a denominator, so scan/rollup normalize to total 0
 * (indeterminate) rather than letting a remaining-count masquerade as a
 * fraction. Rendering itself is `describeSyncProgress`, reused, not reinvented.
 */
export function progressLineFor(event: SyncEvent | null, width: number): string {
	if (event === null || event.type !== "progress") return "";
	if (event.phase !== "ingest") return describeSyncProgress({ ...event, current: 0, total: 0 }, width);
	return describeSyncProgress(event, width);
}

export interface Sidebar {
	width: number;
	lines: readonly string[];
}

/**
 * The full grouped sidebar: one heading row per group, one row per screen
 * (`cursor + icon + label + G <letter>`, mirroring the web's icon + label + kbd).
 *
 * Host parity (settings-selector.ts + settings-list.ts:914-996,
 * theme/tui-adapters.ts:336-350): rows carry the host's 2-column prefix slot
 * (`cursor + space` for the active row, two spaces otherwise); the ACTIVE row
 * is accent text under the cursor (the `section` style), never the tab strip's
 * selectedBg pill — the pill belongs to the topbar segment and the strip
 * (chrome/shared.ts:18-27), and a second pill here is a second active style.
 * Group headings are `section` styled by ACTIVE GROUP (accent+bold for the
 * group holding the active screen, muted otherwise); hover paints the host's
 * `hoverTab` band on a non-active row and never moves the cursor
 * (settings-list.ts:778,792-796). Rows are padded to a common width so the
 * hover band fills the column.
 *
 * DIVERGENCE (deliberate, noted): headings track the active group rather than
 * the settings-list dim wash. The host dims off-section ROWS in a split pane
 * where rows stay selectable; our sidebar rows are never dimmed because a dim
 * nav row reads as disabled, and the group cue has to live somewhere — so it
 * lives in the heading.
 */
export function sidebar(theme: Theme, preset: SymbolPreset, activeId: string, hoveredId?: string | null): Sidebar {
	const bar = tabBarTheme(theme);
	const activeGroup = NAV_GROUPS.find(group => group.items.some(item => item.id === activeId));
	const lines: string[] = [];
	for (const group of NAV_GROUPS) {
		const head = group === activeGroup ? theme.bold(theme.fg("accent", group.heading)) : theme.fg("muted", group.heading);
		lines.push(`  ${head}`);
		for (const item of group.items) {
			const text = `${statsIcon(preset, TAB_ICON[item.id], theme)} ${item.label}  G ${item.hotkey.toUpperCase()}`;
			if (item.id === activeId) {
				lines.push(`${theme.fg("accent", `${theme.nav.cursor} `)}${theme.fg("accent", theme.bold(text))}`);
			} else if (item.id === hoveredId) {
				lines.push((bar.hoverTab ?? bar.inactiveTab)(`  ${text}`));
			} else {
				lines.push(theme.fg("muted", `  ${text}`));
			}
		}
	}
	const width = Math.max(...lines.map(line => visibleWidth(line)));
	return { width, lines: lines.map(line => (visibleWidth(line) < width ? line + " ".repeat(width - visibleWidth(line)) : line)) };
}

export interface TopbarOptions {
	range: Range;
	chip: string;
	/** Rollup freshness, already coloured by the panel (it owns EXACT_DIRTY_LIMIT). */
	freshness: string;
	innerWidth: number;
}

/**
 * The topbar row: `omp/stats` brand (the SVG mark has no terminal form; the
 * wordmark carries it) + live chip + range segment + freshness.
 * The segment mirrors the web's `Segmented` (all six TIME_RANGES labels in
 * order, active pill highlighted); interaction stays on `r`/`R` cycling since
 * digits select screens. Full mode keeps everything; condensed drops the chip
 * (mirroring `topbar-hide-narrow`); minimal keeps brand + active range. A drop
 * cascade plus a final hard truncate guarantee the row never exceeds its width.
 */
export function topbar(theme: Theme, opts: TopbarOptions): string {
	const mode = framePolicy(Math.max(0, opts.innerWidth + HORIZONTAL_INSET)).topbar;
	const bar = tabBarTheme(theme);
	const brand = theme.bold(theme.fg("accent", "omp/stats"));
	const segment = (ids: readonly Range[]): string =>
		ids
			.map(id => {
				const text = ` ${rangeMeta(id).label} `;
				return id === opts.range ? bar.activeTab(text) : bar.inactiveTab(text);
			})
			.join(" ");
	const join = (parts: readonly string[]): string => parts.filter(part => part !== "").join("  ");
	const fullRanges = segment(RANGES);
	const narrow = join([brand, segment([opts.range])]);
	let row: string;
	if (mode === "full") {
		row = join([brand, opts.chip, fullRanges, opts.freshness]);
		if (visibleWidth(row) > opts.innerWidth) row = join([brand, opts.chip, fullRanges, opts.freshness]);
		if (visibleWidth(row) > opts.innerWidth) row = join([brand, opts.chip, fullRanges]);
	} else if (mode === "condensed") {
		row = join([brand, fullRanges, opts.freshness]);
		if (visibleWidth(row) > opts.innerWidth) row = join([brand, fullRanges]);
	} else {
		row = narrow;
	}
	if (visibleWidth(row) > opts.innerWidth) row = narrow;
	if (visibleWidth(row) > opts.innerWidth) row = truncateToWidth(row, Math.max(0, opts.innerWidth));
	return row;
}
