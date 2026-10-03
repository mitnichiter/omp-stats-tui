/**
 * The three thin chart primitives: sparkline, ranked bar list, share bar.
 *
 * Pure render functions. No I/O, no theme singleton, no database. Every mark
 * comes from the glyph module through `glyph()`, so the ASCII preset degrades
 * without this file knowing that a preset exists.
 *
 * ── Four rules, each one a rule against a specific lie ──────────────────────
 * F17 (Crush/btop/bottom/gnuplot/VisiData), F18 (ratatui) and F19 (glyph audit)
 * surveyed independently and converged on all four. They are not style choices:
 *
 * 1. **ZERO-BASELINED AGAINST A CALLER-SUPPLIED MAX. NEVER MIN-MAX.**
 *    Min-max stretches each series to fill the ramp, so a quiet week renders
 *    identically to a busy one — precisely backwards for a stats panel. Every
 *    function here takes an explicit `max` and scales against it.
 *    DO NOT "improve" this into min-max. Ratatui states the rule in as many
 *    words: "there is no min-max stretch, so a flat series renders as a solid
 *    row rather than as noise."
 *
 * 2. **`max === 0` IS A REAL CASE, NOT A CRASH.** A week with no activity must
 *    render as a zero-baseline run of glyphs. Crush's guard is `if (max === 0)
 *    max = 1`; we take the equivalent, and never return "" for a series that
 *    has data — an empty line inside a bordered panel reads as a layout bug.
 *
 * 3. **CLIP, DO NOT DOWNSAMPLE — AND KEEP THE NEWEST.** Averaging adjacent
 *    samples invents values that were never observed, which on a stats panel is
 *    a fabricated data point. Ratatui clips to the OLDEST `width` samples, which
 *    is wrong for a live panel because it hides today; we take the LAST `width`.
 *    (The one exception is cost, where SUMMING is the semantics — that is
 *    `densify`, used by `bars.ts`, not this file.)
 *
 * 4. **A ZERO-VALUED ROW MUST BE VISIBLE.** In a ranked list a zero row emits
 *    at least one cell, so it reads as "measured, and zero" rather than as
 *    "no data". Same reasoning as bars.ts: a not-yet-built bucket must never
 *    look like a cheap one.
 *
 * The cost of unpriced requests is handled by `costWithUnpriced` from
 * `../format`, which is the single implementation of that rule (Task 4). It is
 * reused, never re-derived here.
 */

import { costWithUnpriced, formatInteger } from "../format";
import { glyph, type GlyphValue, type SymbolPreset } from "../glyphs";

/** Gap between a share bar's track and its readout, in cells. */
const SHARE_GAP = 1;

// ─── Sparkline ───────────────────────────────────────────────────────────────

export interface SparklineOptions {
	/** Columns to emit. Output is exactly this many cells. */
	width: number;
	/**
	 * The value that maps to the top of the ramp. Omit to use the series'
	 * own maximum, which is still zero-baselined (rule 1).
	 */
	max?: number;
	/** Symbol preset. Passed through to `glyph()`; never branched on here. */
	preset?: SymbolPreset;
}

/**
 * One character per sample, magnitude on the eighth-block ramp.
 *
 * `level = clamp(round(v / max * (levels - 1)), 0, levels - 1)` — ratatui's
 * linear tick model with an 8-slot ladder, implemented in integer arithmetic.
 */
export function renderSparkline(values: readonly number[], opts: SparklineOptions): string {
	const width = Math.max(0, Math.floor(opts.width));
	if (width === 0) return "";

	// Rule 3: clip to the last `width` samples, so the newest data survives.
	// A shorter series is right-aligned, which puts its newest sample on the
	// right edge — including the single-point case, where anchoring right is the
	// whole point: a one-column panel should show now, not a one-character
	// history pinned to the past.
	const newest = values.length > width ? values.slice(values.length - width) : values;
	const padding = width - newest.length;

	// Rule 1: the caller's max, else the series max. Never the series MIN.
	const max = opts.max ?? Math.max(0, ...values);
	// Rule 2: `max <= 0` is a real case, not a crash. Crush's guard is
	// `if (max === 0) max = 1`, but that literal transcription is wrong for a
	// ramp: dividing a non-zero value by 1 paints it FULL, so a panel told
	// "the maximum is zero" would render a full-height bar. A zero maximum
	// means there is nothing to show, so the whole run sits on the baseline.
	const level = (v: number) =>
		max <= 0 ? 0 : Math.max(0, Math.min(7, Math.round((Math.max(0, v) / max) * 7)));

	const preset = opts.preset ?? "unicode";
	return (
		glyph(preset, "sparkRamp", 0).repeat(padding) +
		newest.map((v) => glyph(preset, "sparkRamp", level(v))).join("")
	);
}

// ─── Ranked bar list ─────────────────────────────────────────────────────────

export interface RankedRow {
	label: string;
	value: number;
	/** Display figure; defaults to a formatted count (or cost, if unpriced). */
	display?: string;
	/** Requests that could not be priced. Non-zero ⇒ the figure is a floor. */
	unpriced?: number;
}

export interface RankedBarsOptions {
	width: number;
	/**
	 * Scale maximum. Omit to use the largest value in the SHOWN set — one
	 * divisor across every row, which is what makes the bars directly
	 * comparable and removes the need for an axis or a legend.
	 */
	max?: number;
	preset?: SymbolPreset;
	accent: (text: string) => string;
	dim: (text: string) => string;
}

/** Truncate to `width` cells with a trailing ellipsis, measured not counted. */
function ellipsize(text: string, width: number): string {
	if (width <= 0) return "";
	if (Bun.stringWidth(text) <= width) return text;
	let out = "";
	for (const ch of text) {
		if (Bun.stringWidth(out + ch) > Math.max(0, width - 1)) break;
		out += ch;
	}
	return `${out}…`;
}

function padStartCells(text: string, width: number): string {
	const gap = width - Bun.stringWidth(text);
	return gap > 0 ? " ".repeat(gap) + text : text;
}

function padEndCells(text: string, width: number): string {
	const gap = width - Bun.stringWidth(text);
	return gap > 0 ? text + " ".repeat(gap) : text;
}

/**
 * A ranked horizontal bar list: label, bar, value, one row per entry.
 *
 * Every row shares ONE divisor — `maxShown`, the largest value in the shown
 * set — which is what makes the bars directly comparable and removes the need
 * for an axis, ticks or a legend. Crush, ratatui and btop all scale this way.
 */
export function renderRankedBars(rows: readonly RankedRow[], opts: RankedBarsOptions): readonly string[] {
	// The one case where returning nothing is right: an empty list has genuinely
	// nothing to draw, and unlike a sparkline it draws no track.
	if (rows.length === 0) return [];

	const width = Math.max(0, Math.floor(opts.width));
	const preset = opts.preset ?? "unicode";
	const fill = glyph(preset, "barFill");
	const blank = glyph(preset, "barEmpty");

	// Descending by rank. An unpriced row ranks by its unpriced REQUEST count
	// rather than by its zero cost, so a heavily-used model whose spend could not
	// be measured is not buried at the bottom where nobody sees the marker.
	const rank = (r: RankedRow) => (r.unpriced && r.unpriced > 0 ? r.unpriced : r.value);
	const sorted = [...rows].sort((a, b) => rank(b) - rank(a));

	const maxShown = opts.max ?? Math.max(0, ...sorted.map((r) => r.value));
	// Rule 2: a zero max makes every row a measured zero rather than a division
	// by zero. Rule 4 then still emits a cell, so the row stays visible.
	const divisor = maxShown > 0 ? maxShown : 1;

	// One label column for the whole list, sized to the longest label that fits,
	// so bars start at the same x and stay comparable down the column.
	const readoutWidth = Math.max(...sorted.map((r) => readoutFor(r).length));
	const labelWidth = Math.min(
		Math.max(...sorted.map((r) => r.label.length)),
		Math.max(0, Math.floor(width / 2)),
	);
	const track = Math.max(1, width - labelWidth - readoutWidth - 2);

	return sorted.map((row) => {
		// Rule 4: the one-cell floor. A row that rendered nothing would be
		// indistinguishable from a row the query never returned — and this may be
		// the unpriced model the user most needs to see.
		const filled = Math.max(1, Math.min(track, Math.round((row.value / divisor) * track)));

		const label = padEndCells(row.label, labelWidth);
		const readout = padStartCells(readoutFor(row), readoutWidth);
		const bar = opts.accent(fill.repeat(filled)) + opts.dim(blank.repeat(track - filled));

		return ellipsize(`${label} ${bar} ${readout}`, width);
	});
}

/**
 * A row's trailing figure. An unpriced row is `N/A · 34,870 unpriced` — never
 * `$0.00` — and the rule lives in `costWithUnpriced` so there is exactly one
 * implementation of it (Task 4).
 */
function readoutFor(row: RankedRow): string {
	if (row.display !== undefined) return row.display;
	if (row.unpriced !== undefined && row.unpriced > 0) return costWithUnpriced(row.value, row.unpriced);
	return formatInteger(row.value);
}

// ─── Share bar ───────────────────────────────────────────────────────────────

export interface ShareBarOptions {
	width: number;
	preset?: SymbolPreset;
}

/**
 * A single-share bar: filled cells, empty cells, then a readout.
 *
 * The algorithm is transcribed from Charm's bubbles `progress.ViewAs` (F17):
 *
 *     textWidth = Bun.stringWidth(readout)     // the number is rendered FIRST
 *     track     = Math.max(0, width - textWidth - gap)
 *     filled    = Math.max(0, Math.min(track, Math.round(track * share)))
 *
 * The ordering is the point. Measuring the number before laying out the bar is
 * what stops the readout being pushed off the end of the row, and it means that
 * at a narrow width the bar disappears and the number wins — the right trade,
 * since the number is the fact and the bar is the decoration.
 *
 * No eighth-block ramp here: one cell is 1/track of the scale, which is plenty
 * for a share, and eighths would imply resolution this does not have.
 */
export function renderShareBar(share: number, opts: ShareBarOptions, readout = ""): string {
	const width = Math.max(0, Math.floor(opts.width));
	const preset = opts.preset ?? "unicode";
	const fill = glyph(preset, "barFill");
	const blank = glyph(preset, "barEmpty");

	// Render the number FIRST, then give the bar what is left. The gap is
	// reserved and then EMITTED, so the line is exactly `width` cells whenever
	// the readout fits; reserving a gap and not printing it loses a cell per row.
	const textWidth = Bun.stringWidth(readout);
	const gap = readout ? Math.min(SHARE_GAP, Math.max(0, width - textWidth)) : 0;
	const track = Math.max(0, width - textWidth - gap);

	// Rule 2: a share of zero is a measured zero — an all-empty track, never a
	// division by zero and never a missing line. A share above 1 clamps to full
	// so a percentage over 100 cannot overflow the column.
	const clamped = Math.max(0, Math.min(1, share));
	const filled = Math.max(0, Math.min(track, Math.round(track * clamped)));

	// A readout wider than the whole row is printed WHOLE, not truncated. The
	// bar has already yielded completely (track === 0) and the number is the
	// fact — truncating the fact to fit a row that has no bar left to protect
	// would trade the thing that matters for the thing that does not.
	return fill.repeat(filled) + blank.repeat(track - filled) + " ".repeat(gap) + readout;
}