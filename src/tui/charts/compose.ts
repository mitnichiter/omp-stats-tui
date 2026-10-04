/**
 * `src/tui/charts/compose.ts` — a multi-series chart, built out of the
 * single-series chart that already works.
 *
 * WHY THIS FILE IS A COMPOSITOR AND NOT A RENDERER. Charts in this panel broke
 * four times in one session, always the same way: a working single-series
 * renderer existed, and someone wrote a NEW multi-series rendering path beside
 * it. The result looked like `░█░░░░█░░░░█░░░█░░░█░░░░` — one glyph per sample,
 * series interleaved, no reader able to say which series any column belonged to.
 * It did not throw, and it passed its own tests, because it was internally
 * consistent and nobody compared it to the primitive it should have been built
 * from.
 *
 * So this module has no geometry of its own. Every mark it returns comes out of
 * {@link renderDailyBars}, called once per series, and
 * `test/chart-primitives.test.ts` asserts that by EQUALITY: with labels off,
 * `renderSeriesChart(...)` must equal the hand-rolled
 * `series.flatMap(s => renderDailyBars(s.values, …))`, byte for byte. The
 * invariant is checked by a machine rather than remembered by a reviewer, and a
 * new geometry cannot be added here without failing that test.
 *
 * ── THE COMPOSITION MODEL, AND WHY ──────────────────────────────────────────
 *
 * The web stacks its series INSIDE one column, in one row-set, against one
 * shared y-scale: `charts/Chart.tsx:83-97` accumulates a stack base per series
 * and a running top across slots, and `stacked` defaults to `true`. Two series
 * are one column of two colours, so the reader compares heights within a column.
 *
 * A terminal cell holds one glyph, so a column cannot carry two stacked values
 * legibly — that is exactly what the broken `░█░█░█` output was attempting, and
 * it is why it read as noise. The faithful translation is to give each series its
 * OWN BAND of rows, vertically, and to preserve the one property the web's
 * stacking actually communicates: a SINGLE SCALE across all series.
 *
 * That last part is load-bearing. Simply calling `renderDailyBars` per series at
 * equal heights is still wrong, because each primitive call scales against its
 * OWN maximum: Succeeded (peak 44) and Failed (peak 4) would each fill its band
 * and the failure rate would read as 100%. So a series' band is sized by its
 * peak RELATIVE to the maximum across all series, and
 * `renderDailyBars` then fills exactly those rows. Magnitude therefore reads
 * across series the way column height reads within one.
 *
 * Rows that do not divide evenly go to NOBODY: a 5-row budget across 3 series is
 * 1 row each, and handing the remainder to the last series would make its
 * apparent magnitude a function of its position in the list.
 *
 * ── WHAT IS NOT HERE ─────────────────────────────────────────────────────────
 *
 * No glyph or colour literal: marks come from `glyphsFor`, hues from
 * `resolveSeries`, geometry from the primitives. And no new scale axis — series
 * values are whatever the payload supplies (COSTS, request counts), and the cost
 * invariant belongs to the primitives. See the 41x price spread note in
 * `bars.ts`, and the tests proving the dearer model draws the taller bar.
 */

import { renderDailyBars } from "./bars";
import { glyphsFor, type SymbolPreset } from "../glyphs";
import { resolveSeries, type PaletteTheme } from "../palette";
import { truncateToWidth } from "@oh-my-pi/pi-tui/utils";
import type { ThemeColor } from "@oh-my-pi/pi-tui/theme/schema";

/**
 * What an all-zero chart says, byte-identical to the single-series primitive's
 * own empty state. Named here rather than retyped so the two renderings of one
 * state cannot drift apart.
 */
const NO_ACTIVITY = "No activity recorded in this range.";

/** One series' values. Gaps are `0`: a day with no spend is a zero, not a hole. */
export interface SeriesChartSeries {
	/** The series' name, from the route or the IR. Labels the band. */
	label: string;
	/** One value per bucket, oldest first. The same axis for every series. */
	values: readonly number[];
}

export interface SeriesChartOptions {
	/** Columns available. No rendered row may exceed it. */
	width: number;
	/**
	 * Rows for the WHOLE chart, split between the series — not a per-series
	 * allowance. A two-series chart in 8 rows is an 8-row chart.
	 */
	height: number;
	preset: SymbolPreset;
	/** The theme's palette slice. Series hues come from `resolveSeries`. */
	theme: PaletteTheme;
	/**
	 * Applies a series' resolved hue to one line. Injected rather than reached for
	 * from the theme singleton, so this module can be loaded and tested without an
	 * active theme — and so a test can observe which hue reached which series.
	 */
	paint: (color: ThemeColor, text: string) => string;
	/**
	 * Chrome ink: the chart floor, and nothing else. Injected for the same
	 * reason as `paint` — this module must load and test without an active theme
	 * — and SEPARATE from `paint` because the two make different claims.
	 *
	 * It used to pass the series hue as `dim`, so every unfilled cell of every
	 * band wore a DATA colour. That is how a chart of `░` read as measured
	 * values: the web draws nothing in the unplotted part of a plot
	 * (`Chart.tsx:229`) and keeps its floor at `--line-3`.
	 *
	 * Defaults to identity, so the mark-only form the equality tests compare
	 * stays a pure comparison of geometry.
	 */
	dim?: (text: string) => string;
	/**
	 * Whether each band is labelled. Off is the pure-composition form: no labels
	 * means the output is exactly the primitive called once per series, which is
	 * what the equality test compares against. Narrow terminals and callers that
	 * label the chart themselves turn it off.
	 */
	labels?: boolean;
}

/**
 * Rows each series gets, from the whole chart's row budget.
 *
 * A series peaking at a tenth of the loudest gets a tenth of the rows, so band
 * height carries magnitude ACROSS series. That is only half the rule, and the
 * half that was missing is what made the two bands look identical: with peak
 * share alone, a 4%-failure band got one row and then FILLED it, because the
 * primitive inside the band re-scaled against that band's OWN peak. The
 * allocation said the quiet series was quiet and the geometry said it was not,
 * and the geometry is what a reader sees.
 *
 * So the allocation stays AND {@link bandMax} is passed to every band as `max`
 * beside it. Together they reproduce the web's single y-axis
 * (`Chart.tsx:83-98`, where `leftMax` is the maximum over every stackable
 * series): the ROW COUNT carries the cross-series magnitude, and the maximum
 * stops a band over-filling the rows it was handed.
 *
 * The floor of 1 is the same one-cell minimum the renderer's `meterCell`
 * applies: a series that recorded something must not vanish, or "it drew
 * nothing" and "it recorded nothing" become indistinguishable.
 *
 * Rows that do not divide evenly go to NOBODY. Handing the remainder to the
 * last series would make its apparent magnitude a function of its position in
 * the list, which is exactly the kind of quiet lie a chart must not tell.
 *
 * EXPORTED so the composition tests can build the exact expected band for each
 * series. That is deliberate: a test that reimplemented this arithmetic would be
 * a second copy of the rule, and it would agree with a wrong implementation
 * just as readily as with a right one.
 */
export function bandHeights(peaks: readonly number[], budget: number): readonly number[] {
	const shared = peaks.reduce((max, peak) => (peak > max ? peak : max), 0);
	if (budget <= 0) return peaks.map(() => 0);
	return peaks.map(peak => (shared <= 0 ? budget : Math.max(1, Math.round((peak / shared) * budget))));
}

/**
 * The maximum a multi-series chart scales EVERY band against.
 *
 * The peak across all series — `leftMax` in the web's layout pass
 * (`Chart.tsx:98`). Exported because a test asserting a band's geometry has to
 * know the divisor, and re-deriving it in the test would be a second copy of the
 * rule.
 */
export function bandMax(series: readonly SeriesChartSeries[]): number {
	return series.reduce(
		(shared, entry) => entry.values.reduce((peak, value) => (value > peak ? value : peak), shared),
		0,
	);
}

/**
 * N series, one `renderDailyBars` call each.
 *
 * `[]` for no series: a chart with nothing in it must not render a block of
 * blank rows, and the caller's grammar drops an empty band regardless.
 */
export function renderSeriesChart(
	series: readonly SeriesChartSeries[],
	opts: SeriesChartOptions,
): readonly string[] {
	if (series.length === 0) return [];

	const glyphs = glyphsFor(opts.preset);
	const width = Math.max(0, Math.floor(opts.width));
	const dim = opts.dim ?? ((text: string) => text);
	// EVERY series measured zero. There is no peak to scale against, so each band
	// would be a block of blank rows with a floor and nothing else — dead space
	// that reads as a broken chart rather than as a quiet range. The primitive
	// says this in one dim line for a single all-zero series, and the composed
	// chart says the same, so "nothing happened" has exactly one rendering
	// however many series declared it.
	if (series.every(entry => entry.values.every(value => !(value > 0)))) {
		return [dim(truncateToWidth(NO_ACTIVITY, width))];
	}

	const colors = resolveSeries(series.length, opts.theme);
	const labelled = opts.labels !== false;
	// With labels, each band reserves one row for its name. A chart too short to
	// afford labels draws marks only rather than names with no marks.
	const markable = labelled ? opts.height - series.length : opts.height;
	const budget = markable > 0 ? Math.floor(markable / series.length) : 0;
	const rowsEach = bandHeights(
		series.map(entry => entry.values.reduce((max, value) => (value > max ? value : max), 0)),
		budget,
	);
	// ONE divisor for every band. This is the whole point of the module, and it
	// used to be missing: each band re-scaled against its own peak, so a series
	// peaking at a fiftieth of the loudest drew the same shape as the loudest.
	const max = bandMax(series);

	const rows: string[] = [];
	for (const [index, entry] of series.entries()) {
		const color = colors[index] ?? colors[0]!;
		const apply = (text: string) => opts.paint(color, text);
		const height = rowsEach[index] ?? 0;
		if (height > 0) {
			// The band is given `height` rows TOTAL, floor included — see
			// `plotRows` in bars.ts. The floor comes out of the band's budget
			// rather than on top of it, so a four-series chart cannot claim four
			// rows more than the plan gave it.
			//
			// `dim` is CHROME, not this series' hue: the floor belongs to the
			// chart, and painting it in a data colour is what made the old track
			// fill read as measured values.
			rows.push(...renderDailyBars(entry.values, { width, height, max, glyphs, accent: apply, dim }));
		}
		if (labelled) {
			// Padded to the full width so the block stays rectangular: the primitive
			// returns full-width rows, and a short label beside them leaves a ragged
			// right edge for the panel border to cut through.
			rows.push(apply(` ${entry.label}`.slice(0, width).padEnd(width)));
		}
	}
	return rows;
}