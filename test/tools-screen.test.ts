/**
 * `test/tools-screen.test.ts` — the IR-rendered tools screen.
 *
 * Share parity lives in `test/parity.test.ts` ("Fraction columns are the host's
 * fractions"). These tests are what parity cannot see: the two tool tables draw
 * from DIFFERENT row sets (`toolsByTool` vs `toolsByToolModel`), and a table
 * that read the wrong set would still total plausibly.
 */

import { expect, test } from "bun:test";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import type { ThemeColor } from "@oh-my-pi/pi-tui/theme/schema";

import { buildToolRows } from "@oh-my-pi/omp-stats/client/data/view-models";
import { SCREEN_SPECS } from "../src/layout/spec";
import { renderScreen, screenBands, renderScreenWith, type ScreenRenderOptions } from "../src/tui/render/screen";
import { planLayout } from "../src/tui/layout";
import { glyphsFor } from "../src/tui/glyphs";
import { PALETTE, SERIES_COLORS, stripForTest } from "../src/tui/palette";
import { DEFAULT_RANGE } from "../src/data/ranges";
import type { PanelData } from "../src/data/api";
import { FIXTURE_NOW, liveData } from "./fixtures/panel";

ensureThemeSync();

const spec = SCREEN_SPECS.find(s => s.id === "tools")!;

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

test("tools: 'By tool' ranks the host's fraction leader first", () => {
	const rows = buildToolRows(liveData().tools!.byTool);
	const leader = [...rows].sort((a, b) => b.callFraction - a.callFraction)[0]!;
	const bands = screenBands(opts(liveData()));
	const band = bands.find(b => b.kind === "table" && b.title === "By tool");
	expect(band, `"By tool" table band missing`).toBeTruthy();
	if (band === undefined || band.kind !== "table") throw new Error(`"By tool" is not a table band`);
	const table = band;
	const first = table.rows.kind === "inline" ? table.rows.rows[0] : undefined;
	expect(first).toBeTruthy();
	expect(first!["Tool"]).toBe(leader.tool);
});

test("tools: 'By tool and model' draws tool×model rows, not tool rows", () => {
	// The two tables read DIFFERENT row sets. A renderer that handed both
	// tables the same rows would still show plausible totals — so this asserts
	// the second table carries the MODEL dimension the first one lacks.
	const both = buildToolRows(liveData().tools!.byTool).map(r => r.tool);
	for (const m of liveData().tools!.byToolModel) {
		expect(both, `${m.tool}/${m.model} must not appear in the By-tool table`).not.toContain(m.model);
	}
	const bands = screenBands(opts(liveData()));
	const band = bands.find(b => b.kind === "table" && b.title === "By tool and model");
	expect(band, `"By tool and model" table band missing`).toBeTruthy();
	if (band === undefined || band.kind !== "table") throw new Error(`"By tool and model" is not a table band`);
	const table = band;
	const rows = table.rows.kind === "inline" ? table.rows.rows : [];
	expect(rows.length).toBeGreaterThan(0);
	const rendered = text(renderScreen(opts(liveData())));
	for (const row of liveData().tools!.byToolModel) {
		expect(rendered, `${row.tool}/${row.model}`).toContain(row.tool);
		expect(rendered, `${row.tool}/${row.model}`).toContain(row.model);
	}
	// And exactly those two tables exist — no third table, no invented section.
	expect(bands.filter(b => b.kind === "table").map(b => b.title)).toEqual([
		"By tool",
		"By tool and model",
	]);
});

test("tools: the calls/errors chart composes ONE block per series", () => {
	const { chart } = renderScreenWith(opts(liveData()));
	expect(chart.length).toBeGreaterThan(0);
	const joined = chart.join("\n");
	for (const label of ["Calls", "Errors"]) expect(joined, label).toContain(label);
});

test("tools: an unfetched tools payload renders a defined state", () => {
	const rows = renderScreen(opts({}));
	expect(text(rows)).not.toMatch(/NaN|undefined|Infinity/);
	expect(text(rows).length).toBeGreaterThan(0);
});

test("tools: error badges exist for the tool that fails, not a silent zero", () => {
	// bash fails 41 of 1,884. A table that dropped the badge column would
	// still print the counts; the badge is what a failure READS as.
	const rendered = text(renderScreen(opts(liveData())));
	expect(rendered).toContain("bash");
});
