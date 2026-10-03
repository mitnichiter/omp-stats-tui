import { buildHeatmapLayout } from "@oh-my-pi/pi-tui/overlays/usage-dashboard";
import type { DailyActivityPoint } from "@oh-my-pi/omp-stats/shared-types";
import { formatCost, formatInteger } from "../format";
import type { GlyphSet } from "../glyphs";

/**
 * The calendar heatmap. Monday-first, one cell per day, like `/usage`'s.
 *
 * A pure render function: data in, lines out. No theme singleton, no database,
 * no I/O.
 *
 * ── What is reused, and what that buys ───────────────────────────────────────
 *
 * The LAYOUT is not reimplemented. `buildHeatmapLayout` from
 * `@oh-my-pi/pi-tui/overlays/usage-dashboard` is exported, host-proven in
 * production by `/usage`, and already implements the four rules that are easy to
 * get subtly wrong:
 *
 *  1. ZERO-FILL — it allocates all 7 × weeks cells and fills each with
 *     `level(point ? metric(point) : 0)`, so a day with no activity becomes level
 *     0 rather than a missing cell. (Crush's SQL emits rows only for days WITH
 *     activity, so quiet days vanish from its axis — misleading for a bar chart,
 *     a broken component for a calendar.)
 *  2. MAX-ANCHORED, discrete — `level()` divides by the grid maximum, not by the
 *     observed min, so a quiet fortnight cannot look identical to a busy one.
 *  3. `max <= 0` returns level 0 before any division, so an all-zero grid cannot
 *     divide by zero.
 *  4. `null` for a FUTURE date — the loop `continue`s past `today0`, leaving the
 *     cell null. Absence is modelled as absence, not as zero.
 *  5. LOCAL dates — `localIso()` keys on `YYYY-MM-DD` in local time, so no UTC
 *     post-processing can drop or duplicate the boundary day.
 *
 * What this module adds is the ANSI emission and the level→glyph/colour mapping,
 * both of which `/usage` keeps in `#private` methods with no export to call.
 *
 * ── The ink is DELIBERATELY UNDECIDED ───────────────────────────────────────
 *
 * `heatCell` is read as a RAMP through `glyph(preset, "heatCell", level)`. The
 * ladder in `src/tui/glyphs.ts` is a table value on purpose: the candidates are
 * `■` plus colour versus the `░▒▓█` shade ramp, and the user settled the choice
 * by LOOKING at them (`bun run scripts/probe-glyphs.ts --heatmap`) rather than by
 * reasoning. Swapping the ladder is therefore a one-line edit to the glyph table
 * and requires no change here — which is exactly why the ramp is not a literal
 * here. F19 argues for `█` full-bleed and against `■` on gutter grounds; that
 * argument is recorded, not acted on unilaterally.
 */

/** Raw foreground reset. Deliberately not `theme.fg(...)` per cell: that would
 *  be a theme lookup for every one of ~371 cells on every frame. `/usage` does
 *  the same thing for the same reason. */
const FG_RESET = "\x1b[39m";

/** All seven Monday-first day labels, exactly as /usage's HEATMAP_DAY_LABELS. */
const ROW_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

export interface HeatmapOptions {
	/** Content width. No rendered row may exceed it. */
	innerWidth: number;
	/** Width of the weekday-label gutter. */
	labelWidth: number;
	/** Week columns to draw. Reduced by `weeksForWidth` on a narrow terminal. */
	weeks: number;
	glyphs: GlyphSet;
	/**
	 * Four colour stops for levels 1..4. Level 0 deliberately uses none: a day
	 * with no activity must read as empty, not as the faintest colour.
	 */
	ramp: readonly string[];
	/** Injectable so tests are independent of the wall clock. */
	today?: Date;
}

/**
 * How many week columns fit at this label width, from the narrow-terminal ladder
 * the brief specifies: 12 → 8 → 4.
 *
 * Narrow terminals reduce the WINDOW, never the cell size. A cell stays exactly
 * one column wide because a sub-cell calendar is unreadable and cannot be
 * redrawn at a different size later; dropping weeks instead keeps the same
 * Monday-first geometry at a readable scale.
 */
export function weeksForWidth(labelWidth: number, innerWidth: number): number {
	const available = Math.max(0, innerWidth - labelWidth);
	// The brief's ladder — 12 → 8 → 4 — extended upward, because saturating a wide
	// terminal at three months would waste the space a year-long calendar needs.
	if (available >= 108) return 53;
	if (available >= 48) return 26;
	if (available >= 24) return 12;
	if (available >= 16) return 8;
	return 4;
}

/**
 * Render the grid: one month-label row plus seven day rows.
 *
 * Cell states, exactly as `/usage` renders them and exactly as the four rules
 * above require:
 *
 *   null  → a future date. Two spaces. ABSENT, not zero.
 *   0     → no activity. `heatEmpty`, dimmed. Present and accounted for.
 *   1..4  → `ramp[cell - 1]` + the level's `heatCell` glyph + FG_RESET.
 */
export function renderHeatmap(
	points: readonly DailyActivityPoint[],
	opts: HeatmapOptions,
): readonly string[] {
	const weeks = Math.max(1, opts.weeks);
	const layout = buildHeatmapLayout(points as DailyActivityPoint[], weeks, opts.today);

	const labelWidth = Math.max(0, opts.labelWidth);
	// One glyph plus one space per column. The trailing space is kept on the last
	// column too so every row is exactly the same width — a heatmap whose rows
	// differ by a cell reads as a ragged grid, which is precisely what makes
	// column alignment impossible to verify by eye.
	const columnWidth = 2;

	// Month labels are three characters wide but a column is only two, so they
	// are written into a CHARACTER buffer rather than assembled as a string.
	// Building the string incrementally shifts every later label right by the
	// overhang of the earlier ones, so the labels drift out of step with the
	// columns beneath them — the bug this avoids.
	const gridWidth = labelWidth + weeks * columnWidth;
	const monthChars = " ".repeat(Math.max(labelWidth, gridWidth)).split("");
	for (const [week, label] of layout.monthLabels.slice(0, weeks).entries()) {
		// The host emits `null` for "no label in this column", not `undefined`.
		if (label == null) continue;
		const at = labelWidth + week * columnWidth;
		for (const [offset, char] of [...label].entries()) {
			if (at + offset < monthChars.length) monthChars[at + offset] = char;
		}
	}
	const monthRow = monthChars.join("").slice(0, gridWidth);

	const body = layout.cells.map((weekRow, dayIndex) => {
		const label = (ROW_LABELS[dayIndex] ?? "").padEnd(labelWidth, " ");
		const cells = weekRow.map(cell => {
			// ABSENT (a future date) — blank, and deliberately NOT the empty glyph.
			// Colouring a day that has not happened as "zero activity" would be a
			// lie about spend.
			if (cell === null) return " ".repeat(columnWidth);
			// Present but no activity — drawn, so a quiet day still occupies its
			// slot in the calendar rather than vanishing from the axis.
			if (cell === 0) return `${emptyCell(opts.glyphs)} `;
			return `${opts.ramp[cell - 1] ?? ""}${heatCell(opts.glyphs, cell)}${FG_RESET} `;
		});
		return label + cells.join("");
	});

	// Clamp to the requested width. Truncating is correct here and wrapping is
	// not: a wrapped row silently doubles the row count and shifts the whole grid.
	const width = Math.max(0, opts.innerWidth);
	return [monthRow, ...body].map(row => (Bun.stringWidth(row) > width ? clip(row, width) : row));
}

/** Clip to `width` visible cells without splitting an ANSI escape sequence. */
function clip(row: string, width: number): string {
	if (width <= 0) return "";
	let visible = 0;
	let out = "";
	for (let i = 0; i < row.length; ) {
		if (row[i] === "\x1b") {
			const end = row.indexOf("m", i);
			const stop = end === -1 ? row.length : end + 1;
			out += row.slice(i, stop);
			i = stop;
			continue;
		}
		if (visible >= width) break;
		out += row[i];
		visible++;
		i++;
	}
	return out;
}

/**
 * Read one rung of a role's ladder out of the `GlyphSet` the caller already
 * resolved. `glyph(preset, role, level)` would need a preset string, but the
 * caller hands us the set instead so that no render function has to re-read the
 * theme singleton. Going through the set keeps one source of truth: the ladder in
 * `src/tui/glyphs.ts` is the only place a heatmap character is written down.
 */
function ladderRung(set: GlyphSet, role: "heatCell" | "heatEmpty", level: number): string {
	const value = set[role];
	if (typeof value === "string") return value;
	return value[Math.max(0, Math.min(value.length - 1, level))] ?? value[0];
}

/** Level 1..4 cell glyph. */
function heatCell(set: GlyphSet, level: number): string {
	return ladderRung(set, "heatCell", level - 1);
}

/** A day that is present but had no activity. */
function emptyCell(set: GlyphSet): string {
	return ladderRung(set, "heatEmpty", 0);
}

/** Left-pad a label into its column, so month names never overlap a neighbour. */
function padRow(
	labels: readonly (string | undefined)[],
	labelWidth: number,
	weeks: number,
	columnWidth: number,
): string {
	const gutter = " ".repeat(labelWidth);
	const cells = labels
		.slice(0, weeks)
		.map(label => (label ? label.slice(0, columnWidth - 1).padEnd(columnWidth - 1) : " ".repeat(columnWidth)))
		.join("");
	return (gutter + cells).trimEnd();
}

/**
 * A one-line summary of the window.
 *
 * Reports requests AND cost, because a `$0.00` beside real spend elsewhere in
 * the panel means unknown spend (unpriced requests), not free spend — CONTEXT.md
 * is explicit that a cost figure shown without its unpriced count is a wrong
 * number rather than a rounded one.
 */
export function heatmapSummary(
	points: readonly DailyActivityPoint[],
): string {
	const requests = points.reduce((sum, point) => sum + (point.requests ?? 0), 0);
	const cost = points.reduce((sum, point) => sum + (point.cost ?? 0), 0);
	const unpriced = points.filter(point => (point.cost ?? 0) === 0 && (point.requests ?? 0) > 0).length;
	const unpricedNote = unpriced > 0 ? ` · ${formatInteger(unpriced)} unpriced` : "";
	return `${formatInteger(requests)} requests · ${formatCost(cost)}${unpricedNote}`;
}