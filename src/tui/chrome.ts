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
 * a screen. Range stays on `r`/`R` — and now also on `←`/`→`, which are
 * aliases for the same range step rather than a second way to change screens
 * (see panel.ts, which owns the keymap). While the `g` prefix is armed the
 * next letter is consumed even on no match (web parity); a stale prefix
 * (>1200 ms) falls through (web parity: timestamp check, no timer).
 *
 * TOPBAR GEOMETRY, decided once and cited above `topbar()`: the wordmark and
 * the action cluster are TWO regions separated by a painted spacer, because
 * the web separates them with `flex: 1` (styles.css:453-455) rather than with
 * a gap. The chip is an enclosed surface (`.live-chip`'s fill, styles.css:1597)
 * and the range control is one container with a single thumb
 * (`.segmented`, styles.css:1062-1081).
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


/**
 * The two topbar gaps, and they are not the same size.
 *
 * `TOPBAR_CLUSTER_GAP` is `.topbar-actions { gap: 8px }` (styles.css:460) —
 * the gap BETWEEN the chip and the range control, inside the action cluster.
 *
 * `TOPBAR_SPACER_MIN` is the FLOOR of `.topbar-spacer { flex: 1 }`
 * (styles.css:453-455) rather than a measurement: the browser's spacer is every
 * cell the viewport has left, and only the leftover has to be non-zero for the
 * brand to read as its own object. Three cells is the terminal equivalent of
 * the web's 12px topbar gap (styles.css:414) and is asserted by test/chrome.
 */
export const TOPBAR_CLUSTER_GAP = "  ";
export const TOPBAR_SPACER_MIN = 3;

/** The wordmark the SVG gradient mark stands in for (`Shell.tsx:59-71`). */
const BRAND = "omp/stats";

/** Pad `text` to `width` terminal cells. Labels here are ASCII, but width is measured, never assumed. */
function pad(text: string, width: number): string {
	const short = width - visibleWidth(text);
	return short > 0 ? `${text}${" ".repeat(short)}` : text;
}

/**
 * The sidebar's three columns, sized from the web's `.nav-row` (styles.css:522).
 *
 * `PREFIX_WIDTH` is the host's 2-column row prefix slot (`cursor + space` when
 * selected, two spaces otherwise — settings-list.ts:939-940), NOT a leading
 * indent choice; it is what keeps the hover band flush with the text.
 *
 * `SIDEBAR_GAP` is `.nav-row`'s `gap: 10px` (styles.css:526) between the label
 * column and the jump key — the two cells the web puts between `.nav-row-label`
 * and `kbd` before the key is pushed to the row end.
 *
 * `JUMP_KEY_PREFIX` is the `G ` of the web's `<kbd>G {HOTKEY}</kbd>`
 * (Shell.tsx:108). It is one constant rather than a template so the key column's
 * width is derived from the same string that is painted — a key that grew a
 * character would widen the column instead of colliding with the trailing edge.
 */
export const PREFIX_WIDTH = 2;
export const SIDEBAR_GAP = 2;
export const JUMP_KEY_PREFIX = "G ";
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
 * THE FULL GROUPED SIDEBAR, ALIGNED AS A COLUMN.
 *
 * `.nav-row` in the web is a flex row: icon, `.nav-row-label { flex: 1 }`, then
 * `kbd` (styles.css:522-574, Shell.tsx:106-108). The label's `flex: 1` is the
 * load-bearing part — it eats all free width, so the jump hint is pushed to the
 * row's TRAILING EDGE and the eight hints form a right-hand column instead of
 * a ragged staircase hanging off eight different label lengths.
 *
 * Ours appended `G <letter>` immediately after the label, so every row's hint
 * started at a different column and the block read as prose. That is defect 4.
 * The port reproduces the geometry with three measured columns:
 *
 *   [2-cell prefix slot] [icon gutter] [label column] [gap] [jump key]
 *
 * ICON GUTTER is measured from the icons this nav actually draws rather than
 * read from `ICON_GUTTER`, because the host registry (`theme.symbol("icon.*")`)
 * returns whatever the active preset binds and that is not always the table
 * entry — `icons.ts` is explicit that the two can disagree.
 *
 * THE JUMP KEY IS THE FAINTEST INK. `.nav-row kbd` is `--ink-4` at 10.5px
 * (styles.css:565-570), one step below even the segment labels, so the hint
 * never competes with the label it annotates. Ours paints it `dim` while the
 * label stays `muted`.
 *
 * Host parity, unchanged and still argued here: rows carry the host's 2-column
 * prefix slot (`cursor + space` active, two spaces otherwise —
 * settings-list.ts:939-940); the ACTIVE row is accent text under the cursor,
 * never a selectedBg pill, because the pill belongs to the range control and
 * the tab strip (chrome/shared.ts:21) and a second pill here is a second active
 * style; hover paints the host's `hoverTab` band on a NON-active row and never
 * moves the cursor (settings-list.ts:778, 792-796).
 *
 * DIVERGENCE (deliberate, unchanged): headings track the ACTIVE GROUP rather
 * than the settings-list dim wash, and headings are padded to the same width as
 * the rows so the whole block is one rectangle. The host dims off-section ROWS
 * in a split pane where rows stay selectable; a dim nav row here reads as
 * disabled, so the group cue lives in the heading instead.
 */
export function sidebar(theme: Theme, preset: SymbolPreset, activeId: string, hoveredId?: string | null): Sidebar {
	const bar = tabBarTheme(theme);
	const activeGroup = NAV_GROUPS.find(group => group.items.some(item => item.id === activeId));
	const items = NAV_GROUPS.flatMap(group => group.items);
	// Measured, not assumed: the preset's icon width is data ink and the host
	// registry does not always agree with `STATS_ICONS`.
	const iconWidth = Math.max(...items.map(item => visibleWidth(statsIcon(preset, TAB_ICON[item.id], theme))));
	const labelWidth = Math.max(...items.map(item => visibleWidth(item.label)));
	// `G <letter>` is a closed shape, so its width is a constant of the format.
	const keyWidth = visibleWidth(JUMP_KEY_PREFIX) + 1;
	const width = PREFIX_WIDTH + iconWidth + 1 + labelWidth + SIDEBAR_GAP + keyWidth;

	const lines: string[] = [];
	const tail = " ".repeat(SIDEBAR_GAP);
	for (const group of NAV_GROUPS) {
		const head = group === activeGroup ? theme.bold(theme.fg("accent", group.heading)) : theme.fg("muted", group.heading);
		lines.push(pad(`  ${head}`, width));
		for (const item of group.items) {
			// `.nav-row-label { flex: 1 }` ported as a fixed label column plus a
			// fixed trailing gap, which is what puts all eight jump keys in one
			// column at the row's trailing edge.
			const icon = pad(statsIcon(preset, TAB_ICON[item.id], theme), iconWidth);
			const label = pad(item.label, labelWidth);
			const key = `${JUMP_KEY_PREFIX}${item.hotkey.toUpperCase()}`;
			if (item.id === activeId) {
				// The cursor slot IS the 2-column prefix (settings-list.ts:939-940),
				// so the active row spends no more prefix than any other row.
				lines.push(
					theme.fg("accent", `${theme.nav.cursor} `) +
						theme.fg("accent", theme.bold(`${icon} ${label}`)) +
						theme.fg("dim", tail + key),
				);
				continue;
			}
			if (item.id === hoveredId) {
				lines.push((bar.hoverTab ?? bar.inactiveTab)(`  ${icon} ${label}${tail}${key}`));
				continue;
			}
			lines.push(theme.fg("muted", `  ${icon} ${label}`) + theme.fg("dim", tail + key));
		}
	}
	return { width, lines };
}

export interface TopbarOptions {
	range: Range;
	chip: string;
	/** Rollup freshness, already coloured by the panel (it owns EXACT_DIRTY_LIMIT). */
	freshness: string;
	innerWidth: number;
}

/**
 * THE TOPBAR IS THREE REGIONS, NOT ONE SENTENCE.
 *
 * `Shell.tsx:47-90` renders `<header class="topbar">` as `[brand] [spacer]
 * [actions]`, where the spacer is `.topbar-spacer { flex: 1 }`
 * (styles.css:453-455) and `.topbar-actions` holds the LiveChip, the
 * `Segmented` range control and the ThemeToggle (Shell.tsx:74-80). The
 * separation between the wordmark and the controls is therefore NOT a gap
 * value — it is every cell the browser has left over, and on a 1440px viewport
 * that is roughly 850px against 8px between the chip and the control
 * (styles.css:460).
 *
 * A terminal has no viewport and therefore no `flex: 1`. The separation has to
 * be PAINTED, and that is the whole fix for "the chip sits jammed next to
 * `omp/stats` and reads as part of the wordmark": the brand is laid down at
 * column 0 and the action cluster is laid down at the right edge, so the cells
 * between them are the port of the spacer.
 *
 * TWO ENCLOSURES, NOT TWO SENTENCES. The scout read off the web's own rule for
 * what makes a control read as a control: `.live-chip` is a filled, bordered,
 * full-pill-radius box (styles.css:1596-1598) and `.segmented` is a filled,
 * bordered box (styles.css:1064-1065), while `.topbar-brand` is naked text
 * with no enclosure at all. The terminal has no border-radius, so the faithful
 * form of "this is a surface" is a BACKGROUND. Hence: the chip gets
 * `selectedBg`, and the range control's active segment gets the host TabBar's
 * `activeTab` pill (chrome/shared.ts:21). Two enclosed objects, brand naked —
 * the same three-way read the web gets.
 *
 * THE RANGE CONTROL IS ONE CONTROL. `.segmented` is a single container with
 * `gap: 0` (styles.css:1062) holding six flush options and one absolutely
 * positioned thumb (styles.css:1069-1081, positioned from `Segmented.tsx:26-44`).
 * The terminal port keeps the two things that survive without geometry: a
 * uniform inactive style on every segment (`inactiveTab`, chrome/shared.ts:22)
 * and exactly one `activeTab` pill, with the segments packed flush so the run
 * reads as one object. `gap: 0` is why the join is `""` and not `" "`: the
 * segment's own single-cell padding IS the gutter, exactly as the web's 10px
 * option padding is.
 *
 * ORDER OF SACRIFICE is fixed, not incidental: freshness, then the chip, then
 * the segment run, then the segment run collapses to its active member. The
 * chip goes first of the controls because the web wraps exactly it in
 * `.topbar-hide-narrow` (Shell.tsx:75-77, styles.css:655-657) while the range
 * control always survives — the range IS the window you are looking at.
 */
export function topbar(theme: Theme, opts: TopbarOptions): string {
	const innerWidth = Math.max(0, opts.innerWidth);
	const mode = framePolicy(innerWidth + HORIZONTAL_INSET).topbar;
	const bar = tabBarTheme(theme);
	// `.topbar-brand` is weight 600 over a dim `--ink-4` slash (styles.css:432,
	// :441-445): the slash is the faintest ink in the bar, so the wordmark reads
	// as one mark rather than as a path. Only the slash is dimmed — the mark is
	// the brightest thing on the row, which is the web's ink hierarchy
	// (brand `--ink-1`, chip `--ink-2`, chip count and segment labels `--ink-3`).
	const brand =
		theme.bold(theme.fg("accent", "omp")) + theme.fg("dim", "/") + theme.bold(theme.fg("accent", "stats"));
	/** The chip as an enclosed object, the port of `.live-chip`'s fill+border. */
	const chip = opts.chip === "" ? "" : theme.bg("selectedBg", ` ${opts.chip} `);
	/** `.segmented`: flush options, one `activeTab` thumb among uniform inactives. */
	const tray = (ids: readonly Range[]): string =>
		ids
			.map(id => {
				const cell = ` ${rangeMeta(id).label} `;
				return id === opts.range ? bar.activeTab(cell) : bar.inactiveTab(cell);
			})
			.join("");
	const fullTray = tray(RANGES);
	const oneTray = tray([opts.range]);

	// The cluster's own gap is the web's `.topbar-actions { gap: 8px }`; the
	// brand↔cluster gap is the spacer and is unbounded below.
	const cluster = (parts: readonly string[]): string => parts.filter(part => part !== "").join(TOPBAR_CLUSTER_GAP);
	const layouts: readonly (readonly string[])[] =
		mode === "full"
			? [[chip, opts.freshness, fullTray], [chip, fullTray], [chip, oneTray], [fullTray], [oneTray]]
			: mode === "condensed"
				? [[opts.freshness, fullTray], [fullTray], [oneTray]]
				: [[oneTray]];

	const brandWidth = visibleWidth(brand);
	for (const layout of layouts) {
		const actions = cluster(layout);
		const used = brandWidth + TOPBAR_SPACER_MIN + visibleWidth(actions);
		if (used > innerWidth) continue;
		// The spacer: every cell the row has left over, which is what `flex: 1`
		// resolves to in a browser.
		const spacer = innerWidth - used;
		return `${brand}${" ".repeat(TOPBAR_SPACER_MIN + spacer)}${actions}`;
	}
	// Below even the narrowest layout, the brand and the active range still have
	// to fit; anything longer is clipped rather than allowed to overflow, since
	// `OverlayPanel.row` would tear the row on the right instead.
	const last = `${brand}${" ".repeat(TOPBAR_SPACER_MIN)}${oneTray}`;
	return visibleWidth(last) > innerWidth ? truncateToWidth(last, innerWidth) : last;
}
