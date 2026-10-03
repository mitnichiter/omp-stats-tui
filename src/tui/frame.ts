/**
 * `src/tui/frame.ts` — the tab strip as a FRAME BUDGET.
 *
 * WHY THIS EXISTS. `/settings` renders its tab strip through `PanelRows` and
 * then computes its own fixed-row arithmetic explicitly
 * (`settings-selector.ts:736-739`):
 *
 *     const tabLines = this.#tabBar.render(width);
 *     const fixedRows = 1 + tabLines.length + 1 + (searching ? 1 : 0) + 1 + 1 + 1;
 *     const contentRows = Math.max(7, height - fixedRows - previewLines.length);
 *
 * The arithmetic is not optional. `TabBar` collapses to `short` and, failing
 * that, WRAPS to two rows when twelve tabs do not fit the width — and a panel
 * that renders the strip while sizing its body from a hardcoded chrome count
 * spends a row the terminal does not have. The bottom border then falls off the
 * screen, which is the failure a user sees as "the panel is broken at 60
 * columns" and which no assertion on `render(width)` alone would catch.
 *
 * So the tab-row count is MEASURED, per width, and subtracted. The cost is one
 * `render()` of a dozen cells per frame, which is nothing next to a paint.
 *
 * PURE. No theme, no terminal, no data. {@link TAB_ROWS} answers one question —
 * "how many rows does the strip need at this width?" — and everything the panel
 * spends on chrome is derived from that answer rather than from a constant.
 */

import { TabBar, type Tab, type TabBarTheme } from "@oh-my-pi/pi-tui";

import { PANEL_CHROME_ROWS } from "./panel-constants";

/**
 * Rows `OverlayPanel` draws around the body: top border, tab row, divider,
 * footer, bottom border. Counted from `OverlayPanel.render` rather than from
 * `layout.ts`'s advisory `CHROME_ROWS`, so the claim about the frame and the
 * frame itself cannot drift apart.
 */
export const CHROME_ROWS = PANEL_CHROME_ROWS;

/** The shortest terminal the panel will paint: the chrome plus one body row. */
export const MIN_PANEL_ROWS = CHROME_ROWS + 1;

/**
 * The body floor. `/settings` uses 7, `/usage` 5, and `layout.ts` 1. Seven is
 * right for this panel because the first band is a `statRow` that is three or
 * four rows tall; below that the first thing a reader sees is a truncated
 * headline rather than a screen.
 */
export const MIN_BODY_ROWS = 7;

/**
 * How many rows the tab strip needs at a given width.
 *
 * Measured by rendering it, because that is the only way to know: `TabBar`
 * collapses tabs to `short` farthest-from-active first and wraps only as a last
 * resort, so the count depends on WHICH tab is active and how wide the labels
 * are. A width→rows TABLE would be a second implementation of a function the
 * host already has, and would be wrong the moment a label changed.
 *
 * Twelve tabs of one-cell glyphs fit 58 columns; below that the strip is two
 * rows, and the body loses one. That is accepted rather than fought — `TabBar`
 * has no scroll, and a scrolled strip would hide tabs the user cannot reach by
 * `1`-`9`.
 */
export function TAB_ROWS(tabs: readonly Tab[], theme: TabBarTheme, width: number): number {
	const bar = new TabBar("", [...tabs], theme);
	// The panel folds its own hints into the footer, so the strip must not spend
	// a cell on `(tab to cycle)`.
	bar.showHint = false;
	return bar.render(Math.max(1, width)).length;
}

/**
 * Rows the body gets, from the terminal height and the LIVE tab-row count.
 *
 * The `+ 1` is the header row the tab row replaces — the tab strip took its
 * place in the frame, so it costs nothing extra at one row and costs exactly
 * one row more per wrap. Mirrors the arithmetic at `settings-selector.ts:739`.
 */
export function bodyRows(height: number, tabRows: number): number {
	const safe = Number.isFinite(height) ? Math.trunc(height) : MIN_PANEL_ROWS;
	// Clamped at MIN_PANEL_ROWS rather than below: a terminal shorter than its own
	// chrome still paints a coherent frame, because `OverlayPanel` clips.
	const frame = Math.max(MIN_PANEL_ROWS, safe);
	return Math.max(1, frame - CHROME_ROWS - Math.max(0, tabRows - 1));
}