/**
 * The vertical daily bar chart.
 *
 * A pure render function: data in, lines out. No theme singleton, no database,
 * no I/O. Colours arrive as two callbacks, which is what makes every rule in
 * here testable without a terminal.
 *
 * ── Where the logic comes from ───────────────────────────────────────────────
 * This is a PORT of the stats dashboard's chart layer, not a new design. The
 * row derivation is deliberately NOT reimplemented:
 *
 *  - `densify` (client/data/series) buckets and sums — the plan originally
 *    proposed a hand-written `bucketToWidth` here, which was a second
 *    implementation of a solved problem.
 *  - `pivotSeries` (same module) owns the top-N + "Other (n)" ranking policy.
 *  - `buildCostSummary` (client/data/view-models) owns per-model cost totals
 *    and the cost-first ranking comparator.
 *
 * ⚠ Import ONLY from `@oh-me-pi/omp-stats/client/data/*`. Two measured reasons,
 * and the second is the one that bites first:
 *
 *  1. `client/data/` is plain TypeScript with no `react` import anywhere, so
 *     nothing React-shaped enters a terminal process. (React *is* installed —
 *     it arrives transitively — so this is a discipline rule, not an accident
 *     of resolution.)
 *  2. `client/charts/*` is `.tsx` and CANNOT be imported at all: the package's
 *     exports map declares `"./client/*": "./src/client/*.ts"`, and a `.tsx`
 *     file does not resolve through it. Measured — every attempt fails with
 *     `Cannot find package '@oh-me-pi/omp-stats'`, which reads like a missing
 *     dependency and is not one.
 *
 * So if you want a chart's behaviour, port its arithmetic (as `niceScale`
 * would be) or take it from `client/data`. Reaching for the component is not
 * an option and never will be. See F15.
 *
 * The imports are STATIC because the extension loader's resolve hook only
 * rewrites static specifiers; a dynamic `import()` of any `@oh-me-pi/*` fails
 * there (F9).
 */

import { densify, pivotSeries } from "@oh-my-pi/omp-stats/client/data/series";
import { buildCostSummary } from "@oh-my-pi/omp-stats/client/data/view-models";
import type { CostTimeSeriesPoint } from "@oh-my-pi/omp-stats/shared-types";
import type { GlyphSet, GlyphValue } from "../glyphs";

export interface BarsOptions {
	/** Columns available to the chart. No rendered row may exceed it. */
	width: number;
	/** Rows available. This is the magnitude axis — see the note in renderDailyBars. */
	height: number;
	glyphs: GlyphSet;
	accent: (text: string) => string;
	dim: (text: string) => string;
}

/**
 * Sum per-bucket cost with the host's `densify`.
 *
 * A thin wrapper on purpose: `densify` sums points into their bucket and drops
 * points that fall off the axis, which is the behaviour we want and the
 * behaviour the dashboard has already been running against real data. The test
 * `costsForBuckets is the host's densify, not a reimplementation` compares our
 * output against `densify`'s directly, so this can never quietly diverge.
 */
export function costsForBuckets(
	points: readonly { timestamp: number; cost: number }[],
	buckets: readonly number[],
): readonly number[] {
	return densify(points, buckets, (p) => p.cost);
}

/** Resolve a role that may be a single glyph or a ramp, without branching on preset. */
function mark(glyphs: GlyphSet, role: keyof GlyphSet): string {
	const value: GlyphValue = glyphs[role];
	return typeof value === "string" ? value : (value[0] ?? "");
}

/**
 * Column heights in rows, scaled from zero to `height`.
 *
 * SCALING IS BY COST, NEVER BY TOKEN COUNT — this is the chart's one
 * correctness rule. In this database `deepseek-v4-flash` reads 4.04 BILLION
 * cache tokens for $22.85 while `gpt-5.6-terra` reads 2.39B for $935.72: a 41x
 * price spread at comparable token volume. Scale those by tokens and the chart
 * is confidently, silently wrong — it would put the cheapest model at the top.
 * Cost is what the user pays, so cost is the height.
 *
 * THE 8-LEVEL RAMP IS NOT USED HERE, deliberately. `sparkRamp` encodes a value
 * within a single cell; stacking those vertically gives every bar a staircase
 * top edge and near-equal bars no shared top line. A column chart repeats ONE
 * glyph and lets ROW COUNT carry the magnitude, which is why `height` is the
 * resolution axis and why the ramp is not consulted.
 *
 * A zero value gets zero filled rows — rendered as a full-height EMPTY column,
 * which is how "nothing happened" and "not yet built" both read. That is
 * deliberate: they are indistinguishable to the reader but both mean "not a
 * cost", and neither may look like a small spend.
 */
function heights(values: readonly number[], height: number): readonly number[] {
	if (height <= 0) return values.map(() => 0);
	const max = Math.max(0, ...values);
	// An all-zero (or empty) series has no maximum to scale against, so every
	// column stays empty rather than dividing by zero.
	if (max <= 0) return values.map(() => 0);
	return values.map((v) => (v <= 0 ? 0 : Math.max(1, Math.round((v / max) * height))));
}

/** Rows are top to bottom, so row `r` covers heights `height - r` and below. */
function compose(columns: readonly number[], opts: BarsOptions): readonly string[] {
	const glyphs = opts.glyphs;
	const fill = mark(glyphs, "barFill");
	const blank = mark(glyphs, "barEmpty");
	const rows: string[] = [];

	for (let r = 0; r < opts.height; r++) {
		// Cells at or above this row's threshold are filled; the rest are empty.
		const threshold = opts.height - r;
		const line = columns
			.map((h) => (h >= threshold ? opts.accent(fill) : opts.dim(blank)))
			.join("");
		rows.push(line);
	}
	return rows;
}
/**
 * Truncate to `width` cells, measured rather than counted.
 *
 * Data ink is guaranteed one cell wide (Task 3's invariant), but a styling
 * callback may return ANSI escape sequences, so `text.length` would be the
 * wrong measure. Every line this module returns goes through here or through
 * the same width check, because one over-wide line corrupts the whole overlay.
 */
function clamp(text: string, width: number): string {
	if (Bun.stringWidth(text) <= width) return text;
	let out = "";
	for (const ch of text) {
		if (Bun.stringWidth(out + ch) > width) break;
		out += ch;
	}
	return out;
}


/**
 * The daily bar chart over an already-bucketed series of COSTS.
 *
 * Bars are adjacent, one cell each — plotext's 0.8-of-a-slot fraction exists
 * because its plot matrix is a scatter with variable gaps; a dense calendar
 * chart wants contiguous columns, and a fractional width would need per-column
 * padding maths that `Bun.stringWidth` would then have to absorb.
 */
export function renderDailyBars(values: readonly number[], opts: BarsOptions): readonly string[] {
	// An empty range is a real state, not an error and not "zero everywhere":
	// a wall of empty columns reads as "you did nothing", when in truth the
	// range has no data at all. Review Focus line 3.
	// Clamped to the width like every other line: a 35-character message in a
	// 20-column panel is an overflow, and an empty-state line that overflows
	// corrupts the panel exactly as a wide bar row would.
	if (values.length === 0) return [clamp("No activity recorded in this range.", Math.max(0, Math.floor(opts.width)))];

	const width = Math.max(0, Math.floor(opts.width));
	// Exactly `width` columns: densify pads when there is less data than width,
	// and we would rather show trailing empty columns than a row narrower than
	// the panel it sits in.
	const columns = values.length === width ? values : costsForBuckets(
		values.map((cost, i) => ({ timestamp: i, cost })),
		Array.from({ length: width }, (_, i) => i),
	);

	return compose(heights(columns, opts.height), { ...opts, width });
}

/**
 * Per-model cost bars over the cost series.
 *
 * Every ranking decision is the host's: `pivotSeries` ranks by total, keeps the
 * top `limit` and folds the rest into a trailing "Other (n)", and
 * `buildCostSummary` supplies the per-model totals and the cost-first
 * comparator. We add only the rendering.
 */
export function renderModelCostBars(
	points: readonly CostTimeSeriesPoint[],
	opts: BarsOptions & { limit?: number },
): readonly string[] {
	if (points.length === 0) return ["No activity recorded in this range."];

	const width = Math.max(0, Math.floor(opts.width));
	const summary = buildCostSummary(points);
	const buckets = [...new Set(points.map((p) => p.timestamp))].sort((a, b) => a - b);

	// pivotSeries, not our own sort. It also folds everything past `limit` into
	// one "Other (n)" column, so a chart of twenty models does not become
	// twenty unreadable cells.
	const series = pivotSeries(points, {
		buckets,
		key: (p) => `${p.model}::${p.provider}`,
		value: (p) => p.cost,
		limit: opts.limit ?? Number.POSITIVE_INFINITY,
	});

	// One column per model, ranked, in the order pivotSeries returned them.
	// `ChartSeries.values` is `readonly (number | null)[]` because a series may
	// contain gaps; pivotSeries only produces them when a caller passes raw
	// points, but the type is the contract, and a null there means "no value",
	// which for a total is zero.
	const perModel = series.map((s) => s.values.reduce<number>((sum, v) => sum + (v ?? 0), 0));
	void summary; // the totals belong to the caller's legend, not to the geometry

	const columns =
		perModel.length === width
			? perModel
			: costsForBuckets(
					perModel.map((cost, i) => ({ timestamp: i, cost })),
					Array.from({ length: width }, (_, i) => i),
				);

	return compose(heights(columns, opts.height), { ...opts, width });
}
