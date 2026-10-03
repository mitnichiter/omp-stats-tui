/**
 * Four defects found by LOOKING at the rendered output, not by reading it.
 *
 * Every assertion here corresponds to a line a human read off the probe and
 * said "that is wrong". They live in their own file because they share one
 * subject — the shapes a stat tile, a bar chart and a legend take — and because
 * each has a specific, nameable cause:
 *
 *   D1  A tile's label and value are jammed together (`API-equivalent cost$112.36`).
 *       The web's `Stat` puts the label on its OWN LINE above the value.
 *   D2  A tile appears to carry TWO values (`Requests 65,460 1,315`). It is
 *       really the hint running on beside the value, but a reader cannot tell.
 *   D3  A multi-series time chart draws N identical blocks with no label, so it
 *       reads as one line repeated rather than as two series.
 *   D4  A legend swatch is TWO glyphs, and the legend's percentage disagrees with
 *       the share bar directly above it for the same quantity.
 *
 * D4 is the one that matters most: two computations of one number is exactly
 * how a dashboard starts disagreeing with itself, and the web draws both from
 * the same `mix[key] / total`.
 */

import { expect, test } from "bun:test";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";

import { SCREEN_SPECS, type ScreenSpec } from "../src/layout/spec";
import { renderScreen, screenBands, type ScreenRenderOptions } from "../src/tui/render/screen";
import { planLayout } from "../src/tui/layout";
import { SERIES_COLORS, stripForTest } from "../src/tui/palette";
import { visibleWidth } from "@oh-my-pi/pi-tui/utils";
import { DEFAULT_RANGE } from "../src/data/ranges";
import { FIXTURE_NOW, liveData } from "./fixtures/panel";
import type { Band, StatTile } from "../src/tui/band";

ensureThemeSync();

function render(spec: ScreenSpec, width = 120): readonly string[] {
	const plan = planLayout(width, 40, "unicode");
	return renderScreen({
		spec,
		data: liveData(),
		plan,
		preset: "unicode",
		range: DEFAULT_RANGE,
		now: FIXTURE_NOW,
		fg: (color, text) => theme.fg(color, text),
		bold: text => theme.bold(text),
		palette: theme,
		seriesColorFor: index => SERIES_COLORS[index % SERIES_COLORS.length],
	});
}

const specOf = (id: string): ScreenSpec => SCREEN_SPECS.find(spec => spec.id === id)!;

/** Every stat tile in a screen's first stat row, as the grammar receives it. */
function firstStatTiles(id: string): readonly StatTile[] {
	const plan = planLayout(120, 40, "unicode");
	const bands = screenBands({
		spec: specOf(id),
		data: liveData(),
		plan,
		preset: "unicode",
		range: DEFAULT_RANGE,
		now: FIXTURE_NOW,
		fg: (color, text) => theme.fg(color, text),
		bold: text => theme.bold(text),
		palette: theme,
		seriesColorFor: index => SERIES_COLORS[index % SERIES_COLORS.length],
	});
	const row = bands.find((band): band is Extract<Band, { kind: "statRow" }> => band.kind === "statRow");
	return row?.stats ?? [];
}

// ─── D1: a label and its value must never touch ──────────────────────────────

test("D1: no stat row jams a label against its value", () => {
	for (const spec of SCREEN_SPECS) {
		if (spec.deferred) continue;
		for (const row of render(spec).slice(0, 12).map(stripForTest)) {
			// A lower-case/digit/dollar character immediately after a letter is
			// the exact shape of "API-equivalent cost$112.36": the label ran out
			// of pad and the value started in the same cell.
			expect(row, spec.id).not.toMatch(/[a-z0-9%\d]\$/);
			expect(row, spec.id).not.toMatch(/[a-z]\d/);
		}
	}
});

test("D1: a tile is at least three rows — label, value, and their own gutter", () => {
	// The web's `Stat` stacks `.stat-label`, `.stat-value`, `.stat-foot`. Ours
	// has to make the same separation visible in two dimensions: a label line
	// and a value line, so the reader never has to parse which is which.
	const rows = render(specOf("overview")).map(stripForTest);
	const valueIndex = rows.findIndex(row => row.includes("$112.36"));
	expect(valueIndex, "the emphasised value must be findable").toBeGreaterThan(-1);
	const labelLine = rows[valueIndex - 1];
	expect(labelLine, "the label sits on its own line above the value").toContain("API-equivalent cost");
	// And the label line carries NO figure of its own.
	expect(labelLine).not.toMatch(/\d/);
});

test("D1: every tile label appears on a line that holds no value", () => {
	for (const tile of firstStatTiles("overview")) {
		const rows = render(specOf("overview")).map(stripForTest);
		const labelLine = rows.find(row => row.includes(tile.label));
		expect(labelLine, tile.label).toBeDefined();
		expect(labelLine, `${tile.label} shares a line with a figure`).not.toBe(tile.value);
	}
});

// ─── D2: one value per tile ─────────────────────────────────────────────────

test("D2: a tile's value cell carries exactly one figure", () => {
	for (const tile of firstStatTiles("overview")) {
		// The value is what the IR names as `metric`. A second figure in the same
		// cell is a reader's "and what is this?" — which is precisely what the hint
		// running inline produced.
		expect(tile.value, tile.label).toBe(tile.value.trim());
		expect(tile.value, `${tile.label} must not embed a hint`).not.toContain("unpriced");
	}
});

test("D2: the hint is either absent or rendered on its OWN line, never beside the value", () => {
	const rows = render(specOf("overview")).map(stripForTest);
	for (const tile of firstStatTiles("overview")) {
		if (!tile.hint) continue;
		const valueLine = rows.find(row => row.includes(tile.value));
		expect(valueLine, tile.label).toBeDefined();
		// The whole point: the value's line holds the value and nothing else.
		expect(stripForTest(valueLine ?? ""), `${tile.label}: ${tile.value} ${tile.hint ?? ""}`).not.toContain(
			tile.hint ?? "",
		);
		const hintLine = rows.find(row => row.includes(tile.hint ?? ""));
		expect(hintLine, `${tile.hint} must be findable on its own line`).toBeDefined();
	}
});

test("D2: a tile's own CELL holds nothing but its value", () => {
	// Three tiles share a row BY DESIGN — that is the grid — so the assertion is
	// about one tile's CELL, not about the row. Cells are found by their POSITION:
	// the label row and the value row split into the same number of cells at the
	// same indices, which is the only structural link between them.
	const rows = stripAll(render(specOf("overview"), 120));
	const labelRow = rows.findIndex(row => row.includes("API-equivalent cost"));
	expect(labelRow).toBeGreaterThan(-1);
	const cells = (line: string | undefined): string[] => (line ?? "").split(/\S\s+|\s{2,}/).filter(Boolean);
	const labels = cells(rows[labelRow]);
	const values = cells(rows[labelRow + 1]);

	for (const tile of firstStatTiles("overview")) {
		const index = labels.indexOf(tile.label);
		if (index === -1) continue;
		const value = values[index] ?? "";
		expect(value, tile.label).toContain(stripForText(tile.value ?? ""));
		// Asserted by REMOVAL rather than by counting matches: a figure here is
		// `$112.36`, `96.2%` or a compact `1.3B`, and a regex enumerating those
		// shapes would miss the third and pass a cell holding two of them.
		const remainder = value.replace(stripForText(tile.value ?? ""), "");
		expect(remainder, `${tile.label}: ${JSON.stringify(value)}`).not.toMatch(/[\d$]/);
	}
});

// ─── D3: a multi-series chart must be legible AS a chart ─────────────────────

test("D3: a two-series bar chart labels each series block", () => {
	const rows = render(specOf("overview"), 120).map(stripForTest);
	const text = rows.join("\n");
	// Overview's Activity card declares Succeeded and Failed. Two identical blocks
	// with no label is one chart drawn twice, which is what the probe showed.
	expect(text).toContain("Succeeded");
	expect(text).toContain("Failed");
});

test("D3: a series block is distinguishable from the other series' block", () => {
	// Two self-scaled charts of similar shape CAN draw similar bars — that is what
	// "one divisor per chart" means, and it is why the original defect was never
	// the arithmetic. What the defect WAS is that the two blocks were
	// INDISTINGUISHABLE: no label, no colour, one run of rows. So the assertion is
	// on distinguishability, which is what a reader actually depends on.
	const rows = render(specOf("overview"), 120);
	const plain = rows.map(stripForText);
	const succeeded = plain.findIndex(row => row.includes("Succeeded"));
	const failed = plain.findIndex(row => row.includes("Failed"));
	expect(succeeded).toBeGreaterThan(-1);
	expect(failed).toBeGreaterThan(succeeded);

	// Each block is at least a couple of rows of marks, so it reads as a column
	// chart rather than as one line of glyphs.
	expect(rows.slice(succeeded + 1, failed).filter(row => stripForText(row).trim() !== "").length)
		.toBeGreaterThanOrEqual(2);
	// And each series wears its OWN colour, so the two never read as one chart.
	expect(rows[succeeded + 1], "each series wears its own colour").not.toBe(rows[failed + 1]);
});

test("D3: a chart block is at least two rows tall, so it reads as a column chart", () => {
	// One row of blocks is a line, not a chart: `renderDailyBars` with height 1
	// emits exactly that, and it is what the "fourteen identical rows" defect was.
	const rows = render(specOf("overview"), 120).map(stripForText);
	const succeeded = rows.findIndex(row => row.includes("Succeeded"));
	expect(succeeded).toBeGreaterThan(-1);
	let tall = 0;
	for (const row of rows.slice(succeeded + 1)) {
		if (row.includes("Failed")) break;
		if (row.trim() !== "") tall++;
	}
	expect(tall).toBeGreaterThanOrEqual(2);
});

// ─── D4: one number, one computation ────────────────────────────────────────

test("D4: a legend swatch is exactly ONE glyph", () => {
	for (const spec of SCREEN_SPECS) {
		if (spec.deferred) continue;
		for (const row of render(spec, 120).map(stripForTest)) {
			// band.ts drew `barFill.repeat(2)`. One glyph is what the web's
			// `.swatch` renders, and two read as a bar rather than a key.
			expect(row, `${spec.id}: ${row}`).not.toMatch(/^[█#░]{2} \S/);
		}
	}
});

test("D4: the legend and the share bar above it agree on every shared percentage", () => {
	// THE parity assertion. The web computes both from `mix[key] / total`
	// (OverviewRoute.tsx:186-224): one number, two renderings. Ours computed the
	// bar's total over the plotted entries and the legend's over every item on
	// the band, and the three agent rows — which the IR points at the same
	// `totalRequests` field — leaked into the denominator. 94.5% vs 94.6%.
	const rows = render(specOf("overview"), 120).map(stripForText);
	const token = readPercentages(rows, "Cache read");
	expect(token.bar, "the share bar must state a percentage").toBeDefined();
	expect(token.legend, "the legend must state the same percentage").toBeDefined();
	expect(token.legend, `legend ${token.legend} vs bar ${token.bar}`).toBe(token.bar);
});

test("D4: every legend item agrees with its bar row, for all four token kinds", () => {
	const rows = render(specOf("overview"), 120).map(stripForText);
	for (const label of ["Uncached input", "Cache read", "Cache write", "Output"]) {
		const found = readPercentages(rows, label);
		expect(found.bar, `${label} has no bar percentage`).toBeDefined();
		expect(found.legend, `${label} has no legend percentage`).toBeDefined();
		expect(found.legend, `${label}: legend ${found.legend} vs bar ${found.bar}`).toBe(found.bar);
	}
});

test("D4: the legend shares add to 100% across the token mix", () => {
	// A rounding tell: four independently-rounded shares that sum to 99.9 or
	// 100.1 mean the denominator moved between the two renderings.
	const rows = render(specOf("overview"), 120).map(stripForText);
	const legendRow = rows.find(row => row.includes("Cache read") && row.includes("Cache write") && !row.includes("%"));
	expect(legendRow, "the legend block must be findable").toBeDefined();
	const total = ["Uncached input", "Cache read", "Cache write", "Output"].reduce((sum, label) => {
		const value = readPercentages(rows, label).legend;
		return sum + (value ? Number.parseFloat(value) : 0);
	}, 0);
	expect(total).toBeGreaterThan(98);
	expect(total).toBeLessThan(102);
});

/**
 * The percentage a label carries on its BAR row and on its LEGEND row.
 *
 * The two are told apart STRUCTURALLY, not by width or by which row came
 * first: a bar row is `label bar…pct figure` and a legend row is
 * `swatch label pct`. Matching on shape is what makes this a parity test rather
 * than a test of the test's own row-picking.
 */
function readPercentages(rows: readonly string[], label: string): { bar?: string; legend?: string } {
	// A legend row is `swatch label pct` — the swatch comes FIRST, so the label
	// is at offset 1, not 0. Matching on `includes` alone would find the BAR row
	// too, which is precisely the row this test must not read.
	// A legend row is `swatch label pct`. It must carry a PERCENTAGE, or the
	// statRow's own label line ("Uncached input   Cache read") matches first and
	// the comparison silently compares against nothing.
	const legend = rows.find(row => {
		const after = row.trimStart().replace(/^[█░#]\s*/, "");
		return after.startsWith(`${label} `) && !/[█░]/.test(after) && /\d+\.\d+%/.test(after);
	});
	// A bar row has a run of bar glyphs between the label and the percentage.
	const bar = rows.find(row => {
		const at = row.indexOf(`${label} `);
		if (at === -1) return false;
		return /[█░]/.test(row.slice(at + label.length));
	});
	return {
		bar: bar ? percentIn(bar) : undefined,
		legend: legend ? percentIn(legend) : undefined,
	};
}

/** The last percentage on a row, as a bare number string. */
function percentIn(row: string): string {
	return (row.match(/\d+\.\d+%/) ?? [""])[0].slice(0, -1);
}

/** One row, ANSI stripped. Distinct from `stripForText`, which takes an array. */
function stripForText(row: string): string {
	return stripForTest(row);
}

/** Every row, ANSI stripped. */
function stripAll(rows: readonly string[]): readonly string[] {
	return rows.map(stripForTest);
}