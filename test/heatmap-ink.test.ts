import { expect, test } from "bun:test";

import {
	HEAT_VARIANTS,
	HEAT_VARIANT_BY_ID,
	MONTHS,
	buildMatrix,
	gridWidth,
	renderGrid,
	stripAnsi,
	visibleWidth,
	type HeatVariant,
} from "../scripts/lib/heatmap-ink";

const square = HEAT_VARIANT_BY_ID["unicode-square"] as HeatVariant;
const block = HEAT_VARIANT_BY_ID["unicode-block"] as HeatVariant;
const shade = HEAT_VARIANT_BY_ID["unicode-shade"] as HeatVariant;

/**
 * Deterministic 35 days, column-major: week 0 holds days 0-6, then week 1.
 * The final cell is `null` — a future date, which must render blank rather than
 * as the empty-cell glyph.
 */
const SAMPLE = [
	0, 1, 3, 0, 2, 3, 0, // week 0
	0, 1, 2, 0, 3, 1, 0, // week 1
	2, 4, 1, 0, 3, 0, 2, // week 2
	3, 0, 0, 0, 1, 2, 0, // week 3
	1, 3, 2, 0, 1, 0, null, // week 4
] as const;

test("the three variants named by F19 are present and in order", () => {
	expect(HEAT_VARIANTS.map((v) => v.id)).toEqual([
		"unicode-square",
		"unicode-block",
		"unicode-shade",
	]);
});

test("every variant writes the same pair of glyphs.ts roles", () => {
	for (const variant of HEAT_VARIANTS) {
		expect(variant.glyphsRole).toBe("heatCell");
		expect(variant.emptyRole).toBe("heatEmpty");
		// The switch has to be expressible as data, or the probe would be
		// overstating how cheap the change is.
		expect(variant.switchNote.length).toBeGreaterThan(10);
	}
});

test("every variant cell measures exactly one cell at every level", () => {
	for (const variant of HEAT_VARIANTS) {
		for (const glyph of [...variant.ladder, variant.empty]) {
			expect(Bun.stringWidth(glyph)).toBe(1);
		}
	}
});

test("square and block share one encoding and differ only in the glyph", () => {
	// Both carry the level in truecolor, so every rung repeats the same cell.
	// The only thing under test is WHICH cell that is.
	expect(square.ladder).toEqual(["■", "■", "■", "■"]);
	expect(block.ladder).toEqual(["█", "█", "█", "█"]);
	expect(new Set(square.ladder).size).toBe(1);
	expect(new Set(block.ladder).size).toBe(1);
	expect(square.empty).toBe(block.empty);
});

test("the shade variant ramps the glyph rather than the colour alone", () => {
	expect(shade.ladder).toEqual(["░", "▒", "▓", "█"]);
	expect(new Set(shade.ladder).size).toBe(4);
});

test("a week grid is one month-label row plus seven weekday rows", () => {
	expect(renderGrid(buildMatrix(SAMPLE, 5), { variant: shade, labelWidth: 3 })).toHaveLength(8);
});

test("every row of the grid is exactly the same visible width", () => {
	for (const variant of HEAT_VARIANTS) {
		const rows = renderGrid(buildMatrix(SAMPLE, 5), { variant, labelWidth: 3, colour: true });
		const widths = new Set(rows.map(visibleWidth));
		expect(widths.size).toBe(1);
		expect([...widths][0]).toBe(gridWidth(5, 3));
	}
});

test("gridWidth is the label gutter plus two cells per week column", () => {
	// One glyph plus one space per column, matching heatmap.ts columnWidth = 2.
	expect(gridWidth(26, 3)).toBe(3 + 26 * 2);
	expect(gridWidth(5, 0)).toBe(10);
});

test("a month label overhangs its column exactly as heatmap.ts does", () => {
	// heatmap.ts writes a 3-character label into a 2-cell column buffer, so the
	// label's final character lands on the next column's first cell and is then
	// overwritten by the next label. The probe mirrors that faithfully — a layout
	// the panel never ships would not be a fair thing to judge a glyph by.
	const monthRow =
		renderGrid(buildMatrix(SAMPLE, 5), {
			variant: shade,
			labelWidth: 0,
			months: ["Aug", "Sep"],
		})[0] ?? "";
	expect(monthRow.slice(0, 4)).toBe("AuSe");
	expect(monthRow.slice(4)).toBe("p     ");
});

test("a column with no month label contributes nothing to the header", () => {
	const monthRow =
		renderGrid(buildMatrix(SAMPLE, 5), {
			variant: shade,
			labelWidth: 0,
			months: [null, "Sep"],
		})[0] ?? "";
	expect(monthRow.slice(0, 2)).toBe("  ");
	expect(monthRow.slice(2, 5)).toBe("Sep");
});

test("an absent future date is blank, never the empty-cell glyph", () => {
	// ABSENT must not read as zero activity — that would misreport spend.
	const rows = renderGrid(buildMatrix(SAMPLE, 5), { variant: shade, labelWidth: 3 });
	// Sunday is the last weekday row; its final column is SAMPLE's only `null`.
	const sunday = stripAnsi(rows[7] ?? "");
	expect(sunday.slice(-2)).toBe("  ");
	// Every earlier column in that row is a real day and does carry a glyph.
	expect(sunday.slice(3, -2).trim()).not.toBe("");
});

test("a zero day renders the empty glyph so it still occupies its slot", () => {
	const rows = renderGrid(buildMatrix([0, 0, 0, 0, 0, 0, 0], 1), {
		variant: shade,
		labelWidth: 3,
	});
	// Monday of the single sample week: label gutter, then one empty cell.
	expect(stripAnsi(rows[1] ?? "")).toBe(`M  ${shade.empty} `);
});

test("colour off and colour on render identical visible text", () => {
	const cells = buildMatrix(SAMPLE, 5);
	const plain = renderGrid(cells, { variant: shade, labelWidth: 3, colour: false });
	const painted = renderGrid(cells, { variant: shade, labelWidth: 3, colour: true });
	expect(painted.map(stripAnsi)).toEqual(plain);
});

test("colour on actually emits escapes", () => {
	const rows = renderGrid(buildMatrix(SAMPLE, 5), {
		variant: square,
		labelWidth: 3,
		colour: true,
	});
	expect(rows.some((row) => row.includes("\x1b["))).toBe(true);
});
test("the square variant still varies colour across levels", () => {
	// The whole premise of the colour-only encoding: one glyph, four foregrounds.
	// If these came out identical the option would carry no magnitude at all.
	// Levels 1..4 must sit on ONE weekday row, which means four week COLUMNS.
	// buildMatrix indexes column-major (index = week * 7 + day), so Monday of
	// weeks 0-3 is at indices 0, 7, 14 and 21.
	const cells = [1, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 4];
	const rows = renderGrid(buildMatrix(cells, 4), {
		variant: square,
		labelWidth: 3,
		colour: true,
	});
	const escapes = [...(rows[1] ?? "").matchAll(/\x1b\[38;2;(\d+;\d+;\d+)m/g)].map(
		(m) => m[1],
	);
	expect(new Set(escapes).size).toBe(4);
});

test("stripAnsi removes escapes without changing the visible text", () => {
	expect(stripAnsi("\x1b[38;2;1;2;3m█\x1b[0m")).toBe("█");
	expect(visibleWidth("\x1b[38;2;1;2;3m█\x1b[0m ")).toBe(2);
});

test("visibleWidth agrees with Bun.stringWidth on ANSI-free text", () => {
	expect(visibleWidth("██ ██ ")).toBe(Bun.stringWidth("██ ██ "));
});

test("MONTHS has twelve three-character names", () => {
	expect(MONTHS).toHaveLength(12);
	for (const month of MONTHS) expect(month).toHaveLength(3);
});