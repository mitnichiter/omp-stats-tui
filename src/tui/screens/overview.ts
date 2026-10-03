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
function heading(ctx: ScreenContext, role: IconRole, label: string): string {
	// Deliberately NO theme argument, though the signature accepts one. Passing
	// `ctx.theme` makes `statsIcon` ignore its own preset argument and return the
	// LIVE singleton's glyph — which is how an ascii screen came to draw emoji
	// headings while its bars correctly degraded to `#` and `.`. `ctx.preset` is
	// the same value `ctx.glyphs` and `ctx.plan` were built from, so all three
	// now agree by construction rather than by the singleton happening to match.
	const icon = statsIcon(ctx.preset, role).padEnd(ICON_GUTTER[ctx.preset] ?? 0);
	return `${icon} ${label}`;
}

/** A dimmed horizontal rule, clamped to the plan's inner width. */
const rule = (ctx: ScreenContext): string =>
	ctx.theme.fg("dim", "─".repeat(Math.max(0, Math.min(ctx.plan.innerWidth, RULE_WIDTH))));

/** The `dim` painter, bound once per call site rather than rebound per row. */
const dim = (ctx: ScreenContext): ((t: string) => string) =>
	ctx.theme.fg.bind(ctx.theme, "dim") as (t: string) => string;

/**
 * One stat cell on a single line: heading glyph, label, figure.
 *
 * The figure arrives already formatted and already unpriced-aware — this module
 * decides what a number MEANS, `format.ts` decides how it is spelled.
 */
const statCell = (ctx: ScreenContext, role: IconRole, label: string, figure: string): string =>
	`${heading(ctx, role, label)} ${figure}`;

/**
 * Pack stat cells into as many rows as the width allows, greedily.
 *
 * Packed by the widest CELL rather than by a heading column: a heading is short
 * and its figure is not, so packing on headings alone truncates exactly the
 * figure that carries the caveat — `$1,039.27 · 34,870 unpriced` cut to
 * `$1,039.27 · 34,870 u`, which is worse than showing no cell at all. A strip
 * whose columns shift with the digit count of each figure is also unreadable at
 * a glance, which is the only thing a stat strip is for — so every cell in a row
 * is padded to the same measured width.
 */
function statStrip(ctx: ScreenContext, cells: readonly string[]): readonly string[] {
	const rows: string[] = [];
	let row = "";
	for (const cell of cells) {
		const withGap = row === "" ? cell : `${row}   ${cell}`;
		if (row !== "" && Bun.stringWidth(withGap) > ctx.plan.innerWidth) {
			rows.push(row);
			row = cell;
			continue;
		}
		row = withGap;
	}
	if (row !== "") rows.push(row);
	return rows.map(r => clamp(r, ctx.plan.innerWidth));
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
			return {
				label: s.label,
				value: s.values.reduce((sum, v) => sum + v, 0),
				display: formatCost(s.values.reduce((sum, v) => sum + v, 0)),
			};
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
	// the top of the ranking off the panel entirely. So: keep the heaviest few by
	// request count (which is the only magnitude a $0 row has) and fold the rest
	// into one trailing line naming how many were folded.
	const dropped = byModel
		.filter(m => !series.some(s => s.key === `${m.model}::${m.provider}`) && m.totalRequests > 0)
		.sort((a, b) => b.totalRequests - a.totalRequests);
	const RESTORED = 3;
	for (const m of dropped.slice(0, RESTORED)) {
		rows.push({
			label: m.model,
			value: m.totalCost,
			unpriced: m.unpricedRequests,
			// Requests beside the money, because a `$0` row with a one-cell bar is
			// indistinguishable from an empty row without them.
			display: `${costWithUnpriced(m.totalCost, m.unpricedRequests)} · ${formatInteger(m.totalRequests)} req`,
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
	// Said rather than implied: the reader is told models exist that they cannot see.
	return [
		...bars,
		clamp(
			`  ${dim(ctx)(`+ ${dropped.length - RESTORED} more at $0, none of them spend money`)}`,
			ctx.plan.innerWidth,
		),
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
			// rate shown alone understates a write-heavy month. Footnoted, not implied.
			clamp(`  ${dim(ctx)("cache share excludes cache writes, which are billed separately")}`, width),
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
				clamp(`  ${dim(ctx)("ranked by cost · N/A means the spend could not be measured")}`, width),
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