/**
 * `test/redundant-layout.test.ts` — three redundancies a rendered screen shows.
 *
 * Every test here was written by LOOKING at `bun scripts/probe-render.ts costs
 * --width 150` and finding something repeated rather than by reading a spec and
 * imagining a defect. Each rule is stated once, asserted through the REAL
 * renderer over a synthetic `ScreenSpec`, and — where the shipped specs are the
 * case that produced the screenshot — over the shipped spec as well.
 *
 *   A  A `legend` band whose every item the chart above already PUBLISHED on its
 *      own rows is a second rendering of that chart, and is dropped.
 *   B  A table column that resolves to zero in EVERY row carries no variation and
 *      is dropped — except the money-caveat column, which AGENTS.md:228 requires
 *      beside cost always.
 *   C  A stat tile's HINT that resolves to zero, and restates a figure a sibling
 *      tile in the same statRow already states, is dropped.
 *
 * None of the three is "delete the feature". A legend stays for a chart that
 * cannot name its own series; the caveat column stays; a non-zero hint stays, and
 * so does a zero hint that is the only place its figure appears. Each of those
 * has its own test below, because a rule stated only by its exception is a rule
 * nobody can check.
 */

import { expect, test } from "bun:test";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import type { ThemeColor } from "@oh-my-pi/pi-tui/theme/schema";
import type { CostTimeSeriesPoint } from "@oh-my-pi/omp-stats/shared-types";

import { SCREEN_SPECS, type Band as IRBand, type Column as IRColumn, type MetricRef, type ScreenSpec } from "../src/layout/spec";
import { screenBands, type ScreenRenderOptions } from "../src/tui/render/screen";
import { planLayout } from "../src/tui/layout";
import { glyphsFor, type SymbolPreset } from "../src/tui/glyphs";
import { SERIES_COLORS, stripForTest } from "../src/tui/palette";
import { DEFAULT_RANGE } from "../src/data/ranges";
import type { PanelData } from "../src/data/api";
import { AGGREGATE, COST_SERIES, FIXTURE_NOW, liveData } from "./fixtures/panel";

ensureThemeSync();

const PRESET: SymbolPreset = "unicode";

function opts(spec: ScreenSpec, data: PanelData, width = 150): ScreenRenderOptions {
	return {
		spec,
		data,
		plan: planLayout(width, 40, PRESET),
		preset: PRESET,
		range: DEFAULT_RANGE,
		now: FIXTURE_NOW,
		fg: (color: ThemeColor, value: string) => theme.fg(color, value),
		bold: value => theme.bold(value),
		palette: theme,
		seriesColorFor: index => SERIES_COLORS[index % SERIES_COLORS.length],
		glyphs: glyphsFor(PRESET),
	};
}

const specOf = (id: string): ScreenSpec => {
	const spec = SCREEN_SPECS.find(candidate => candidate.id === id);
	if (spec === undefined) throw new Error(`no screen spec ${id}`);
	return spec;
};

/**
 * A spec with no web route behind it. The rules below are about COMPOSITION —
 * which bands and columns survive — and a rule proved only against the shipped
 * specs would be a rule proved against one payload's accidents.
 */
function probeSpec(bands: readonly IRBand[], id = "probe"): ScreenSpec {
	return {
		id,
		label: "Probe",
		short: "P",
		needs: ["overview", "costs"],
		bands,
		source: { file: "test/redundant-layout.test.ts", lines: "1" },
	};
}

const overall = (field: string): MetricRef => ({ kind: "aggregate", source: "overall", field });
const costField = (field: string): MetricRef => ({ kind: "series", source: "costSeries", field, groupBy: "model" });
const summedCost = (field: string): MetricRef => ({
	kind: "derived",
	name: field === "cost" ? "totalCost" : "unpricedRequests",
	op: "sum",
	of: costField(field),
});

/** One `(day, model)` cost row, shaped like `CostTimeSeriesPoint`. */
function costRow(model: string, cost: number, over: Partial<CostTimeSeriesPoint> = {}): CostTimeSeriesPoint {
	return {
		timestamp: FIXTURE_NOW,
		model,
		provider: "openrouter",
		cost,
		unpricedRequests: 0,
		costInput: cost * 0.1,
		costOutput: cost * 0.05,
		costCacheRead: cost * 0.8,
		costCacheWrite: cost * 0.05,
		requests: 100,
		...over,
	};
}

/** A payload whose whole cost table is the rows given. */
const costData = (rows: readonly CostTimeSeriesPoint[]): PanelData => liveData({ costs: { costSeries: rows } });

// ─── A: a legend that only repeats the chart above it ─────────────────────────

test("A: a legend whose EVERY item the shareBar above already published does not render", () => {
	// The rule, in one band pair. A `shareBar` row is `label bar… pct figure` —
	// it names its own series and states that series' share. A legend beneath it
	// printing the same labels and the same percentages says nothing the row
	// above did not.
	const tokens = [
		{ key: "input", label: "Uncached input", metric: overall("totalInputTokens") },
		{ key: "cacheRead", label: "Cache read", metric: overall("totalCacheReadTokens") },
	];
	const spec = probeSpec([
		{ kind: "chart", title: "Token mix", chart: { type: "shareBar", axis: "share", series: tokens } },
		{ kind: "legend", items: tokens },
	]);
	expect(screenBands(opts(spec, liveData())).some(band => band.kind === "legend")).toBe(false);
});

test("A: the costs screen publishes no legend — the shareBar names all four components", () => {
	// The screenshot: `Where it went` draws Input/Output/Cache read/Cache write
	// with a bar, a percentage and a figure on each of its four rows, and the
	// four legend rows under it said the same four names at the same four
	// percentages. Four rows of nothing.
	const bands = screenBands(opts(specOf("costs"), liveData()));
	expect(bands.some(band => band.kind === "legend")).toBe(false);
});

test("A: a legend item the chart above did NOT publish keeps the whole legend", () => {
	// The exemption, and the case that must never be "fixed". Overview's legend
	// names three agent rows the `Token mix` shareBar has no series for — no
	// label, no bar, no share anywhere else on the screen. Suppressing a legend
	// because SOME of it is repeated would delete those three rows' only
	// rendering.
	//
	// Suppression is therefore all-or-nothing per legend band, not per item:
	// `renderLegend` wears each swatch in its ITEM index's hue, so removing the
	// first four items would slide the agent keys onto the hues the shareBar
	// already spent on the token kinds — a key that names the wrong series. One
	// legend, all or none.
	const bands = screenBands(opts(specOf("overview"), liveData()));
	const legend = bands.find(band => band.kind === "legend");
	expect(legend, "the agent-type legend must survive").toBeTruthy();
	if (legend === undefined || legend.kind !== "legend") throw new Error("not a legend band");
	const labels = legend.items.map(item => item.label);
	for (const label of ["Uncached input", "Cache read", "Main agent", "Subagents", "Advisor"]) {
		expect(labels, label).toContain(label);
	}
});

test("A: a chart kind that cannot name its own series KEEPS its legend", () => {
	// `bars` labels each series UNDER its marks, in the series' own hue, and
	// publishes no share for anything — there is nothing for a legend to adopt.
	// This is the band kind the legend exists for, so a rule that suppressed it
	// would delete the only place the shares are stated.
	const series = [
		{ key: "ok", label: "Succeeded", metric: { kind: "series", source: "timeSeries", field: "requests" } as MetricRef },
		{ key: "err", label: "Failed", metric: { kind: "series", source: "timeSeries", field: "errors" } as MetricRef },
	];
	const spec = probeSpec([
		{ kind: "chart", title: "Activity", chart: { type: "bars", axis: "requests", series } },
		{ kind: "legend", items: series },
	]);
	const legend = screenBands(opts(spec, liveData())).find(band => band.kind === "legend");
	expect(legend, "a chart that publishes nothing must keep its legend").toBeTruthy();
	if (legend === undefined || legend.kind !== "legend") throw new Error("not a legend band");
	expect(legend.items.map(item => item.label)).toEqual(["Succeeded", "Failed"]);
});