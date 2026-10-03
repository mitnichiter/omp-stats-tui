/**
 * The models screen — the per-model view.
 *
 * The overview already ranks models by cost. This screen goes three levels
 * deeper, and each level exists because of something the level above cannot
 * show:
 *
 *   1. RANKING BY COST. Never by tokens. This database reads ~4.04 B cache
 *      tokens for $22.85 against ~2.39 B for $935.72 — a 41x price spread at
 *      comparable volume. A token-scaled bar inverts those two rows and the
 *      reader believes it.
 *   2. WHICH PROVIDER. `opencode-go` and `openai` serve similarly-named models
 *      at prices two orders of magnitude apart. Nothing in a model name says
 *      which card was charged, so the provider is printed on every row.
 *   3. THE TOKEN SPLIT, never a total. This data is ~95% cache-read; a
 *      combined token figure is a number that describes nothing (CONTEXT.md:
 *      "Cache rate", "Cache-read tokens").
 *
 * `needs` is `["modelDashboard", "rollupStatus"]` and nothing more. That is a
 * real constraint, not a preference: see the note on `dailyCost` below.
 */

import type { Screen, ScreenContext } from "./types";
import { statsIcon, ICON_GUTTER, type IconRole } from "../icons";
import {
	costWithUnpriced,
	tokenCells,
	formatInteger,
	formatPercent,
	compactTokens,
	formatCost,
	formatElapsed,
} from "../format";
import { renderRankedBars, renderSparkline, type RankedRow } from "../charts/sparkline";
import { pivotSeries } from "@oh-my-pi/omp-stats/client/data/series";
import type { ModelDashboardPayload } from "../../data/api";
import type { ModelStats } from "@oh-my-pi/omp-stats/client/types";

// G5: this module draws no rule. The `RULE_WIDTH` constant and the `rule()`
// helper that used to sit under every heading are gone — a blank line separates
// sections now, which is what the band grammar prescribes.

/** Ranked models before the host folds the tail into "Other (n)". */
const TOP_MODELS = 8;

/**
 * Zero-total models restored after `pivotSeries` drops them, bounded. At 90d
 * this database has 33 of them and restoring every one produced 36 rows and
 * pushed the ranking off the panel — the same bound overview.ts applies, for
 * the same reason.
 */
const RESTORED = 3;

/** Models given a full detail block. Each block is five rows. */
const DETAIL_MODELS = 3;

/**
 * A trend narrower than this says nothing, so it is dropped whole and the drop
 * is stated. A three-cell sparkline is a decoration pretending to be a chart.
 */
const MIN_TREND_CELLS = 8;

/** Indent before a key/value pair inside a detail block. */
const BLOCK_INSET = 2;

/**
 * Truncate to `width` cells, measured rather than counted. ANSI escapes from a
 * styling callback make `text.length` the wrong measure; bars.ts established
 * this clamp as the standard for every line a module returns.
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
 * Pad to a measured cell width, NOT `String.padEnd`. The unicode icon table
 * mixes 2-cell glyphs stored as one UTF-16 unit with 2-cell glyphs stored as
 * two, so character-count padding drifts by a cell on emoji. Measured padding
 * is the only version that agrees with the terminal.
 */
function padToWidth(text: string, target: number): string {
	const gap = target - Bun.stringWidth(text);
	return gap > 0 ? text + " ".repeat(gap) : text;
}

/**
 * A section heading. The glyph is `statsIcon`'s, never a literal, and no theme
 * is passed: doing so makes `statsIcon` read the live singleton instead of
 * `ctx.preset`, which is how an ascii screen once drew emoji headings.
 */
function heading(ctx: ScreenContext, role: IconRole, label: string): string {
	const icon = padToWidth(statsIcon(ctx.preset, role), ICON_GUTTER[ctx.preset] ?? 0);
	return `${icon} ${label}`;
}

/** The `dim` painter, bound once per call site rather than rebound per row. */
const dim = (ctx: ScreenContext): ((t: string) => string) =>
	ctx.theme.fg.bind(ctx.theme, "dim") as (t: string) => string;

/** Cells between a key and its figure. */
const KEY_GAP = 2;

/**
 * A `key   figure` row inside a detail block. The key column is the plan's
 * `labelWidth`, so every figure starts in the same place down the block.
 */
const keyValue = (ctx: ScreenContext, key: string, figure: string): string =>
	clamp(
		`${" ".repeat(BLOCK_INSET)}${key}${" ".repeat(Math.max(1, ctx.plan.labelWidth - key.length))}${figure}`,
		ctx.plan.innerWidth,
	);

/**
 * A caveat line, or nothing. A caveat narrower than the space it would take is
 * dropped whole rather than cut in half — half a caveat is a claim.
 */
function caveat(ctx: ScreenContext, text: string): readonly string[] {
	return Bun.stringWidth(`${" ".repeat(BLOCK_INSET)}${text}`) > ctx.plan.innerWidth ? [] : [`${" ".repeat(BLOCK_INSET)}${dim(ctx)(text)}`];
}

/**
 * The model ranking.
 *
 * The RANKING IS THE HOST'S. `pivotSeries` owns top-N plus the trailing
 * "Other (n)" fold, and this file deliberately re-sorts nothing: reimplementing
 * the ranking is how a panel's model list stops agreeing with the dashboard's.
 * `renderRankedBars` does the descending sort over an already-ranked set.
 *
 * One host behaviour needs an addition rather than a workaround: `pivotSeries`
 * drops any series whose total is zero, which is exactly the unpriced model —
 * the row the reader most needs to see. So zero-cost models are added back,
 * carrying their request count as the bar value and `N/A` as the readout.
 * `renderRankedBars` already ranks an unpriced row by its unpriced request
 * count, so a heavily-used unpriced model is not buried where the marker would
 * go unseen.
 */
function modelBars(
	ctx: ScreenContext,
	byModel: readonly ModelStats[],
): readonly string[] {
	// One synthetic bucket per model. The axis is a rank order, not time: this
	// is a ranked list, so `pivotSeries` is being used for its ranking policy
	// and its Other-fold, not for its time alignment.
	const points = byModel.map((m, i) => ({
		timestamp: i,
		model: m.model,
		provider: m.provider,
		cost: m.totalCost,
	}));
	const series = pivotSeries(points, {
		buckets: points.map(p => p.timestamp),
		key: p => `${p.model}::${p.provider}`,
		label: key => key.split("::")[0] ?? key,
		value: p => p.cost,
		limit: TOP_MODELS,
	});

	const rows: RankedRow[] = series.map(s => {
		const source = byModel.find(m => `${m.model}::${m.provider}` === s.key);
		// "Other (n)" aggregates models we cannot itemise, so its cost is a real
		// figure and its unpriced count is not knowable — claiming "0 unpriced"
		// would be a claim, so that row states cost alone.
		if (!source) {
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

	const dropped = byModel
		.filter(m => !series.some(s => s.key === `${m.model}::${m.provider}`) && m.totalRequests > 0)
		.sort((a, b) => b.totalRequests - a.totalRequests);
	for (const m of dropped.slice(0, RESTORED)) {
		const cost = costWithUnpriced(m.totalCost, m.unpricedRequests);
		rows.push({
			label: m.model,
			value: m.totalCost,
			unpriced: m.unpricedRequests,
			// Requests beside the money, because a `$0` row with a one-cell bar is
			// indistinguishable from an empty row without them — EXCEPT when the
			// row is unpriced, where `costWithUnpriced` already ends in that same
			// count, and appending it again printed one number twice.
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
	return [
		...bars,
		clamp(
			`${" ".repeat(BLOCK_INSET)}${dim(ctx)(`+ ${dropped.length - RESTORED} more at $0, none of them spend money`)}`,
			ctx.plan.innerWidth,
		),
	];
}

/**
 * Cost by provider.
 *
 * This is the one grouping the reader cannot reconstruct themselves: a model
 * name says nothing about which card was charged, and the same base model
 * behind two providers is the case with the widest price spread in the data.
 * `renderRankedBars` does the descending sort, so nothing is ordered here.
 */
function providerBars(ctx: ScreenContext, byModel: readonly ModelStats[]): readonly string[] {
	const totals: Record<string, { cost: number; unpriced: number; requests: number }> = {};
	for (const m of byModel) {
		if (m.totalRequests <= 0) continue;
		const bucket = (totals[m.provider] ??= { cost: 0, unpriced: 0, requests: 0 });
		bucket.cost += m.totalCost;
		bucket.unpriced += m.unpricedRequests;
		bucket.requests += m.totalRequests;
	}
	const rows: RankedRow[] = Object.entries(totals).map(([provider, t]) => ({
		label: provider,
		value: t.cost,
		unpriced: t.unpriced,
		// A provider with an unpriced model in it has a floor, not a figure, so it
		// says so — the same word `costWithUnpriced` uses one level up. And a row
		// is $0 whenever every model behind it has a zero-price card, which is a
		// wall of identical rows saying nothing: the request count is the one
		// magnitude a $0 row has, so it rides along — unless the row is unpriced,
		// where `costWithUnpriced` already ends in that same count.
		display:
			t.unpriced > 0
				? costWithUnpriced(t.cost, t.unpriced)
				: `${formatCost(t.cost)} · ${formatInteger(t.requests)} req`,
	}));
	if (rows.length <= 1) return [];
	return renderRankedBars(rows, {
		width: ctx.plan.innerWidth,
		preset: ctx.preset,
		accent: ctx.colorFor(3),
		dim: dim(ctx),
	});
}

/**
 * Per-day COST for one model.
 *
 * DEPENDENCY, stated rather than worked around: `/api/stats/model-dashboard`
 * returns `modelSeries` with REQUEST counts only. The per-model cost series
 * (`CostTimeSeriesPoint`, which carries `cost` and `unpricedRequests` per model
 * per day) lives behind `/api/stats/costs`, which this screen does not declare
 * because `needs` is owned by the registry in `types.ts`.
 *
 * So the trend is `requests × the model's own measured average cost per
 * request`, and it is labelled `est.` wherever it appears. That is an estimate
 * and the label says so: a model whose spend grew entirely because it served
 * more requests draws a different shape than one whose per-request price rose,
 * and only a reader who knows it is an estimate can read that difference
 * correctly. When the average cannot be formed — no requests, or a cost of $0
 * with unpriced requests outstanding — the trend is omitted rather than guessed.
 */
function dailyCost(m: ModelStats, series: ModelDashboardPayload["modelSeries"]): number[] | null {
	if (m.totalRequests <= 0) return null;
	if (m.unpricedRequests > 0 && m.totalCost === 0) return null;
	const perRequest = m.totalCost / m.totalRequests;
	const own = series
		.filter(p => p.model === m.model && p.provider === m.provider)
		.map(p => ({ timestamp: p.timestamp, cost: p.requests * perRequest }))
		.sort((a, b) => a.timestamp - b.timestamp);
	return own.map(p => p.cost);
}

/** One model's detail block: who charged it, what it cost, what it read, how it trended. */
function detailBlock(
	ctx: ScreenContext,
	m: ModelStats,
	series: ModelDashboardPayload["modelSeries"],
): readonly string[] {
	const width = ctx.plan.innerWidth;
	const name = `${m.model} · ${m.provider}`;
	const tokens = tokenCells(m);

	// Name and provider sit next to each other on purpose. Right-aligning the
	// provider put 60 cells of gap between two facts that belong together and
	// made the eye read them as separate rows.
	const nameBudget = Math.max(0, width - m.provider.length - 5);
	const out: string[] = [
		clamp(`  ${ctx.colorFor(4)(clamp(m.model, nameBudget))} · ${m.provider}`, width),
		keyValue(ctx, "cost", costWithUnpriced(m.totalCost, m.unpricedRequests)),
		keyValue(
			ctx,
			"requests",
			m.totalRequests > 0
				? `${formatInteger(m.totalRequests)} · ${formatInteger(m.failedRequests)} failed · ${formatPercent(m.errorRate, 2)}`
				: "-",
		),
		// Three cells, never a sum. `cache-write` is neither fresh nor a cache
		// hit and sits outside the cache-rate denominator, so it gets its own
		// line rather than being folded into one of the others.
		keyValue(
			ctx,
			"tokens",
			`fresh ${compactTokens(m.totalInputTokens)} · cache-read ${compactTokens(m.totalCacheReadTokens)} · cache-write ${compactTokens(m.totalCacheWriteTokens)}`,
		),
		m.avgDuration !== null ? keyValue(ctx, "avg", formatElapsed(m.avgDuration)) : keyValue(ctx, "avg", "-"),
	];

	const costs = dailyCost(m, series);
	const label = "trend";
	const labelWidth = ctx.plan.labelWidth;
	const inset = BLOCK_INSET + labelWidth + 1;
	const prefix = `${" ".repeat(BLOCK_INSET)}${label}${" ".repeat(Math.max(1, labelWidth - label.length))}`;

	if (costs === null) {
		out.push(
			clamp(
				`${prefix}${dim(ctx)(
					m.unpricedRequests > 0
						? "no trend — this model's spend could not be measured"
						: "no trend — no daily buckets recorded for this model",
				)}`,
				width,
			),
		);
		return out;
	}

	const peak = Math.max(0, ...costs);
	// A genuinely free model has a real zero-price card, so its cost really is
	// flat at zero — and rule 2 of `renderSparkline` puts that on the baseline
	// rather than dividing by one and painting a full bar. The readout says so
	// in words, because a run of identical marks is ambiguous between "no spend"
	// and "no data", and only one of those is true here.
	const readout = peak > 0 ? `est. ${formatCost(peak)}/day` : "flat at $0/day";
	const cells = Math.min(ctx.plan.sparkWidth, width - inset - readout.length - KEY_GAP);
	if (cells < MIN_TREND_CELLS) {
		// Dropped whole, and said. A three-cell trend is a decoration.
		out.push(clamp(`${prefix}${dim(ctx)(`dropped — ${cells} cells at this width`)}`, width));
		return out;
	}
	out.push(
		clamp(
			`${prefix}${renderSparkline(costs, {
				width: cells,
				max: peak,
				preset: ctx.preset,
			})}  ${readout}`,
			width,
		),
	);
	return out;
}

/**
 * The screen.
 *
 * `needs` is `["modelDashboard", "rollupStatus"]`, unchanged from the registry:
 * this body reads exactly those two and nothing more. See `dailyCost` for the
 * cost-series dependency it works around.
 */
export const modelsScreen: Screen = {
	id: "models",
	label: "Models",
	short: "Models",
	status: "implemented",
	needs: ["modelDashboard", "rollupStatus"],
	render: (ctx): readonly string[] => {
		const width = ctx.plan.innerWidth;
		const dashboard = ctx.data.modelDashboard;
		const byModel = dashboard?.byModel ?? [];
		const series = dashboard?.modelSeries ?? [];

		// EMPTY IS AN HONEST STATE. No payload, or a range in which no model was
		// recorded, is not a screen full of zeroes — a `$0.00` here would claim
		// the spend was free, which is a different and wrong claim.
		if (byModel.length === 0) {
			return [
				heading(ctx, "models", "Models"),
				"",
				clamp(`  ${dim(ctx)(`No models recorded in the last ${ctx.range}.`)}`, width),
				clamp(`  ${dim(ctx)("The database holds no model breakdown for this window.")}`, width),
			];
		}

		// G5: a section is separated by a BLANK LINE, never by a rule. The rule
		// that used to sit under every heading here is the exact regression
		// `band.ts` was written to eliminate ("a stack of text blocks with a `───`
		// rule above every section"). `/usage` draws zero rules inside its body.
		const out: string[] = [heading(ctx, "models", "Models"), ""];

		// --- 1. ranked by cost --------------------------------------------
		out.push(heading(ctx, "cost", `Cost by model (${ctx.range})`), "");
		const bars = modelBars(ctx, byModel);
		if (bars.length === 0) {
			out.push(clamp(`  ${dim(ctx)("No model cost breakdown for this range.")}`, width));
		} else {
			out.push(...bars);
		}
		out.push(
			...caveat(ctx, "ranked by cost — a token-scaled chart inverts this order at this price spread"),
			...caveat(ctx, "N/A means the spend could not be measured; $0 is a real price"),
			"",
		);

		// --- 2. by provider -----------------------------------------------
		const providers = providerBars(ctx, byModel);
		if (providers.length > 0) {
			out.push(
				heading(ctx, "providers", "Cost by provider"),
				"",
				...providers,
				...caveat(ctx, "the same model behind two providers can cost two orders of magnitude apart"),
				"",
			);
		}

		// --- 3. per-model detail ------------------------------------------
		// Ranked by the same rule the bar list uses, then by request count so a
		// heavily-used unpriced model is not skipped in favour of a cheaper one.
		const detail = [...byModel]
			.filter(m => m.totalRequests > 0)
			.sort(
				(a, b) =>
					b.totalCost - a.totalCost ||
					(b.unpricedRequests > 0 ? b.unpricedRequests : b.totalRequests) -
						(a.unpricedRequests > 0 ? a.unpricedRequests : a.totalRequests),
			)
			.slice(0, DETAIL_MODELS);

		out.push(heading(ctx, "models", `Detail — top ${detail.length} by cost`), "");
		if (detail.length === 0) {
			out.push(clamp(`  ${dim(ctx)("No model made a request in this range.")}`, width));
		} else {
			detail.forEach((m, i) => {
				if (i > 0) out.push("");
				out.push(...detailBlock(ctx, m, series));
			});
			out.push(
				...caveat(ctx, "trend is an estimate: daily requests x this model's measured average cost per request"),
				...caveat(ctx, "cache-write is outside the cache rate and is billed separately"),
			);
		}

		// --- 4. staleness (ADR-0006) ---------------------------------------
		// Printed only when non-zero. A "0 dirty hours" footnote on every screen
		// trains the reader to skip the one time it matters, and a MISSING status
		// is unknown rather than clean — so it says nothing rather than claiming
		// zero.
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
