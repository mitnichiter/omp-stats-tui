/**
 * Mouse hit areas for the stats panel: pure geometry over the last frame.
 *
 * WHY THIS MODULE EXISTS. SGR reports arrive as terminal coordinates
 * (fullscreen paints from row 0, so they map 1:1; `mouse.ts` header,
 * `settings-selector.ts:635-636`). Somebody has to turn a (row, col) into a
 * screen or a range, and that somebody must read the SAME structures the frame
 * is painted from — `NAV_GROUPS` for the sidebar rows, `rangeMeta` labels for
 * the topbar segments, `TabBar.tabAt` for the strip — so a relabelled screen
 * or a reordered range moves its own hit area with no edit here.
 *
 * Coordinate contract (copied from the host's own routers, not invented):
 * `OverlayPanel` draws exactly one top-border row and insets content two
 * columns (`overlay-box.ts:207-212`, `row()`), so content row = row - 1 and
 * content col = col - 2. The topbar is always content row 0; a progress line
 * under it (`topLines[1]`) is chrome, never a target.
 *
 * PURE: no theme, no terminal, no data. The panel records the frame in
 * `render` and hit-tests in `handleInput`; hover state and selection live
 * there, not here.
 */

import type { SgrMouseEvent } from "@oh-my-pi/pi-tui";
import { visibleWidth } from "@oh-my-pi/pi-tui";
import { rangeMeta } from "@oh-my-pi/omp-stats/client/data/range";
import { NAV_GROUPS } from "./chrome";
import { RANGES, type Range } from "../data/ranges";

export type { SgrMouseEvent };

/**
 * The last frame's geometry, recorded per render. `topbar` is the STRIPPED
 * topbar row (ANSI escapes are zero-width, so raw indices would miss); `tabAt`
 * is the strip's own hit-test over its last render.
 */
export interface MouseFrame {
	topbarRows: number;
	stripRows: number;
	sidebarWidth: number;
	sidebarRows: number;
	topbar: string;
	tabAt: (line: number, col: number) => string | undefined;
}

export type MouseHit =
	| { type: "none" }
	| { type: "screen"; id: string; via: "strip" | "sidebar" }
	| { type: "range"; id: Range };

const NO_HIT: MouseHit = { type: "none" };

/**
 * Which screen a sidebar body-row means, or null for headings and padding.
 * Derived by walking `NAV_GROUPS` the way `sidebar()` paints it: one heading
 * row per group, then one row per item. A regrouped nav moves its own rows.
 */
export function sidebarHit(navRow: number): string | null {
	if (!Number.isInteger(navRow) || navRow < 0) return null;
	let row = 0;
	for (const group of NAV_GROUPS) {
		if (navRow === row) return null;
		row++;
		for (const item of group.items) {
			if (navRow === row) return item.id;
			row++;
		}
	}
	return null;
}

export interface RangeSpan {
	id: Range;
	start: number;
	end: number;
}

/**
 * Where each range segment sits in the (stripped) topbar row, in CELL columns.
 * Found by substring search on the host's own `rangeMeta` labels, so a
 * relabelled range keeps its hit area; a truncated-away segment simply has
 * none. The prefix is measured with `visibleWidth`, not `indexOf` arithmetic,
 * because the chip ahead of the segments can carry a two-cell status mark —
 * UTF-16 offsets and terminal cells only agree up to the first wide char.
 */
export function rangeSpans(line: string): RangeSpan[] {
	const spans: RangeSpan[] = [];
	for (const id of RANGES) {
		const cell = ` ${rangeMeta(id).label} `;
		const found = line.indexOf(cell);
		if (found === -1) continue;
		const start = visibleWidth(line.slice(0, found));
		spans.push({ id, start, end: start + visibleWidth(cell) });
	}
	return spans;
}

/** Which range owns a topbar column, or null for brand, chip, gaps, freshness. */
export function rangeHit(line: string, col: number): Range | null {
	if (!Number.isInteger(col) || col < 0) return null;
	for (const span of rangeSpans(line)) {
		if (col >= span.start && col < span.end) return span.id;
	}
	return null;
}

/**
 * Route overlay-relative 0-based (row, col) to a target. Regions in frame
 * order: top border (row 0) is inert; the topbar is content row 0 and a
 * progress row under it is inert chrome; the strip routes through the TabBar's
 * own zones; the sidebar routes only inside its width — a hidden sidebar
 * (`sidebarWidth 0`) leaves no dead click zone; everything else is body text.
 */
export function hitTest(frame: MouseFrame, row: number, col: number): MouseHit {
	// The one top-border row and the two inset columns `OverlayPanel`
	// draws around every content row.
	const contentRow = row - 1;
	const contentCol = col - 2;
	if (contentRow < 0 || contentCol < 0) return NO_HIT;
	if (contentRow < frame.topbarRows) {
		if (contentRow !== 0) return NO_HIT;
		const id = rangeHit(frame.topbar, contentCol);
		return id === null ? NO_HIT : { type: "range", id };
	}
	const stripLine = contentRow - frame.topbarRows;
	if (stripLine < frame.stripRows) {
		const id = frame.tabAt(stripLine, contentCol);
		return id === undefined ? NO_HIT : { type: "screen", id, via: "strip" };
	}
	const bodyRow = contentRow - frame.topbarRows - frame.stripRows;
	if (bodyRow < 0 || bodyRow >= frame.sidebarRows) return NO_HIT;
	if (frame.sidebarWidth > 0 && contentCol < frame.sidebarWidth) {
		const id = sidebarHit(bodyRow);
		return id === null ? NO_HIT : { type: "screen", id, via: "sidebar" };
	}
	return NO_HIT;
}
