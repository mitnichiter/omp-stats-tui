/**
 * The overview — the landing screen, and the one screen a user actually reads.
 *
 * Four blocks, top to bottom: a stat strip, a token split, the daily cost chart,
 * and the ranked model list. Everything is pure render over `ctx.data`; no fetch,
 * no clock, no terminal. That is what lets test/overview.test.ts sweep 161 widths
 * and what lets `scripts/probe-render.ts` print the screen to stdout for review.
 *
 * ── The two rules this file exists to enforce ───────────────────────────────
 *
 * 1. **BARS SCALE BY COST. NEVER BY TOKENS.** In this database `deepseek-v4-flash`
 *    reads 1.1B cache tokens for $22.85 while `gpt-5.6-terra` reads 2.39B for
 *    $935.72. A token-scaled chart confidently puts the cheapest model on top.
 *    Every `value` fed to a bar here is money.
 *
 * 2. **NO BARE COMBINED TOKEN TOTAL, EVER.** 95% of this person's tokens are
 *    cache-read, so "24B tokens" is arithmetically true and informationally
 *    empty. Fresh, cache-read and cache-write are always three separate cells
 *    (CONTEXT.md: "Fresh tokens", "Cache-read tokens", "Cache-write tokens").
 *
 * Every line goes through `clamp`. One over-wide line corrupts the whole overlay,
 * and a styling callback may return ANSI escapes, so width is measured with
 * `Bun.stringWidth`, never `.length`.
 */

import type { Screen, ScreenContext } from "./types";
import { statsIcon, ICON_GUTTER, type IconRole } from "../icons";
import {
	costWithUnpriced,
	tokenCells,
	cacheShare,
	formatInteger,
	formatPercent,
	compactTokens,
	formatCost,
} from "../format";
import { renderDailyBars, costsForBuckets } from "../charts/bars";
import { renderRankedBars, type RankedRow } from "../charts/sparkline";
import { pivotSeries } from "@oh-my-pi/omp-stats/client/data/series";
import type { ModelDashboardPayload } from "../../data/api";
import { bucketCountFor } from "../../data/ranges";

/** Longest rule this module draws, so a 200-cell panel is not full-bleed. */
const RULE_WIDTH = 60;

/** Ranked models to show before the host folds the rest into "Other (n)". */
const TOP_MODELS = 6;

/** Milliseconds in the bucket the daily chart groups by. */
const DAY_MS = 86_400_000;

/**
 * Truncate to `width` cells, measured rather than counted. ANSI escapes from a
 * styling callback make `text.length` the wrong measure, and bars.ts already
 * established this clamp as the standard for every line a module returns.
 */
function clamp(text: string, width: number): string {
	if (width <= 0) return "";
	if (Bun.stringWidth(text) <= width) return text;
	let out = "";
	for (const ch of text) {
		if (Bun.stringWidth(out + ch) > width) break;
		out += ch;
	}
	return out;
}

/**
 * A section heading. The glyph is `statsIcon`'s, never a literal — a hand-written
 * heading glyph is a preset bug waiting to happen, because the ASCII preset has
 * no emoji and the nerd preset's PUA characters measure 1 cell where emoji
 * measure 2. `ICON_GUTTER` is what keeps every heading starting in one column.
 */
/**
 * Pad to a measured cell width.
 *
 * NOT `String.padEnd`, which pads by CHARACTER COUNT. The unicode icon table
 * mixes 2-cell glyphs stored as one UTF-16 unit with 2-cell glyphs stored as
 * two, so a one-character emoji already measuring two cells was handed a
 * spurious extra space while its two-character neighbour was left alone. That
 * one-cell drift is what broke the stat-strip grid. Measured padding is the
 * only version that agrees with the terminal.
 */
function padToWidth(text: string, target: number): string {
	const gap = target - Bun.stringWidth(text);
	return gap > 0 ? text + " ".repeat(gap) : text;
}

function heading(ctx: ScreenContext, role: IconRole, label: string): string {
	// Deliberately NO theme argument, though the signature accepts one. Passing
	// `ctx.theme` makes `statsIcon` ignore its own preset argument and return the
	// LIVE singleton's glyph — which is how an ascii screen came to draw emoji
	// headings while its bars correctly degraded to `#` and `.`. `ctx.preset` is
	// the same value `ctx.glyphs` and `ctx.plan` were built from, so all three
	// now agree by construction rather than by the singleton happening to match.
	const icon = padToWidth(statsIcon(ctx.preset, role), ICON_GUTTER[ctx.preset] ?? 0);
	return `${icon} ${label}`;
}

/** A dimmed horizontal rule, clamped to the plan's inner width. */
const rule = (ctx: ScreenContext): string =>
	ctx.theme.fg("dim", "─".repeat(Math.max(0, Math.min(ctx.plan.innerWidth, RULE_WIDTH))));

/** The `dim` painter, bound once per call site rather than rebound per row. */
const dim = (ctx: ScreenContext): ((t: string) => string) =>
	ctx.theme.fg.bind(ctx.theme, "dim") as (t: string) => string;

/** One stat cell as [heading, figure]. */
const statCell = (ctx: ScreenContext, role: IconRole, label: string, figure: string): readonly [string, string] => [
	heading(ctx, role, label),
	figure,
];

/** Cells in one row, in cells. A grid needs a gutter between columns. */
const CELL_GAP = 3;

/** Cells between a heading and its own figure inside one cell. */
const FIGURE_GAP = 1;

/**
 * The stat strip, as a GRID with a right-aligned figure column.
 *
 * Each row pads its cells to a common width and its figures to end at that same
 * column — the same convention `renderRankedBars` uses for the model list, so
 * the two ranked blocks on one screen agree. The previous version joined whole
 * cells with three spaces and let them fall where they fell, which put the four
 * figures at columns 11, 27, 51 and 73: no two comparable, and the strip wrapped
 * raggedly at width 60.
 *
 * A cell is never split across rows. When the width cannot hold them side by
 * side the strip drops to fewer per row, so a figure is always whole on one
 * line: a number wrapped mid-digits reads as two numbers, and the cost cell
 * carries the unpriced caveat, so a truncated one would read as the whole bill.
 */
function statStrip(ctx: ScreenContext, cells: readonly (readonly [string, string])[]): readonly string[] {
	const width = (s: string) => Bun.stringWidth(s);

	// Chunk cells into rows by SIMULATING each row, not by summing each cell's
	// own width. A row's column is the max over the cells it holds, so adding a
	// wide cell re-widens every cell already in the row. Summing per-cell widths
	// under-counted that, packed cost beside requests at width 60, and the row
	// came out 79 cells wide in a 56-cell panel — clamping `$1,039.27 · 34,870
	// unpriced` down to `$1`.
	const columnFor = (chunk: readonly number[]) => {
		const heading = Math.max(...chunk.map(i => width(cells[i]![0])));
		return heading + FIGURE_GAP + Math.max(...chunk.map(i => width(cells[i]![1])));
	};
	const rowWidth = (chunk: readonly number[]) =>
		chunk.length * columnFor(chunk) + (chunk.length - 1) * CELL_GAP;

	const chunks: number[][] = [];
	let current: number[] = [];
	cells.forEach((_, i) => {
		if (current.length > 0 && rowWidth([...current, i]) > ctx.plan.innerWidth) {
			chunks.push(current);
			current = [i];
			return;
		}
		current.push(i);
	});
	if (current.length > 0) chunks.push(current);

	return chunks.map(chunk => {
		// EQUAL-WIDTH COLUMNS, which is what makes this a grid rather than a run
		// of sentences. Every cell occupies the same number of cells, so each
		// figure sits at the same offset inside its column and consecutive figures
		// are spaced by exactly one column plus one gutter — regular, which is the
		// property the eye can actually use.
		//
		// Note what is NOT claimed: the figures do not share one absolute column
		// and cannot, because cell i starts at i x (column + gutter). Only the
		// row's last cell reaches the right edge; the ones before it sit at even
		// intervals from it. That is a grid. Right-aligning every figure to a
		// single absolute column is only possible when a row holds ONE cell, which
		// is the model list's shape and not a strip's.
		const headingWidth = Math.max(...chunk.map(i => width(cells[i]![0])));
		const column = columnFor(chunk);
		const line = chunk
			.map(i => {
				const [head, figure] = cells[i]!;
				return padToWidth(padToWidth(head, headingWidth) + " ".repeat(FIGURE_GAP) + figure, column);
			})
			.join(" ".repeat(CELL_GAP))
			.trimEnd();
		// A single cell can still exceed the panel on its own — the cost figure
		// carries the unpriced suffix and is the widest string here — so the last
		// word is `clamp`, not trust.
		return clamp(line, ctx.plan.innerWidth);
	});
}

/**
 * A caveat line, or nothing.
 *
 * Below the width at which the whole sentence fits, it returns an empty string
 * rather than a truncated one. A half-sentence about cache-write billing is
 * worse than no sentence: the reader cannot tell it was cut, so they either
 * act on the fragment or assume the caveat does not apply.
 */
function caveat(ctx: ScreenContext, text: string): readonly string[] {
	const indented = `  ${dim(ctx)(text)}`;
	return Bun.stringWidth(indented) > ctx.plan.innerWidth ? [] : [indented];
}

/**
 * A `label   value` row. The label column is the plan's, so values start in the
 * same place on every screen and the eye can run down one column.
 */
const keyValue = (ctx: ScreenContext, label: string, value: string): string =>
	clamp(`  ${label}${" ".repeat(Math.max(1, ctx.plan.labelWidth - label.length))}${value}`, ctx.plan.innerWidth);

/**
 * The ranked model list.
 *
 * The RANKING IS THE HOST'S. `pivotSeries` (client/data/series) owns top-N plus
 * the trailing "Other (n)" fold, and this file deliberately re-sorts nothing:
 * reimplementing the ranking is how a panel's model list stops agreeing with the
 * dashboard's. `renderRankedBars` does the descending sort over the rows it is
 * handed, which is presentation over an already-ranked set.
 *
 * One host behaviour needs an explicit addition rather than a workaround:
 * `pivotSeries` drops any series whose total is zero, which is exactly the
 * unpriced model — the row the user most needs to see (CONTEXT.md: "Unpriced
 * request"). So unpriced models are added back, carrying their request count as
 * the bar value and `N/A` as the readout. `renderRankedBars` already ranks an
 * unpriced row by request count rather than by its zero cost, so a heavily-used
 * unpriced model is not buried where nobody would see the marker.
 */
function topModels(
	ctx: ScreenContext,
	dashboard: ModelDashboardPayload | undefined,
): readonly string[] {
	const byModel = dashboard?.byModel ?? [];
	if (byModel.length === 0) return [];

	// One synthetic bucket per model. The axis is a rank order, not time: this is
	// a ranked list, so `pivotSeries` is being used for its ranking policy and its
	// Other-fold, not for its time alignment.
	const points = byModel.map((m, i) => ({ timestamp: i, model: m.model, provider: m.provider, cost: m.totalCost }));
	const series = pivotSeries(points, {
		buckets: points.map(p => p.timestamp),
		key: p => `${p.model}::${p.provider}`,
		label: key => key.split("::")[0] ?? key,
		value: p => p.cost,
		limit: TOP_MODELS,
	});

	// Every ranked row shows a MONEY readout. `renderRankedBars` falls back to
	// `formatInteger` when a row carries neither `display` nor a positive
	// `unpriced`, which paints `$76.80` as `76.801` — a cost read as a count.
	const rows: RankedRow[] = series.map(s => {
		const source = byModel.find(m => `${m.model}::${m.provider}` === s.key);
		// "Other (n)" aggregates models we cannot itemise, so its cost is a real
		// figure and its unpriced count is not knowable — claiming "0 unpriced"
		// would be a claim, so that row states cost alone.
		if (!source) {
			// `ChartSeries.values` is `(number | null)[]` because a series may carry
			// gaps; pivotSeries only produces them for raw points, but the type is
			// the contract, and a null in a total is a measured zero.
			const total = s.values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
			return { label: s.label, value: total, display: formatCost(total) };
		}
		return {
			label: s.label,
			value: source.totalCost,
			unpriced: source.unpricedRequests,
			display: costWithUnpriced(source.totalCost, source.unpricedRequests),
		};
	});
	// Models `pivotSeries` dropped for having a zero total, restored — but BOUNDED,
	// or restoring them defeats the very policy that dropped them. At 90d this
	// database has 33 such models, and adding every one produced 36 rows and pushed
	// the top of the ranking off the panel entirely.
	//
	// RANKED WITH UNPRICED FIRST, NOT BY REQUEST COUNT ALONE. Two populations land
	// here and they are not the same kind of row: a genuinely free model, and a
	// model whose spend was never determined. Ranking by requests alone let four
	// free models (36,496 / 7,212 / 6,213 / 4,263 requests) push
	// `gemini-3.7-flash-high` — 4,205 requests, spend UNKNOWN — out of a list
	// capped at 3, so the one row the user most needs vanished from the panel.
	// Unknown spend outranks free spend, which is the same rule `renderRankedBars`
	// applies when it ranks a row by its unpriced count rather than by its zero cost.
	const dropped = byModel
		.filter(m => !series.some(s => s.key === `${m.model}::${m.provider}`) && m.totalRequests > 0)
		.sort((a, b) => {
			const aUnpriced = a.unpricedRequests > 0 ? 1 : 0;
			const bUnpriced = b.unpricedRequests > 0 ? 1 : 0;
			return bUnpriced - aUnpriced || b.totalRequests - a.totalRequests;
		});
	const RESTORED = 3;
	for (const m of dropped.slice(0, RESTORED)) {
		// Requests beside the money, because a `$0` row with a one-cell bar is
		// indistinguishable from an empty row without them — EXCEPT when the row is
		// unpriced, where `costWithUnpriced` already ends in that same request
		// count. Appending it again printed one number twice under two labels,
		// which reads as a rendering bug even though it is not one.
		const cost = costWithUnpriced(m.totalCost, m.unpricedRequests);
		rows.push({
			label: m.model,
			value: m.totalCost,
			unpriced: m.unpricedRequests,
			display: m.unpricedRequests > 0 ? cost : `${cost} · ${formatInteger(m.totalRequests)} req`,
		});
	}

	if (rows.length === 0) return [];
	const bars = renderRankedBars(rows, {
		width: ctx.plan.innerWidth,
		preset: ctx.preset,
		accent: ctx.colorFor(1),
		dim: dim(ctx),
	});
	if (dropped.length <= RESTORED) return bars;
	// The count of folded models that are NOT simply free. "none of them spend
	// money" is a claim about every folded row, and it became false the moment a
	// no-card model was folded: its spend is unknown, not zero. The note says
	// which it is rather than smoothing over the difference.
	const folded = dropped.slice(RESTORED);
	const unpricedFolded = folded.filter(m => m.unpricedRequests > 0);
	const tail =
		unpricedFolded.length === 0
			? `+ ${folded.length} more at $0, none of them spend money`
			: `+ ${folded.length} more at $0, ${formatInteger(
					unpricedFolded.reduce((sum, m) => sum + m.unpricedRequests, 0),
				)} of them unpriced`;
	return [
		...bars,
		clamp(`  ${dim(ctx)(tail)}`, ctx.plan.innerWidth),
	];
}

/**
 * The screen.
 *
 * `needs` is the real data contract and it changed with the body: the ranked
 * model list reads `/api/stats/model-dashboard`, which the placeholder body never
 * fetched because it had nothing to rank.
 */
export const overviewScreen: Screen = {
	id: "overview",
	label: "Overview",
	short: "Overview",
	status: "implemented",
	// `rollupStatus` is here for ADR-0006: above 96 dirty hours the host stops
	// unioning dirty hours with the facts and returns rows with holes in them, so
	// a panel that cannot report its own staleness presents not-yet-built hours as
	// $0.00. Declaring it is the first half; the footer below is the second.
	needs: ["overview", "modelDashboard", "rollupStatus"],
	render: (ctx): readonly string[] => {
		const width = ctx.plan.innerWidth;
		const overall = ctx.data.overview?.overall;
		const series = ctx.data.overview?.timeSeries ?? [];

		// EMPTY IS AN HONEST STATE. No payload, or a range in which nothing was
		// recorded, is not a screen full of zeroes — zeroes read as "you did
		// nothing, cheaply", which is a different and wrong claim.
		if (!overall || overall.totalRequests === 0) {
			return [
				heading(ctx, "cost", "Overview"),
				rule(ctx),
				`  ${dim(ctx)(`No usage recorded in the last ${ctx.range}.`)}`,
				`  ${dim(ctx)("The database holds no requests in this window.")}`,
			];
		}

		const share = cacheShare(overall.totalInputTokens, overall.totalCacheReadTokens);
		const tokens = tokenCells(overall);
		const out: string[] = [heading(ctx, "cost", "Overview"), rule(ctx), ""];

		// --- 1. stat strip -------------------------------------------------
		// Cost rides costWithUnpriced, so `$1,039.27 · 34,870 unpriced` is one
		// honest cell rather than a total that silently excludes a third of the
		// requests.
		out.push(
			...statStrip(ctx, [
				statCell(ctx, "requests", "requests", formatInteger(overall.totalRequests)),
				statCell(ctx, "cost", "cost", costWithUnpriced(overall.totalCost, overall.unpricedRequests)),
				statCell(
					ctx,
					"errors",
					"error rate",
					overall.failedRequests > 0 ? formatPercent(overall.errorRate, 2) : "none",
				),
				statCell(ctx, "cache", "cache share", formatPercent(share)),
			]),
			"",
		);

		// --- 2. token split ------------------------------------------------
		// Five separate rows, never a sum. `cacheShare` is recomputed from the raw
		// counts rather than read off the aggregate, so this screen states the same
		// number the glossary defines rather than trusting a field it cannot audit.
		out.push(
			heading(ctx, "tokens", "Tokens"),
			rule(ctx),
			keyValue(ctx, "fresh", tokens.fresh),
			keyValue(ctx, "cache-read", tokens.cacheRead),
			keyValue(ctx, "cache-write", tokens.cacheWrite),
			keyValue(ctx, "cache share", `${formatPercent(share)} of input`),
			keyValue(ctx, "output", compactTokens(overall.totalOutputTokens)),
			// Cache writes sit outside the cache-rate denominator by definition, so a
			// rate shown alone understates a write-heavy month. Footnoted, not implied,
			// and dropped whole rather than cut when the width cannot hold it.
			...caveat(ctx, "cache share excludes cache writes, which are billed separately"),
			"",
		);

		// --- 3. daily cost chart -------------------------------------------
		// `bucketCountFor` is the host's own count for this range, clamped to the
		// columns available: a narrow terminal shows the same window at coarser
		// buckets rather than a truncated one.
		const columns = bucketCountFor(ctx.range, width);
		const end = Math.floor(Date.now() / DAY_MS) * DAY_MS;
		const buckets = Array.from({ length: columns }, (_, i) => end - (columns - 1 - i) * DAY_MS);
		const dailyCost = costsForBuckets(
			series.map(p => ({ timestamp: p.timestamp, cost: p.cost })),
			buckets,
		);

		// A cost series that is entirely $0 gets no chart. Ninety-six columns of
		// empty track is not a chart of "no spend", it is a chart that cannot say
		// whether the data is missing or the spend was free — and a free-tier
		// account hits exactly this case. Say it in words instead.
		const peak = Math.max(0, ...dailyCost);
		if (peak <= 0) {
			out.push(
				heading(ctx, "cost", `Cost per day (${ctx.range})`),
				rule(ctx),
				clamp(
					`  ${dim(ctx)(
						overall.unpricedRequests > 0
							? "No cost could be measured in this range."
							: "No cost was recorded in this range.",
					)}`,
					width,
				),
				"",
			);
		} else {
			out.push(
				heading(ctx, "cost", `Cost per day (${ctx.range})`),
				rule(ctx),
				...renderDailyBars(dailyCost, {
					width,
					height: Math.max(3, Math.min(ctx.plan.barHeight, 10)),
					glyphs: ctx.glyphs,
					accent: ctx.colorFor(2),
					dim: dim(ctx),
				}),
				clamp(`  peak ${dim(ctx)(formatCost(peak))} per day`, width),
				"",
			);
		}

		// --- 4. ranked models ----------------------------------------------
		const models = topModels(ctx, ctx.data.modelDashboard);
		out.push(heading(ctx, "models", "Cost by model"), rule(ctx));
		if (models.length === 0) {
			out.push(clamp(`  ${dim(ctx)("No model breakdown for this range.")}`, width));
		} else {
			out.push(
				...models,
				...caveat(ctx, "ranked by cost · N/A means the spend could not be measured"),
			);
		}
		// --- 5. staleness (ADR-0006) ---------------------------------------
		// Printed only when it is non-zero. A "0 dirty hours" footnote on every
		// screen is noise that trains the reader to skip the one time it matters,
		// and a MISSING status is unknown rather than clean, so it says nothing at
		// all rather than claiming zero.
		const rollup = ctx.data.rollupStatus;
		if (rollup && rollup.dirtyHours > 0) {
			out.push(
				"",
				clamp(
					`  ${heading(ctx, "warning", "")} ${ctx.theme.fg(
						"error",
						`${formatInteger(rollup.dirtyHours)} dirty hours not yet built`,
					)}`,
					width,
				),
				clamp(
					`  ${dim(ctx)(
						rollup.dirtyHours > 96
							? "figures above may have gaps in them"
							: "figures above are being rebuilt and will settle",
					)}`,
					width,
				),
			);
		}

		return out;
	},
};