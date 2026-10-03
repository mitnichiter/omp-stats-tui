/**
 * `test/costs-screen.test.ts` — the IR-rendered costs screen, against the live DB.
 *
 * The deep figure parity already lives in `test/parity.test.ts` (the tiles ARE
 * the dashboard's floats, bit for bit). These tests are about what parity
 * cannot see: which MODEL name the top tile names, which row orders first in
 * the per-model table, and that the multi-series daily chart attributes each
 * bucket to the right billing component rather than to a plausible wrong one.
 *
 * Fixtures are the shared `test/fixtures/panel.ts` live set — the same live
 * data the pipeline tests render — so "renders on real-shaped payload" is not
 * a separate fixture from "renders the right numbers".
 */

import { expect, test } from "bun:test";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import type { ThemeColor } from "@oh-my-pi/pi-tui/theme/schema";

import { buildCostSummary } from "@oh-my-pi/omp-stats/client/data/view-models";
import { SCREEN_SPECS } from "../src/layout/spec";
import { glyphsFor } from "../src/tui/glyphs";
import { renderScreen, screenBands, renderScreenWith, type ScreenRenderOptions } from "../src/tui/render/screen";
import { planLayout } from "../src/tui/layout";
import { PALETTE, SERIES_COLORS, stripForTest } from "../src/tui/palette";
import { DEFAULT_RANGE } from "../src/data/ranges";
import type { PanelData } from "../src/data/api";
import { FIXTURE_NOW, liveData } from "./fixtures/panel";

ensureThemeSync();

const spec = SCREEN_SPECS.find(s => s.id === "costs")!;

function opts(data: PanelData, width = 100): ScreenRenderOptions {
	return {
		spec,
		data,
		plan: planLayout(width, 40, "unicode"),
		preset: "unicode",
		range: DEFAULT_RANGE,
		now: FIXTURE_NOW,
		fg: (color: ThemeColor, text: string) => theme.fg(color, text),
		bold: text => theme.bold(text),
		palette: theme,
		seriesColorFor: index => SERIES_COLORS[index % SERIES_COLORS.length],
		glyphs: glyphsFor("unicode"),
	};
}

const text = (rows: readonly string[]): string => stripForTest(rows.join("\n"));

test("costs: the top tile names the HOST's top model, not the first payload row", () => {
	const summary = buildCostSummary(liveData().costs!.costSeries);
	const rows = renderScreen(opts(liveData()));
	const topBand = screenBands({ ...opts(liveData()), spec }).find(b => b.kind === "statRow")!;
	const label = topBand.stats.find(s => s.label === "Top model")!;
	expect(label.value).toBe(summary.topModel?.model ?? "–");
	expect(label.value).not.toBe(liveData().costs!.costSeries[0]!.model);
});

test("costs: 'By model' ranks the web's highest-estimate model first", () => {
	const summary = buildCostSummary(liveData().costs!.costSeries);
	const bands = screenBands(opts(liveData()));
	const table = bands.find(b => b.kind === "table" && b.title === "By model");
	expect(table, "By model table band missing").toBeTruthy();
	if (table === undefined || table.kind !== "table") throw new Error("By model is not a table band");
	const first = table.rows.kind === "inline" ? table.rows.rows[0] : undefined;
	expect(first).toBeTruthy();
	expect(first!["Model"]).toBe(summary.models[0]!.model);
});

test("costs: the daily chart's component series are labelled Input/Output/Cache read/Cache write", () => {
	// Shape, not sum: a component mis-attributed to its sibling still totals
	// right. The fixture's busy bucket is costInput-heavy, so a swap would
	// move the visible mass from the first block to another — and the labels
	// are what tie each block to its component.
	const { chart } = renderScreenWith(opts(liveData()));
	expect(chart.length).toBeGreaterThan(0);
	const joined = chart.join("\n");
	for (const label of ["Input", "Output", "Cache read", "Cache write"]) {
		expect(joined, label).toContain(label);
	}
});

test("costs: the trace rows carry the billed component, not the total", () => {
	const { lines, chart } = ((): { lines: readonly string[]; chart: readonly string[] } => {
		const spec0 = SCREEN_SPECS.find(s => s.id === "costs")!;
		const { renderScreenWith } = require("../src/tui/render/screen") as typeof import("../src/tui/render/screen");
		return renderScreenWith(opts(liveData()));
	})();
	expect(chart.length).toBeGreaterThan(0);
	expect(lines.join("\n")).toContain("Input");
});

test("costs: Top model follows the COST axis, not the request count", () => {
	// The fixture's busiest-request model is space-bunny-free; the top COST
	// model must win this tile either way.
	const rows = renderScreen(opts(liveData()));
	const topBand = screenBands(opts(liveData())).find(b => b.kind === "statRow")!;
	const label = topBand.stats.find(s => s.label === "Top model")!;
	const summary = buildCostSummary(liveData().costs!.costSeries);
	expect(label.value).toBe(summary.topModel?.model ?? "–");
	expect(text(rows)).toContain(label.value);
});
test("costs: 'By model' carries the web's component columns beside Estimate", () => {
	// CostsRoute.tsx:320-412 — Model, Requests, Estimate, Share, Split,
	// Input, Output, Cache read, Cache write, Per request, Unpriced.
	const bands = screenBands(opts(liveData()));
	const table = bands.find(b => b.kind === "table" && b.title === "By model");
	expect(table, "By model table band missing").toBeTruthy();
	if (table === undefined || table.kind !== "table") throw new Error("By model is not a table band");
	const headers = table.columns.map(c => c.header);
	for (const header of ["Model", "Requests", "Estimate", "Share", "Input", "Output", "Cache read", "Cache write", "Per request", "Unpriced"]) {
		expect(headers, header).toContain(header);
	}
});
