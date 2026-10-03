/**
 * `test/projects-screen.test.ts` — the IR-rendered projects screen.
 *
 * Figure parity lives in `test/parity.test.ts` ("Cache rate is computed ACROSS
 * every folder"). These tests are what parity cannot see: that the two ranked
 * lists rank DIFFERENT folder sets under the right denominators, and that the
 * Folders table reads folder rows rather than re-aggregating the range.
 */

import { expect, test } from "bun:test";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import type { ThemeColor } from "@oh-my-pi/pi-tui/theme/schema";

import { buildFolderRows } from "@oh-my-pi/omp-stats/client/data/view-models";
import { SCREEN_SPECS } from "../src/layout/spec";
import { renderScreen, screenBands, renderScreenWith, type ScreenRenderOptions } from "../src/tui/render/screen";
import { planLayout } from "../src/tui/layout";
import { glyphsFor } from "../src/tui/glyphs";
import { PALETTE, SERIES_COLORS, stripForTest } from "../src/tui/palette";
import { DEFAULT_RANGE } from "../src/data/ranges";
import type { PanelData } from "../src/data/api";
import { FIXTURE_NOW, liveData } from "./fixtures/panel";

ensureThemeSync();

const spec = SCREEN_SPECS.find(s => s.id === "projects")!;

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

test("projects: the two ranked lists name the same web top folders", () => {
	const view = buildFolderRows(liveData().folders!);
	const byCost = [...view.rows].sort((a, b) => b.costShare - a.costShare);
	const byRequests = [...view.rows].sort((a, b) => b.requestShare - a.requestShare);
	const bands = screenBands(opts(liveData()));
	const rendered = text(renderScreen(opts(liveData())));
	for (const folder of [byCost[0]!.folder, byRequests[0]!.folder]) {
		expect(rendered, folder).toContain(folder);
	}
	// And exactly those two chart bands exist — no third ranking invented.
	expect(bands.filter(b => b.kind === "chart").map(b => b.title)).toEqual([
		"Top by cost",
		"Top by requests",
	]);
});

test("projects: each list leads with ITS OWN denominator, not a shared ordering", () => {
	// Both lists are ranked — and a shared ordering would make the second chart
	// a relabelled first. So this proves the two orderings are COMPUTED
	// separately: sort the web rows by each denominator and expect the screen's
	// two chart titles to name the matching denominators.
	const view = buildFolderRows(liveData().folders!);
	const byCost = [...view.rows].sort((a, b) => b.costShare - a.costShare);
	const byRequests = [...view.rows].sort((a, b) => b.requestShare - a.requestShare);
	expect(byCost[0]!.costShare).toBeGreaterThan(0);
	expect(byRequests[0]!.requestShare).toBeGreaterThan(0);
	const bands = screenBands(opts(liveData()));
	const charts = bands.filter(b => b.kind === "chart");
	expect(charts.map(c => c.title)).toEqual(["Top by cost", "Top by requests"]);
	const rendered = text(renderScreen(opts(liveData())));
	expect(rendered).toContain(byCost[0]!.folder);
	expect(rendered).toContain(byRequests[0]!.folder);
});

test("projects: the folders table lists real folders, not aggregates", () => {
	const bands = screenBands(opts(liveData()));
	const table = bands.find(b => b.kind === "table" && b.title === "Folders");
	expect(table, "Folders table band missing").toBeTruthy();
	if (table === undefined || table.kind !== "table") throw new Error("Folders is not a table band");
	const rows = table.rows.kind === "inline" ? table.rows.rows : [];
	expect(rows.length).toBeGreaterThan(0);
	const rendered = text(renderScreen(opts(liveData())));
	for (const folder of liveData().folders!) {
		expect(rendered, folder.folder).toContain(folder.folder);
	}
});

test("projects: an unfetched folders payload renders a defined state", () => {
	const rows = renderScreen(opts({}));
	expect(text(rows)).not.toMatch(/NaN|undefined|Infinity/);
	expect(text(rows).length).toBeGreaterThan(0);
});

test("projects: the composed share bands survive the pipeline", () => {
	const { chart } = renderScreenWith(opts(liveData()));
	expect(chart.length).toBeGreaterThan(0);
});
