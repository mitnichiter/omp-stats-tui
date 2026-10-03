/**
 * `src/tui/render/screen.ts` — one `ScreenSpec` to rendered terminal lines.
 *
 * THIS IS THE SEAM THE WHOLE IR EXISTS TO REACH. Three hand-written screens each
 * invented their own visual structure, so consistency was something a reviewer
 * had to notice and a fourth screen would have had to reinvent. Here a screen is
 * DATA (`spec.ts`), the grammar is ONE function (`band.ts`), and this module is
 * the only place the two meet. Nothing below makes a layout decision: it turns
 * refs into formatted strings and hands bands to `renderBands`, which owns every
 * column width, every blank line, and the rule that a body may not draw a rule.
 *
 * ── What this module owns, and why it is not more ───────────────────────────
 *
 * Formatting. `MetricRef` deliberately does not say how a value reads, so
 * something has to. {@link FIELD_FORMAT} maps a payload field to the formatter
 * that makes it honest, and it is the whole reason "a $0.00 beside 4,359
 * unpriced requests" cannot happen here: a cost field goes through
 * `costWithUnpriced`, the single implementation of that rule in the project, and
 * a token field goes through a compact formatter, which is why the four token
 * kinds never collapse into one figure that is 95.5% cache reads.
 *
 * ── The four rules that are not formatting, and are therefore stated ─────────
 *
 *  1. **A band that resolves to nothing contributes nothing.** G4 in `band.ts`
 *     drops an empty band and leaves no gap behind it; this module is what makes
 *     a band empty. No rows, no tile with a value, no plottable series. The
 *     alternative — a heading over nothing — produces a screen that looks
 *     finished and shows no data.
 *
 *  2. **A multi-series bar chart draws one block per series and never sums
 *     them.** The IR declares `costs`' daily estimate as four cost COMPONENTS
 *     and `overview`'s activity as requests plus errors, where errors are a
 *     SUBSET of requests. Stacking the first is right; stacking the second
 *     overstates the total by the error rate. The IR carries no rule that tells
 *     them apart, so this renderer refuses to guess: each series gets its own
 *     block, the per-series height splits the band so a four-component chart is
 *     the same height as a one-series chart, and the paired `legend` band names
 *     the parts.
 *
 *  3. **A citation is not a subtitle.** `band.source` records where the port
 *     came from, for a reviewer diffing it against the route. Printing
 *     `OverviewRoute.tsx:247-273` on a terminal is developer-facing text in the
 *     user's face, so the renderer substitutes a human axis label for it.
 *
 *  4. **A meter cell draws a bar and no number.** The table already has a column
 *     for the figure; a meter that printed its own number would read as two
 *     numbers and invite the reader to compare them.
 *
 * PURE AND INJECTED. No theme singleton — `fg` and `bold` are injected — no
 * `Date.now()` (the axis reads `now`), no database, no terminal. Every screen
 * therefore renders headless at any width, which is what
 * `test/render-screen.test.ts` does across 40–200 columns × three presets ×
 * nine screens, and what `scripts/probe-render.ts` does for a human.
 */

import { bucketAxis } from "@oh-my-pi/omp-stats/client/data/range";
import type { ThemeColor } from "@oh-my-pi/pi-tui/theme/schema";
import { truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui/utils";

import type { PanelData } from "../../data/api";
import {
	isFetched,
	resolveCell,
	resolveNumber,
	resolveSeriesValues,
	rowsFor,
	sharedDenominator,
	type DataRow,
} from "../../layout/resolve";
import { bucketMsFor, type Range } from "../../data/ranges";
import { sourceOf } from "../../layout/spec";
import type {
	Band as IRBand,
	ChartSpec,
	Column as IRColumn,
	LegendItem as IRLegendItem,
	MetricRef,
	MetricSource,
	RowSource,
	ScreenSpec,
	StatTile as IRStatTile,
} from "../../layout/spec";
import { renderBands, type Band, type BandRenderOptions } from "../band";
import { renderSeriesChart } from "../charts/compose";
import { renderHeatmap, weeksForWidth } from "../charts/heatmap";
import { renderRankedBars, renderShareBar, renderSparkline, type RankedRow } from "../charts/sparkline";
import {
	costWithUnpriced,
	formatCost,
	formatDurationMs,
	formatElapsed,
	formatInteger,
	formatPercent,
} from "../format";
import { glyph, glyphsFor, type GlyphSet, type SymbolPreset } from "../glyphs";
import type { LayoutPlan } from "../layout";
import { PALETTE, heatRamp, type PaletteTheme } from "../palette";

/** Bucket width of `costSeries`, in ms. DAY for every range — see `bucketedValues`. */
const COST_BUCKET_MS = 24 * 60 * 60 * 1000;

/** Weekday-label gutter for the heatmap, in cells. Two, for `M ` / `W `. */
const HEAT_LABEL_WIDTH = 2;

/** What a chart heading's meta reads when the IR supplied only a citation. */
const AXIS_LABEL: Record<ChartSpec["axis"], string> = {
	cost: "per day, by billing component",
	requests: "requests per bucket",
	tokens: "tokens per bucket",
	count: "calls per bucket",
	share: "share of the total",
	time: "over the range",
};

/**
 * The payload field each grouped source is keyed by.
 *
 * A `shareBar` or `rankedBars` needs a LABEL for every value it plots, and the
 * IR names a `groupBy` only when the grouping is itself part of the fact shown.
 * Where it does not, the dimension is still unambiguous from the route: one row
 * per model, per folder, per tool. A source missing from this table has its rows
 * grouped by nothing and its chart is skipped rather than drawn unlabelled.
 */
const GROUP_KEY: Partial<Record<MetricSource, string>> = {
	byModel: "model",
	modelSeries: "model",
	modelPerformanceSeries: "model",
	costSeries: "model",
	folders: "folder",
	toolsByTool: "tool",
	toolsByToolModel: "tool",
	toolsSeries: "tool",
};

// ─── The option bag ──────────────────────────────────────────────────────────

/**
 * Everything one screen needs to render. The theme arrives as two injected
 * callbacks rather than as an object, so this module can never hold a reference
 * to the singleton the extension loader has not created yet.
 */
export interface ScreenRenderOptions {
	spec: ScreenSpec;
	data: PanelData;
	plan: LayoutPlan;
	preset: SymbolPreset;
	range: Range;
	/** Injected clock. The bucket axis is derived from it, never from `Date.now()`. */
	now: number;
	fg: (color: ThemeColor, text: string) => string;
	bold: (text: string) => string;
	seriesColorFor?: (index: number) => ThemeColor;
	/**
	 * The palette's own slice of a `Theme`. Injected rather than imported because
	 * `heatRamp` resolves real hex values, and a renderer that reached for the
	 * singleton would both crash at extension load and freeze whichever theme
	 * happened to be active while the module loaded.
	 */
	palette: PaletteTheme;
	/** Injected "today" for the heatmap's `null` future cells. */
	today?: Date;
	glyphs?: GlyphSet;
	/**
	 * The shares every `shareBar` ABOVE this band published, in band order, so a
	 * legend adopts them rather than re-deriving the same number. Populated by
	 * {@link screenBands} on the way through; callers never set it.
	 */
	publishedShares?: readonly ReadonlyMap<string, number>[];
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/** Turns one resolved value into the text a cell shows. */
type Formatter = (value: number, row: DataRow | undefined) => string;

const count = (value: number | string | null): number | null =>
	typeof value === "number" ? value : null;

/**
 * The unmeasured-request count a row carries, or `null` when it carries none.
 *
 * Two shapes exist because two payloads do: an aggregate row has a real
 * `unpricedRequests` count, while a request row has only the boolean
 * `costUnpriced` that `rowToMessageStats` sets. Reading a count out of that
 * boolean would print "1 unpriced" for each of 4,197 requests and understate
 * the gap by three orders of magnitude.
 */
function unpricedOf(row: DataRow | undefined): number | null {
	if (!row) return null;
	const record = row as Record<string, unknown>;
	if (typeof record.unpricedRequests === "number") return record.unpricedRequests;
	return record.costUnpriced === true ? 1 : null;
}

/**
 * A money figure for a CELL: the cost, and the unmeasured requests beside it.
 *
 * This is the rule the whole panel is built around. `$0.00` beside 4,359
 * unpriced requests reads as a bargain or as a bug; it is neither — it is money
 * nobody has measured. The count is read off the SAME ROW rather than from the
 * screen total, because a folder's row and the overall aggregate carry different
 * populations and only the row is the one being printed.
 */
const cellCost: Formatter = (value, row) => {
	const unpriced = unpricedOf(row);
	return unpriced === null ? formatCost(value) : costWithUnpriced(value, unpriced);
};

/**
 * A money figure for a STAT TILE, where the unpriced count is the hint.
 *
 * The suffix `cellCost` appends is dropped here because the tile's hint already
 * names the same number from the same row, and a tile reading "N/A · 4,359
 * unpriced" beside a hint reading "4,359" would print the caveat twice. What
 * survives is the one thing a bare figure must never do: claim a zero price for
 * spend nobody has measured.
 */
const tileCost: Formatter = (value, row) => {
	const unpriced = unpricedOf(row);
	return value === 0 && unpriced !== null && unpriced > 0 ? "N/A" : formatCost(value);
};

/** Compact notation: `1.2B` is readable where `1,204,000,000` wraps the row. */
const compact: Formatter = value =>
	value < 1000 ? formatInteger(value) : value.toLocaleString("en-US", { notation: "compact" });

/** A fraction as a percentage. An absent fraction is blank, never `NaN%`. */
const percent: Formatter = value => formatPercent(value);

/** Raw seconds with the adapter's precision: `12.3s`. */
const duration: Formatter = value => formatDurationMs(value);

/** A MEAN duration reads as a span: `12.3s` is not what "average" means. */
const elapsed: Formatter = value => formatElapsed(value);

/**
 * A rate of throughput keeps its unit. A bare `61` next to "Tokens/s" in a
 * separate cell would be a quantity; `61/s` is a rate.
 */
const speed: Formatter = value => `${formatInteger(Math.round(value))}/s`;

/**
 * An unpriced COUNT only carries information when it is non-zero, so it says
 * "4,359 unpriced" or a plain "0" and never "0 unpriced".
 */
const unpricedCount: Formatter = value => (value > 0 ? `${formatInteger(value)} unpriced` : "0");

/**
 * Premium requests is a multiplier (1.5×), not a count, so it keeps its
 * decimals where every other count in this table is an integer.
 */
const premium: Formatter = value =>
	value === 0 ? "0" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * The payload field → formatter table. This IS the "how it reads" half of the
 * IR, and it is keyed on the field names the routes actually use.
 *
 * A field absent from this table is not silently blank: it falls through to
 * {@link formatValue}'s grouped-integer default, so a newly added payload field
 * shows up as a plausible figure rather than as an empty cell, and the leak walk
 * in `test/render-screen.test.ts` catches it if the type was wrong.
 */
const FIELD_FORMAT: Readonly<Record<string, Formatter>> = {
	// Money. `totalCost`/`cost` are what the tiles and the ranked bars print; the
	// four `cost*` fields are the daily-estimate breakdown and must not be summed
	// into one figure by this table — `band.ts` stacks them as separate blocks.
	totalCost: cellCost,
	cost: cellCost,
	"usage.cost.total": cellCost,
	costInput: cellCost,
	costOutput: cellCost,
	costCacheRead: cellCost,
	costCacheWrite: cellCost,

	// Token counts, kept as four separate cells by design.
	totalInputTokens: compact,
	totalOutputTokens: compact,
	totalCacheReadTokens: compact,
	totalCacheWriteTokens: compact,
	totalTokensShare: compact,
	outputTokensShare: compact,
	tokens: compact,
	"usage.totalTokens": compact,
	"usage.input": compact,
	"usage.output": compact,
	"usage.cacheRead": compact,
	"usage.cacheWrite": compact,

	// Counts.
	totalRequests: formatInteger,
	requests: formatInteger,
	successfulRequests: formatInteger,
	failedRequests: formatInteger,
	unpricedRequests: unpricedCount,
	unpricedRequestsShare: formatInteger,
	calls: formatInteger,
	errors: formatInteger,
	resultChars: compact,
	argsChars: compact,
	unpriced: formatInteger,
	loaded: formatInteger,
	failed: formatInteger,
	premiumRequests: formatInteger,
	totalPremiumRequests: premium,
	dirtyHours: formatInteger,
	dirtySessions: formatInteger,

	// Rates. A rate with no `%` reads as a quantity.
	cacheRate: percent,
	errorRate: percent,
	cacheSavings: percent,
	share: percent,
	avgResult: percent,
	perPricedRequest: percent,
	attributedCost: formatInteger,
	attributedTokens: compact,

	// Latencies.
	avgDuration: elapsed,
	duration: duration,
	avgTtft: duration,
	ttft: duration,
	medianDuration: duration,
	p95Duration: duration,
	medianTtft: duration,
	avgTokensPerSecond: speed,
};

/**
 * `when` is a formatter over a TIMESTAMP, and it needs the clock — which is why
 * it is a factory and not a table entry. Relative inside a week, absolute beyond
 * it: the reader of a dashboard is usually asking "was that just now?", and a
 * bare epoch or a bare ISO date answers a question nobody asked.
 */
function when(value: number, now: number): string {
	if (value <= 0) return "";
	const delta = now - value;
	if (delta < 0) return new Date(value).toISOString().slice(0, 10);
	if (delta < 60_000) return "just now";
	if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
	if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
	if (delta < 7 * 86_400_000) return `${Math.round(delta / 86_400_000)}d ago`;
	return new Date(value).toISOString().slice(0, 10);
}

const WHEN_FIELDS: readonly string[] = ["timestamp", "lastTimestamp", "firstTimestamp", "lastUsed"];

/**
 * Does this field name money?
 *
 * Answered by asking {@link FIELD_FORMAT} rather than by a pattern: that table is
 * already the one place deciding how a field reads, and a regex here would be a
 * second list that silently disagrees with it the day a field is added.
 */
function isCostField(field: string): boolean {
	return FIELD_FORMAT[field] === cellCost;
}

/** The field a ref bottoms out in, following `derived` down to its base. */
function leafFieldOf(ref: MetricRef): string {
	return ref.kind === "derived" ? leafFieldOf(ref.of) : ref.field;
}

/**
 * One resolved value as the text of a cell.
 *
 * `null` is ALWAYS the empty string. That is the reason the resolver returns
 * `null` rather than `undefined`: an absent value must be a blank cell, and a
 * blank cell is invisible, so the absence has to have been caught upstream by
 * `test/resolve.test.ts` rather than here where nobody would see it.
 */
function formatValue(
	ref: MetricRef,
	value: number | string | null,
	row: DataRow | undefined,
	opts: ScreenRenderOptions,
): string {
	if (value === null) return "";
	// A label is a name, not a figure. `aggregate` also names text fields — the
	// IR uses it for `recentMessages.model` and `label` for the same idea
	// elsewhere — so text is returned as-is and only numbers are formatted.
	if (typeof value === "string") return value;
	const field = leafFieldOf(ref);
	if (WHEN_FIELDS.includes(field)) return when(value, opts.now);
	return (FIELD_FORMAT[field] ?? formatInteger)(value, row);
}

// ─── Band conversion ─────────────────────────────────────────────────────────

/**
 * A stat tile. Returned as a plain object rather than through a helper because
 * every field is optional and the grammar already drops what does not fit: the
 * only decision here is which tiles survive at all.
 */
function toStatTile(tile: IRStatTile, opts: ScreenRenderOptions): StatTileOut | null {
	const value = resolveCell(tile.metric, opts.data);
	// A cost tile reads its unpriced count from its own HINT when the hint names
	// one. A stat tile is not row-scoped, so `unpricedOf(undefined)` cannot see it
	// — and a tile printing `$0` beside "34,870 unpriced" is the one lie this
	// panel exists not to tell. Overview's cost tile declares exactly this shape:
	// `metric: totalCost`, `hint: unpricedRequests`.
	const field = leafFieldOf(tile.metric);
	const costHint =
		tile.hint !== undefined && !("text" in tile.hint) && /unpriced/i.test(leafFieldOf(tile.hint))
			? resolveNumber(tile.hint, opts.data)
			: null;
	const text =
		typeof value === "number" && isCostField(field)
			? tileCost(value, costHint === null ? undefined : ({ unpricedRequests: costHint } as DataRow))
			: formatValue(tile.metric, value, undefined, opts);
	// A tile with nothing to say is DROPPED rather than rendered blank: a
	// three-across grid with an empty cell reads as a rendering fault.
	if (text === "") return null;

	const rawHint =
		tile.hint === undefined
			? undefined
			: "text" in tile.hint
				? tile.hint.text
				: formatValue(tile.hint, resolveCell(tile.hint, opts.data), undefined, opts);
	// The requests screen's median tile pairs its p95 beside it ("p95 12.3s"),
	// as the web's `Median duration` stat does. The IR names the value; the
	// "p95" prefix is presentation, so it lives here beside the value.
	const hint =
		rawHint === undefined || rawHint === ""
			? undefined
			: tile.label === "Median duration" && tile.hint !== undefined && !("text" in tile.hint)
				? `p95 ${rawHint}`
				: rawHint;

	return {
		label: tile.label,
		value: text,
		...(hint === undefined || hint === "" ? {} : { hint }),
		...(tile.emphasis === "primary" ? { emphasis: "primary" as const } : {}),
		...(tile.spark ? { spark: resolveSeriesValues(tile.spark, opts.data) } : {}),
	};
}

/** The one stat-tile shape the grammar takes, restated so this module owns it. */
interface StatTileOut {
	label: string;
	value: string;
	hint?: string;
	emphasis?: "primary";
	spark?: readonly number[];
}

function statRowBand(stats: readonly IRStatTile[], opts: ScreenRenderOptions): Band | null {
	const tiles = stats
		.map(tile => toStatTile(tile, opts))
		.filter((tile): tile is StatTileOut => tile !== null);
	return tiles.length === 0 ? null : { kind: "statRow", stats: tiles };
}

/** One IR band as one grammar band, or `null` when it has nothing to say. */
function toBand(band: IRBand, opts: ScreenRenderOptions): Band | null {
	switch (band.kind) {
		case "statRow":
			return statRowBand(band.stats, opts);
		case "chart":
			return chartBand(band.title, band.chart, opts);
		case "table":
			return tableBand(band.title, band.columns, band.rows, opts);
		case "legend":
			return legendBand(band.items, opts, opts.publishedShares ?? []);
		case "note":
			// The one place the IR's own words reach the user unchanged, and that
			// is the point: `note` is where "This is not a zero", the per-call
			// attribution caveat and the rollup staleness live.
			return { kind: "note", text: band.text };
		case "custom":
			// The IR's single `custom` band is `providers`' subscription windows,
			// and that screen is deferred because its payload does not exist.
			// Saying so is the honest body for an unrenderable band; inventing a
			// rendering would be exactly the per-screen grammar this module exists
			// to remove.
			return {
				kind: "note",
				text:
					opts.spec.deferredReason ??
					`${band.id} has no terminal renderer: the layout IR describes it, nothing draws it.`,
			};
	}
}

/** The bands for one screen, in IR order. Empty bands are already dropped. */
export function screenBands(options: ScreenRenderOptions): readonly Band[] {
	// Walks the bands in ORDER, accumulating what each chart published, so a
	// legend can adopt the shares of the chart above it. A copy of the options is
	// threaded rather than the caller's object mutated: `renderScreen` runs once
	// per frame per resize, and a leaked accumulator would make the second frame
	// disagree with the first.
	const published: ReadonlyMap<string, number>[] = [];
	const opts: ScreenRenderOptions = { ...options, publishedShares: published };
	return options.spec.bands.flatMap(band => {
		if (band.kind === "chart" && band.chart.type === "shareBar") {
			published.push(chartShares(band.chart, options.data));
		}
		const converted = toBand(band, opts);
		return converted ? [converted] : [];
	});
}

/**
 * One screen, rendered.
 *
 * When every band turns out to be empty the screen says so in one dim line. The
 * wording covers both causes without choosing between them — the window really
 * had no usage, or the payload was never fetched — because at this layer the two
 * are indistinguishable and a heading over nothing would read as a finished
 * screen showing no data.
 */
export function renderScreen(opts: ScreenRenderOptions): readonly string[] {
	return renderScreenWith(opts).lines;
}

/**
 * A screen rendered, plus the chart rows it drew.
 *
 * The chart rows are RETURNED rather than re-derived because the panel needs them
 * for the tests that assert COST scaling against the real frame, and a second
 * local chart would be exactly the duplication this module removed.
 */
export function renderScreenWith(opts: ScreenRenderOptions): {
	lines: readonly string[];
	chart: readonly string[];
} {
	const bands = screenBands(opts);
	// A screen whose only surviving bands are NOTES has no data to qualify. Its
	// caveats are prose about figures ("the panel has no mode switch, so this
	// screen draws requests") and printing them under no figures reads as a
	// complete page. Say what is actually true instead.
	// A DEFERRED screen answers with WHY, whatever its bands resolved to: its
	// whole point is that the data cannot be fetched, and "no usage recorded"
	// would blame the reader's quiet month for a missing route.
	if (opts.spec.deferred) {
		return {
			lines: [opts.fg(PALETTE.muted, opts.spec.deferredReason ?? "This screen is deferred.")],
			chart: [],
		};
	}
	if (!bands.some(band => band.kind !== "note")) {
		return { lines: [opts.fg(PALETTE.muted, "No usage recorded in this range.")], chart: [] };
	}
	const chart = bands
		.filter((band): band is Extract<Band, { kind: "chart" }> => band.kind === "chart")
		.flatMap(band => band.chart.render());
	return { lines: renderBands(bands, bandOptions(opts)), chart };
}

/** The grammar's options for one screen. Every width comes from the plan. */
function bandOptions(opts: ScreenRenderOptions): BandRenderOptions {
	return {
		width: opts.plan.innerWidth,
		innerWidth: opts.plan.innerWidth,
		preset: opts.preset,
		glyphs: opts.glyphs ?? glyphsFor(opts.preset),
		fg: opts.fg,
		bold: opts.bold,
		seriesColorFor: opts.seriesColorFor,
		barHeight: opts.plan.barHeight,
		tableLimit: opts.plan.tableColumns,
		labelWidth: opts.plan.labelWidth,
		valueWidth: opts.plan.valueWidth,
		// F23 §2.3's sparkline seam. Injected rather than imported so the band
		// layer never depends on the chart layer.
		sparkline: (values, width) => renderSparkline(values, { width, preset: opts.preset }),
	};
}

// ─── Charts ──────────────────────────────────────────────────────────────────

/**
 * One chart band, or `null` when there is nothing honest to draw.
 *
 * A chart over a source the panel never FETCHED is DROPPED, not drawn empty. An
 * empty chart says "nothing happened in this window"; an absent payload says
 * "nobody asked", and drawing the first when the second is true is precisely the
 * silent-empty trap CONTEXT.md names — a screen that looks finished and shows
 * a flat baseline for data nobody queried.
 */
function chartBand(title: string, chart: ChartSpec, opts: ScreenRenderOptions): Band | null {
	if (!chart.series.some(series => isFetched(sourceOf(series.metric), opts.data))) return null;
	const body = chartRows(chart, opts);
	if (body.length === 0) return null;
	return {
		kind: "chart",
		title,
		chart: { type: chart.type, axis: AXIS_LABEL[chart.axis], render: () => body },
	};
}


function chartRows(chart: ChartSpec, opts: ScreenRenderOptions): readonly string[] {
	const width = Math.max(1, opts.plan.innerWidth);
	switch (chart.type) {
		case "heatmap":
			return heatmapRows(opts, width);
		case "shareBar":
			return shareBarRows(chart, opts, width);
		case "rankedBars":
			return rankedBarRows(chart, opts, width);
		case "sparkline": {
			const series = chart.series[0];
			if (!series) return [];
			return [
				renderSparkline(
					resolveSeriesValues(series.metric, opts.data, undefined, axisFor(opts, series.metric)),
					{ width, preset: opts.preset },
				),
			];
		}
		case "bars":
			return barRows(chart, opts, width);
	}
}

/**
 * A calendar heatmap over `dailyActivity`, coloured through the palette's ramp.
 *
 * `/usage` owns the grid layout (`buildHeatmapLayout` inside `renderHeatmap`),
 * which is why this is a delegation and not a reimplementation: zero-fill,
 * max-anchoring and the `null` future cell are three rules that are easy to get
 * subtly wrong and that the host has been running in production.
 */
function heatmapRows(opts: ScreenRenderOptions, width: number): readonly string[] {
	const points = rowsFor("dailyActivity", opts.data);
	if (points.length === 0) return [];
	return renderHeatmap(points as never, {
		innerWidth: width,
		labelWidth: HEAT_LABEL_WIDTH,
		weeks: weeksForWidth(HEAT_LABEL_WIDTH, width),
		glyphs: opts.glyphs ?? glyphsFor(opts.preset),
		ramp: [1, 2, 3].map(level => heatRamp(opts.palette, level)),
		...(opts.today ? { today: opts.today } : {}),
	});
}

/**
 * One block per series, heights split so a four-component chart is the same
 * height as a one-series chart. NEVER summed — see the module header.
 */
function barRows(chart: ChartSpec, opts: ScreenRenderOptions, width: number): readonly string[] {
	// `renderSeriesChart`, NOT a multi-series path written here. That module has no
	// geometry of its own: every mark comes out of `renderDailyBars` called once
	// per series, and `test/chart-primitives.test.ts` asserts the composition
	// equals the primitive byte for byte. Writing the loop again here is exactly how
	// this chart broke four times in one session — a second encoding nobody
	// compares against the primitive.
	return renderSeriesChart(
		chart.series.map(series => ({ label: series.label, values: bucketedValues(series.metric, opts) })),
		{
			width,
			height: Math.max(1, opts.plan.barHeight),
			preset: opts.preset,
			theme: opts.palette,
			paint: (color, text) => opts.fg(color, text),
		},
	);
}

/**
 * One series' values on the range's OWN bucket axis.
 *
 * The axis comes from the host's `bucketAxis`, never a hand-built loop, because
 * `densify` matches bucket timestamps EXACTLY: a chart on a different alignment
 * silently drops every point that misses, and a dropped point is lost spend.
 *
 * `costSeries` is DAY-bucketed for every range — the costs route aggregates by
 * day whatever window is asked, and the dashboard's own costs page passes
 * `DAY_MS` explicitly (`CostsRoute.tsx:201`). Deriving its axis from the range
 * instead would put hourly buckets under midnight-aligned rows for `24h`, and
 * the chart would be silently empty.
 */
/**
 * The bucket axis a chart plots on: EXACTLY `width` buckets, aligned the way the
 * host aligns them.
 *
 * `bucketAxis(range, …)` returns the range's NATURAL bucket count — 31 for `30d`
 * — and `renderDailyBars` then stretches those to the panel width by re-bucketing
 * on ARRAY INDEX, which smears one day's value across three columns and draws a
 * wall of identical full-height bars. A chart whose x-axis is an array index
 * rather than a time is not a time chart. So the axis is WIDENED rather than
 * stretched: same alignment rule, as many buckets as there are columns.
 *
 * The same axis is handed to `resolveSeriesValues` so a stat tile's sparkline and
 * the chart beside it agree bucket for bucket.
 */
function bucketAxisFor(opts: ScreenRenderOptions, source: MetricSource): readonly number[] {
	const rows = rowsFor(source, opts.data);
	const newest = rows
		.map(row => (row as Record<string, unknown>).timestamp)
		.filter((value): value is number => typeof value === "number")
		.reduce((max, value) => (value > max ? value : max), 0);
	if (newest <= 0) return [];
	const bucketMs = source === "costSeries" ? COST_BUCKET_MS : bucketMsFor(opts.range);
	const width = Math.max(1, opts.plan.innerWidth);
	const end = Math.floor(newest / bucketMs) * bucketMs;
	return Array.from({ length: width }, (_, i) => end - (width - 1 - i) * bucketMs);
}

/** The axis a SPARKLINE is drawn against, or `undefined` when there is none. */
function axisFor(opts: ScreenRenderOptions, ref: MetricRef) {
	const axis = bucketAxisFor(opts, sourceOf(ref));
	return axis.length === 0 ? undefined : { axis };
}

function bucketedValues(ref: MetricRef, opts: ScreenRenderOptions): readonly number[] {
	const base = ref.kind === "derived" ? ref.of : ref;
	if (base.kind !== "series") return [];
	const rows = rowsFor(base.source, opts.data);
	const timestamps = rows
		.map(row => (row as Record<string, unknown>).timestamp)
		.filter((value): value is number => typeof value === "number");
	if (timestamps.length === 0) return [];

	const bucketMs = base.source === "costSeries" ? COST_BUCKET_MS : bucketMsFor(opts.range);
	const axis = bucketAxisFor(opts, base.source);
	if (axis.length === 0) return [];
	// A gap bucket is a real zero — that day simply had no rows — which is what
	// makes the quiet days visible instead of interpolating them away.
	return axis.map(timestamp => {
		let sum = 0;
		for (const row of rows) {
			const at = (row as Record<string, unknown>).timestamp;
			if (typeof at !== "number" || Math.floor(at / bucketMs) * bucketMs !== timestamp) continue;
			const value = resolveNumber(base, opts.data, row);
			if (value !== null) sum += value;
		}
		return sum;
	});
}

/** One item's value and its share of the group it belongs to. */
interface ShareEntry {
	label: string;
	value: number;
	share: number;
}

/** A legend or bar item, carrying the metric that decides its composition. */
interface ShareItem {
	label: string;
	metric: MetricRef;
	value: number | null;
}

/**
 * The metric identity two items must share to belong to ONE composition.
 *
 * Overview's three agent rows carry three different LABELS reading the same
 * field, so grouping by label would give each a 100% of itself and no
 * composition at all. Grouping by the metric's own identity makes the token four
 * sum to 100% and the agent three sum to 100%, each against its own total — which
 * is what the web draws as two separate `ShareBar`s.
 */
function groupKeyOf(metric: MetricRef): string {
	const base = metric.kind === "derived" ? metric.of : metric;
	return base.kind === "derived" ? groupKeyOf(base.of) : `${base.source}.${base.field}`;
}

/**
 * Items → their shares, each against its OWN metric group's total.
 *
 * The fallback for a composition no chart published: an item nobody plotted still
 * belongs to a group with the items reading the same field, and a share with no
 * denominator at all would print `NaN`.
 */
function sharesOf(items: readonly ShareItem[]): readonly ShareEntry[] {
	const groups = new Map<string, number[]>();
	for (const item of items) {
		if (item.value === null) continue;
		const key = groupKeyOf(item.metric);
		const rows = groups.get(key) ?? [];
		rows.push(item.value);
		groups.set(key, rows);
	}
	return items.flatMap(item => {
		if (item.value === null) return [];
		const total = (groups.get(groupKeyOf(item.metric)) ?? []).reduce((sum, value) => sum + value, 0);
		return [{ label: item.label, value: item.value, share: total === 0 ? 0 : item.value / total }];
	});
}

/**
 * The shares a `shareBar` chart PUBLISHES, keyed by metric identity, so the
 * legend beneath it can adopt them instead of re-deriving.
 *
 * THIS IS THE D4 FIX, and it is a map rather than a second computation because
 * the two renderings previously disagreed: the bar divided the entries it
 * plotted, the legend divided by every item on its band, and Overview's legend
 * names the four token kinds AND three agent rows which the IR points at the
 * same `overall.totalRequests`. 196,380 requests leaked into a token
 * denominator and one quantity printed as 94.5% beside 94.6%.
 *
 * The web has one number and two renderings of it — `mix[key] / total`
 * (`OverviewRoute.tsx:186-224`). A `shareBar` chart IS that `total`: its series
 * are by construction one composition even though they read four DIFFERENT
 * fields, which is exactly why grouping by field cannot work here. So the chart
 * computes the shares and the legend looks them up.
 */
function chartShares(chart: ChartSpec, data: PanelData): ReadonlyMap<string, number> {
	const entries = chart.series.flatMap(series => {
		const value = resolveNumber(series.metric, data);
		return value === null ? [] : [{ metric: series.metric, value }];
	});
	const total = entries.reduce((sum, entry) => sum + entry.value, 0);
	const shares = new Map<string, number>();
	for (const entry of entries) {
		shares.set(groupKeyOf(entry.metric), total === 0 ? 0 : entry.value / total);
	}
	return shares;
}

/**
 * One share bar per series: label, bar, and the share the chart published.
 *
 * An item the chart does not publish falls back to its own metric group, so the
 * bar set and the legend set are computed by the same rule and agree wherever
 * they overlap.
 */
function shareBarRows(chart: ChartSpec, opts: ScreenRenderOptions, width: number): readonly string[] {
	const published = chartShares(chart, opts.data);
	const entries = chart.series.flatMap(series => {
		const value = resolveNumber(series.metric, opts.data);
		return value === null ? [] : [{ label: series.label, value }];
	});
	if (entries.length === 0) return [];
	const fallback = sharesOf(
		entries.map(entry => ({ label: entry.label, metric: chart.series[entries.indexOf(entry)].metric, value: entry.value })),
	);
	const labelWidth = Math.min(Math.max(...entries.map(entry => entry.label.length)), Math.max(1, Math.floor(width / 2)));
	return entries.map(entry => {
		const series = chart.series.find(candidate => candidate.label === entry.label);
		const share = (series ? published.get(groupKeyOf(series.metric)) : undefined) ??
			fallback.find(candidate => candidate.label === entry.label)?.share ??
			0;
		const readout = `${formatPercent(share)} ${formatInteger(entry.value)}`;
		const label = padEndTo(entry.label, labelWidth);
		const bar = renderShareBar(share, {
			width: Math.max(0, width - labelWidth - visibleWidth(readout) - 2),
			preset: opts.preset,
		});
		return clampLine(`${label} ${bar} ${readout}`, width);
	});
}

/** A ranked bar list: label, bar, figure. One divisor across every row. */
function rankedBarRows(chart: ChartSpec, opts: ScreenRenderOptions, width: number): readonly string[] {
	const rows: RankedRow[] = foldTo(chart.foldTo, groupedEntries(chart, opts)).map(entry => ({
		label: entry.label,
		value: entry.value,
		// An unpriced row ranks by its unmeasured requests and reads N/A; the
		// readout is built by `renderRankedBars` through `costWithUnpriced`.
		...(entry.unpriced > 0 ? { unpriced: entry.unpriced } : {}),
	}));
	return renderRankedBars(rows, {
		width,
		preset: opts.preset,
		accent: text => opts.fg(PALETTE.primary, text),
		dim: text => opts.fg(PALETTE.dim, text),
	});
}

/** One entry per group a share or ranked chart plots. */
interface ChartEntry {
	label: string;
	value: number;
	unpriced: number;
}

/**
 * The rows a share or ranked chart plots, grouped by the source's dimension.
 *
 * A single-row source (`overall`) contributes ONE entry per SERIES rather than
 * one per row, because the token-mix bar is a composition of four FIELDS and not
 * of four rows of one payload.
 */
function groupedEntries(chart: ChartSpec, opts: ScreenRenderOptions): readonly ChartEntry[] {
	const groupable = chart.series.filter(series => GROUP_KEY[seriesSource(series.metric)] !== undefined);
	if (groupable.length === 0) {
		return chart.series.map(series => ({
			label: series.label,
			value: resolveNumber(series.metric, opts.data) ?? 0,
			unpriced: 0,
		}));
	}
	return groupable.flatMap(series => {
		const key = GROUP_KEY[seriesSource(series.metric)] as string;
		const base = series.metric.kind === "derived" ? series.metric.of : series.metric;
		const byGroup = new Map<string, ChartEntry>();
		for (const row of rowsFor(seriesSource(series.metric), opts.data)) {
			const group = (row as Record<string, unknown>)[key];
			if (typeof group !== "string") continue;
			const value = resolveNumber(base, opts.data, row);
			if (value === null) continue;
			const entry = byGroup.get(group) ?? { label: group, value: 0, unpriced: 0 };
			entry.value += value;
			const unpriced = (row as Record<string, unknown>).unpricedRequests;
			if (typeof unpriced === "number") entry.unpriced += unpriced;
			byGroup.set(group, entry);
		}
		// A group with no value and nothing unpriced is a group the payload had
		// nothing to say about; printing it as `0.0%` would draw a share bar for a
		// slice that does not exist.
		return [...byGroup.values()].filter(entry => entry.value > 0 || entry.unpriced > 0);
	});
}

/**
 * The payload a chart series reads. `sourceOf` is the IR's own rule and it
 * already follows `derived` to its base, so this function is a name rather than
 * a second implementation — a divergent copy is how `costSeries` and
 * `modelSeries` end up reading different payloads on two different screens.
 */
function seriesSource(ref: MetricRef): MetricSource {
	return sourceOf(ref);
}

/**
 * Keep the largest `foldTo.limit` entries and fold the rest into one labelled
 * row, as `pivotSeries`'s `Other (n)` does in the web dashboard.
 */
function foldTo(
	fold: ChartSpec["foldTo"],
	entries: readonly ChartEntry[],
): readonly ChartEntry[] {
	if (!fold || entries.length <= fold.limit) return entries;
	const sorted = [...entries].sort((a, b) => b.value - a.value);
	const tail = sorted.slice(fold.limit);
	return [
		...sorted.slice(0, fold.limit),
		{
			label: `${fold.label} (${tail.length})`,
			value: tail.reduce((sum, entry) => sum + entry.value, 0),
			unpriced: tail.reduce((sum, entry) => sum + entry.unpriced, 0),
		},
	];
}

// ─── Tables ──────────────────────────────────────────────────────────────────

/**
 * A table: header row, one row per payload row.
 *
 * `cell: "meter"` and `cell: "sparkline"` are composed HERE rather than by the
 * grammar, because both need a scale the grammar cannot know: a meter divides by
 * the largest value in its own COLUMN and a sparkline needs one row's series.
 * The grammar still owns the column widths and the clamping, so a table is laid
 * out in exactly one place like every other band.
 */
function tableBand(
	title: string,
	columns: readonly IRColumn[],
	rowSource: RowSource,
	opts: ScreenRenderOptions,
): Band | null {
	const all = sortRows(rowsFor(rowSource.source, opts.data), rowSource, opts);
	if (all.length === 0) return null;

	const shown = all.slice(0, rowSource.limit ?? Math.max(4, opts.plan.tableColumns * 4));
	const maxes = columnMaxes(columns, all, opts);
	const cellWidth = Math.max(1, opts.plan.valueWidth);

	return {
		kind: "table",
		title,
		columns: columns.map(column => ({
			key: column.header,
			header: column.header,
			align: column.align,
			...(column.cell && column.cell !== "sparkline" ? { cell: column.cell } : {}),
		})),
		rows: {
			kind: "inline",
			rows: shown.map(row => {
				const record: Record<string, string> = {};
				for (const column of columns) {
					record[column.header] = renderCell(column, row, maxes.get(column.header) ?? 0, cellWidth, opts);
				}
				return record;
			}),
		},
	};
}

/** The largest value in each meter column, which is that column's one divisor. */
function columnMaxes(
	columns: readonly IRColumn[],
	rows: readonly DataRow[],
	opts: ScreenRenderOptions,
): ReadonlyMap<string, number> {
	const maxes = new Map<string, number>();
	for (const column of columns) {
		if (column.cell !== "meter") continue;
		let max = 0;
		for (const row of rows) {
			const value = resolveNumber(column.source, opts.data, row);
			if (value !== null && value > max) max = value;
		}
		maxes.set(column.header, max);
	}
	return maxes;
}

function renderCell(
	column: IRColumn,
	row: DataRow,
	columnMax: number,
	cellWidth: number,
	opts: ScreenRenderOptions,
): string {
	switch (column.cell) {
		case "meter":
			return meterCell(resolveNumber(column.source, opts.data, row) ?? 0, columnMax, cellWidth, opts);
		case "sparkline":
			// The axis is threaded so a table sparkline is DENSE over it, matching
			// the web's `pivotSeries` rather than skipping the buckets a model was
			// idle for. A gap read as "no data" is a claim the payload does not make.
			return renderSparkline(
				resolveSeriesValues(column.source, opts.data, row, axisFor(opts, column.source)),
				{ width: cellWidth, preset: opts.preset },
			);
		case "badge":
			return badgeCell(column, row, opts);
		default:
			return formatValue(column.source, resolveCell(column.source, opts.data, row), row, opts);
	}
}

/**
 * A meter: a bar filling the cell, scaled against its column's own maximum.
 *
 * The figure is NOT repeated in the cell — the table has a column for it. A
 * meter that printed its own number would read as two numbers and invite the
 * reader to compare them, which is the one thing a magnitude column must not do.
 */
function meterCell(
	value: number,
	columnMax: number,
	cellWidth: number,
	opts: ScreenRenderOptions,
): string {
	const fill = glyph(opts.preset, "barFill");
	const empty = glyph(opts.preset, "barEmpty");
	if (columnMax <= 0) return empty.repeat(cellWidth);
	// The one-cell floor: a row that rendered nothing would be indistinguishable
	// from a row the query never returned, and this may be the unpriced model the
	// reader most needs to see.
	const drawn = Math.max(value > 0 ? 1 : 0, Math.min(cellWidth, Math.round((value / columnMax) * cellWidth)));
	return fill.repeat(drawn) + empty.repeat(cellWidth - drawn);
}

/**
 * A status badge. An error is `error`-coloured and says so; a clean row is
 * `success`-coloured and says `ok`.
 *
 * A null `errorMessage` on a request row is the MEASURED ABSENCE of a failure,
 * which is the one null in this panel that means good news rather than unknown.
 * That distinction is why a request's status reads "ok" and not "—".
 */
function badgeCell(column: IRColumn, row: DataRow, opts: ScreenRenderOptions): string {
	// The request log's Status is the host's `requestStatus`, not the raw
	// `errorMessage`: an aborted request carries no error and must not read
	// "failed". Aborted is `warning` — interrupted work, not a failure — and
	// only genuinely failed rows take `negative`.
	const statusValue = resolveCell(column.source, opts.data, row);
	if (leafFieldOf(column.source) === "stopReason" && typeof statusValue === "string") {
		if (statusValue === "aborted") return opts.fg("warning", "aborted");
		if (statusValue === "failed") return opts.fg(PALETTE.negative, "failed");
		return opts.fg(PALETTE.positive, "ok");
	}
	const value = statusValue;
	if (typeof value === "string") {
		return value === "" ? opts.fg(PALETTE.positive, "ok") : opts.fg(PALETTE.negative, "failed");
	}
	const figure = count(value);
	if (figure === null) return "";
	if (leafFieldOf(column.source).toLowerCase().includes("rate")) {
		return figure > 0 ? opts.fg(PALETTE.negative, formatPercent(figure)) : opts.fg(PALETTE.positive, "none");
	}
	return figure > 0 ? opts.fg(PALETTE.negative, formatInteger(figure)) : opts.fg(PALETTE.positive, "none");
}

/** A table's rows in the order the IR asked for, never in payload order. */
function sortRows(
	rows: readonly DataRow[],
	rowSource: RowSource,
	opts: ScreenRenderOptions,
): readonly DataRow[] {
	const sort = rowSource.initialSort;
	if (!sort) return rows;
	const direction = sort.direction === "asc" ? 1 : -1;
	return [...rows].sort((a, b) => {
		const left = resolveCell(sort.by, opts.data, a);
		const right = resolveCell(sort.by, opts.data, b);
		if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
		return String(left).localeCompare(String(right)) * direction;
	});
}

// ─── Legend ──────────────────────────────────────────────────────────────────

/**
 * A legend: one row per item, its share of a stated whole.
 *
 * A CONTINUATION of the chart above it rather than a band with a heading, which
 * is `band.ts`'s rule and the reason no blank line precedes it. Every item
 * resolving to nothing makes the band disappear rather than drawing a column of
 * `0.0%` that reads as a measurement.
 */
function legendBand(
	items: readonly IRLegendItem[],
	opts: ScreenRenderOptions,
	published: readonly ReadonlyMap<string, number>[],
): Band | null {
	if (items.length === 0) return null;
	const measured = items.map(item => ({
		label: item.label,
		metric: item.metric,
		value: resolveNumber(item.metric, opts.data),
	}));

	// An item a chart above already PUBLISHED takes that share. Everything else is
	// grouped by the metric it reads, so Overview's three agent rows — all on
	// `totalRequests`, none of them a token kind — are shares of each other rather
	// than fractions of a token total they have nothing to do with.
	const entries = measured.map(item => {
		const adopted = published.map(shares => shares.get(groupKeyOf(item.metric))).find(v => v !== undefined);
		return { label: item.label, metric: item.metric, value: item.value, share: adopted };
	});
	const own = sharesOf(entries.filter(entry => entry.share === undefined));
	return entries.some(entry => (entry.share ?? own.find(c => c.label === entry.label)?.share ?? 0) > 0)
		? {
				kind: "legend",
				items: entries.map(entry => ({
					label: entry.label,
					share: entry.share ?? own.find(candidate => candidate.label === entry.label)?.share ?? 0,
				})),
			}
		: null;
}

// ─── Measured helpers ────────────────────────────────────────────────────────

function padEndTo(text: string, width: number): string {
	const gap = width - visibleWidth(text);
	return gap > 0 ? text + " ".repeat(gap) : text;
}

/**
 * Clamp to the inner width, measured in CELLS. Every cell here passed through a
 * formatter and some carry ANSI, so `.length` would be the wrong measure — and
 * one over-wide row overwrites the panel's right border.
 */
function clampLine(text: string, width: number): string {
	return visibleWidth(text) > width ? truncateToWidth(text, width) : text;
}
