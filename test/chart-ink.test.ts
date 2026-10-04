/**
 * `test/chart-ink.test.ts` — what EVERY chart in this panel owes its reader,
 * asserted on rendered output rather than on any one primitive's internals.
 *
 * WHY THIS FILE EXISTS. The complaint that produced it was "charts are badly
 * drawn, colouring is bad", and the captures underneath that complaint all had
 * the same cause: `░` was being emitted as the FILL of the unplotted part of
 * every bar, share bar and ranked row. At `innerWidth` 96 and `barHeight` 14
 * that is a 96 × 14 wall of U+2591 — fourteen hundred glyphs of texture that
 * encodes nothing, drawn in the SERIES colour so it read as data. The web draws
 * nothing there at all: `Chart.tsx:229` is `{!v ? return null : …}`, and the
 * plot's background is the card's own colour.
 *
 * So the rule this file pins is the negative one first — no chart may emit a
 * shade glyph as track or background — and then the four things that must be
 * true once the noise is gone, each of which was previously unfalsifiable
 * because the noise covered everything:
 *
 *   1. **ZERO-BASELINED.** Every filled cell in a column chart is CONTIGUOUS
 *      down to the row above the floor. A chart with a floating block implies a
 *      non-zero baseline, which is a lie about magnitude.
 *   2. **A FLOOR.** Every column chart ends on a row of `axisLine`, so zero has
 *      a place. The web strokes `.chart-baseline` at `y(0)` (`Chart.tsx:304`);
 *      we MARK it instead of drawing it (see the divergence note in bars.ts).
 *   3. **THREE STATES, NOT TWO.** Measured zero, an all-zero series and absent
 *      data are three different claims and must render three different ways.
 *      The web collapses two of them (`Chart.tsx:108`: `empty` is every value
 *      falsy) and so did we; a terminal can do better, because a zero bucket
 *      inside a live series is a visible gap in an otherwise-drawn column.
 *   4. **WIDTH-1 INK.** Every glyph a chart can emit measures exactly one cell
 *      under all three presets, so no chart row can ever be one column wider
 *      than the panel it sits in.
 *
 * Every assertion here is deliberately about OUTPUT — the marks, the colours
 * that reached them, the widths they measure — because "the chart looks right"
 * is a thing a human judges once and a machine never.
 */

import { expect, test } from "bun:test";

import { renderDailyBars, renderModelCostBars } from "../src/tui/charts/bars";
import { renderSeriesChart } from "../src/tui/charts/compose";
import { renderRankedBars, renderShareBar, renderSparkline } from "../src/tui/charts/sparkline";
import { glyph, glyphsFor, type GlyphSet, type SymbolPreset } from "../src/tui/glyphs";
import { stripForTest, type PaletteTheme } from "../src/tui/palette";
import type { CostTimeSeriesPoint } from "@oh-my-pi/omp-stats/shared-types";

const PRESETS: readonly SymbolPreset[] = ["unicode", "nerd", "ascii"];
/** The widths the brief requires every screen captured at, plus the plan's floor. */
const WIDTHS = [20, 40, 60, 100, 150] as const;

/**
 * A theme that needs no omp runtime. `getColorHex` must return a DISTINCT hex
 * per token or `resolveSeries`'s dedupe collapses the palette to one colour and
 * every "these two series differ" assertion below would pass vacuously.
 */
const THEME: PaletteTheme = {
	getColorHex: (token: string) => `#${(token.length * 7919).toString(16).padStart(6, "0").slice(-6)}`,
	getColorMode: () => "truecolor",
	getSymbolPreset: () => "unicode",
};

const identity = (text: string) => text;

/** Visible cells, ANSI excluded. */
const cells = (line: string): number => Bun.stringWidth(stripForTest(line));

/**
 * Options for a column chart, at one width and height. Four primitives are
 * swept against it, so the callbacks stay in lockstep by construction.
 */
const barOpts = (width: number, height: number, glyphs: GlyphSet) => ({
	width,
	height,
	glyphs,
	accent: identity,
	dim: identity,
});

/**
 * Split a rendered column chart into its floor row and the marks above it.
 *
 * Throws rather than returning `undefined`: this is read at six call sites, and
 * a nullable return would mean an unchecked cast at each one to reach `.marks`.
 * A helper that cannot answer its own question should fail the test loudly.
 */
function splitChart(rows: readonly string[], axis: string): { marks: string[]; floor: string } {
	const floor = stripForTest(rows[rows.length - 1] ?? "");
	if (![...floor].every(ch => ch === axis)) {
		throw new Error(`not a column chart (axis ${JSON.stringify(axis)}): ${JSON.stringify(rows)}`);
	}
	return { marks: rows.slice(0, -1), floor };
}

/** Filled cells per column of one column chart's marks. */
function filledPerColumn(chart: { marks: readonly string[] }, fill: string, width: number): number[] {
	const counts = new Array<number>(width).fill(0);
	for (const row of chart.marks) {
		[...stripForTest(row)].forEach((ch, col) => {
			if (ch === fill && col < width) counts[col] = (counts[col] ?? 0) + 1;
		});
	}
	return counts;
}

// ─── 1. No shade glyph is ever chart ink ─────────────────────────────────────

test("no chart primitive emits a shade glyph as track or background", () => {
	// THE defect, stated as an invariant so it cannot come back quietly. The web
	// draws NOTHING in the unplotted part of a plot (`Chart.tsx:229`), and a
	// 6%-white meter track (`styles.css:1380`) is not a glyph. A shade block is
	// neither: it is a cell of texture encoding nothing, and at panel width
	// there are hundreds of them per chart.
	const shade = glyphsFor("unicode").barEmpty;
	if (typeof shade !== "string") throw new Error("barEmpty must be a single glyph to be a shade");
	for (const preset of PRESETS) {
		for (const width of WIDTHS) {
			for (const height of [1, 2, 6, 14]) {
				const bars = renderDailyBars([0, 1, 4, 9, 0, 2], barOpts(width, height, glyphsFor(preset)));
				expect(stripForTest(bars.join("\n")).includes(shade), `${preset}/${width}/${height} bars`).toBe(false);

				const composed = renderSeriesChart(
					[
						{ label: "Succeeded", values: [1, 5, 9, 0] },
						{ label: "Failed", values: [0, 1, 0, 2] },
					],
					{ width, height: height * 2, preset, theme: THEME, paint: (_c, text) => text, labels: false },
				);
				expect(stripForTest(composed.join("\n")).includes(shade), `${preset} compose`).toBe(false);

				const ranked = renderRankedBars(
					[
						{ label: "alpha", value: 9 },
						{ label: "beta", value: 0 },
					],
					{ width, preset, accent: identity },
				);
				expect(stripForTest(ranked.join("\n")).includes(shade), `${preset} ranked`).toBe(false);

				const share = renderShareBar(0.42, { width, preset, accent: identity }, "42.0%");
				expect(share.includes(shade), `${preset} share`).toBe(false);
			}
		}
	}
});

test("a bar chart at panel width is mostly whitespace, not mostly texture", () => {
	// The shape of the complaint, asserted as a ratio so it cannot regress by
	// degrees. A quiet chart is overwhelmingly blank; only the columns that
	// recorded something carry ink, plus one floor row.
	const glyphs = glyphsFor("unicode");
	const values = Array.from({ length: 40 }, (_, i) => (i % 20 === 0 ? 10 : 0));
	const axis = glyph("unicode", "axisLine");
	const chart = splitChart(renderDailyBars(values, barOpts(96, 10, glyphs)), axis);
	const ink = [...stripForTest(chart.marks.join(""))].filter(ch => ch !== " " && ch !== axis).length;
	// Two busy buckets out of forty. Even counting their full columns, ink is a
	// small fraction of the plot; before the fix it was ~99% `░`.
	expect(ink / (chart.marks.length * 96)).toBeLessThan(0.1);
});

// ─── 2. Zero-baselined, with a floor ─────────────────────────────────────────

test("every filled cell in a column chart reaches the floor — nothing floats", () => {
	// A bar with a gap under it claims a non-zero baseline, which silently
	// inflates every magnitude on the chart. Rows come top to bottom, so in each
	// column the filled run must be a SUFFIX of the rows above the floor.
	for (const preset of PRESETS) {
		const glyphs = glyphsFor(preset);
		const fill = glyph(preset, "barFill");
		const axis = glyph(preset, "axisLine");
		const values = [0, 3, 12, 40, 41, 7, 0, 19, 25, 11, 4, 0, 30];
		for (const width of [8, 13, 40]) {
			const chart = splitChart(renderDailyBars(values, barOpts(width, 9, glyphs)), axis);
			for (const [col, filled] of filledPerColumn(chart, fill, width).entries()) {
				if (filled === 0) continue;
				// Rows run top to bottom and a bar rises off the floor, so the
				// filled run must be a SUFFIX: from the top of the bar downward,
				// there is never a blank.
				const column = chart.marks.map(row => [...stripForTest(row)][col] === fill);
				const top = column.findIndex(Boolean);
				expect(
					column.slice(top).every(Boolean),
					`${preset}/${width} col ${col} (${filled} filled): ${column.map(d => (d ? "█" : " ")).join("")}`,
				).toBe(true);
			}
		}
	}
});

test("a column chart's last row is the floor, so zero has a place to be", () => {
	// `Chart.tsx:304` strokes `.chart-baseline` at `y(0)` on every chart. G5 and
	// /usage's zero-rules body forbid us a rule, so we mark the floor with a
	// width-1 glyph instead — see the divergence note in `bars.ts`.
	for (const preset of PRESETS) {
		const glyphs = glyphsFor(preset);
		const axis = glyph(preset, "axisLine");
		for (const height of [2, 4, 9, 14]) {
			const rows = renderDailyBars([0, 3, 9], barOpts(20, height, glyphs));
			expect(rows.length, `${preset}/${height}`).toBe(height);
			expect(stripForTest(rows[rows.length - 1] ?? ""), `${preset}/${height}`).toBe(axis.repeat(20));
		}
	}
});

test("the floor never wears a series colour, and never a data colour either", () => {
	// The web's baseline is `--line-3` and its gridlines are 5.5% white: the
	// floor is chrome. `compose` used to pass the SERIES paint as `dim`, which
	// is how a wall of `░` ended up wearing a data colour.
	const painted = new Set<string>();
	const rows = renderSeriesChart(
		[
			{ label: "Succeeded", values: [1, 5, 9, 0] },
			{ label: "Failed", values: [0, 1, 0, 2] },
		],
		{
			width: 12,
			height: 8,
			preset: "unicode",
			theme: THEME,
			paint: color => {
				painted.add(color);
				return "";
			},
			dim: text => text,
		},
	);
	// Two hues reach `paint`, one per series; the floor went through `dim`. A
	// band only has room for a floor when it has more than one row, so this
	// counts the rows that carry one rather than assuming a row per series.
	expect(painted.size).toBe(2);
	const axis = glyph("unicode", "axisLine");
	const floor = rows.filter(row => stripForTest(row).includes(axis));
	expect(floor.length).toBeGreaterThan(0);
	for (const row of floor) expect(stripForTest(row)).toBe(axis.repeat(12));
});

test("a quiet series draws a SHORTER band than a loud one, not an identical one", () => {
	// THE REGRESSION `compose.ts`'s own header says it exists to prevent, caught
	// by LOOKING at the render rather than by reading the arithmetic. Overview's
	// Succeeded and Failed bands came out pixel-identical: bands were sized by
	// peak share (1 row against 6) and the primitive inside each band then
	// re-scaled against that band's OWN peak, so one row of "Failed" filled one
	// row completely. The allocation said the quiet series was quiet; the
	// geometry said it was not; and the geometry is what a reader sees.
	//
	// One divisor across the bands is the fix — the web's single `leftMax`
	// (`Chart.tsx:83-98`) — and this asserts its observable consequence.
	const rows = renderSeriesChart(
		[
			{ label: "Succeeded", values: [44, 40, 44, 38] },
			{ label: "Failed", values: [4, 4, 4, 4] },
		],
		{ width: 20, height: 14, preset: "unicode", theme: THEME, paint: (_c, text) => text },
	);
	const fill = glyph("unicode", "barFill");
	const succeeded = rows.findIndex(row => stripForTest(row).includes("Succeeded"));
	const failed = rows.findIndex(row => stripForTest(row).includes("Failed"));
	// `renderSeriesChart` labels a band AFTER its marks, so a band's rows are the
	// ones between the previous label and its own.
	const markedRows = (from: number, to: number): number =>
		rows.slice(from, to).filter(row => [...stripForTest(row)].includes(fill)).length;
	const loud = markedRows(0, succeeded);
	const quiet = markedRows(succeeded + 1, failed);
	expect(quiet).toBeGreaterThan(0);
	expect(loud).toBeGreaterThan(quiet);
	// And not by a hair: a 4% band against a 100% one must be visibly shorter, or
	// the reader is being told the failure rate is high.
	expect(quiet * 3).toBeLessThan(loud);
});

test("a one-row chart is marks, not a floor — a quiet series never vanishes", () => {
	// `bandRows` floors a band at one row. Were the floor to eat that row the
	// band would render as a bare baseline and the series would silently
	// disappear, so at height 1 the single row is data.
	const rows = renderDailyBars([0, 4, 0], barOpts(3, 1, glyphsFor("unicode")));
	expect(rows.length).toBe(1);
	expect(rows[0]).toBe(` ${glyph("unicode", "barFill")} `);
});

// ─── 3. Measured zero, an empty series and absent data are three things ──────

test("measured zero, an all-zero series and absent data render three different ways", () => {
	const glyphs = glyphsFor("unicode");
	const axis = glyph("unicode", "axisLine");
	const opts = barOpts(40, 4, glyphs);

	// ABSENT: no buckets at all. One dim sentence, no plot, no floor.
	const absent = renderDailyBars([], opts);
	expect(absent.length).toBe(1);
	expect(absent[0]).toContain("No activity");
	expect(stripForTest(absent[0] ?? "")).not.toContain(axis);

	// EMPTY: buckets exist and every one measured zero. A real chart whose floor
	// is the only ink — present, accounted for, and nothing recorded.
	const empty = splitChart(renderDailyBars([0, 0, 0, 0, 0, 0], opts), axis);
	expect(renderDailyBars([0, 0, 0, 0, 0, 0], opts).length).toBe(4);
	expect(stripForTest(empty.marks.join("")).trim()).toBe("");

	// MEASURED ZERO: one bucket inside a live series. A gap in an otherwise
	// drawn column, with the floor still under it.
	const sparse = renderDailyBars([0, 7, 0, 0], barOpts(4, 4, glyphs));
	// Three magnitude rows, so the one busy bucket fills the top of the chart
	// and the other three are gaps.
	expect([...stripForTest(sparse[0] ?? "")]).toEqual([" ", glyph("unicode", "barFill"), " ", " "]);

	// And the three are pairwise distinguishable as whole renderings.
	const shapes = [absent.join("\n"), empty.marks.join("\n"), sparse.join("\n")];
	expect(new Set(shapes).size).toBe(3);
});

test("the empty state obeys the width rule like every other line", () => {
	// A 35-character message in a 20-column panel is an overflow, and an
	// overflowing line corrupts the panel exactly as an over-wide bar row does.
	for (const width of [1, 8, 20]) {
		for (const row of renderDailyBars([], barOpts(width, 4, glyphsFor("unicode")))) {
			expect(cells(row), `width ${width}`).toBeLessThanOrEqual(width);
		}
	}
});

// ─── 4. Width-1 ink under every preset, at every width ──────────────────────

test("every chart glyph measures exactly one cell under all three presets", () => {
	// One over-wide cell corrupts the whole overlay, because a terminal wraps
	// rather than clips. The glyph module owns the guarantee for the glyphs; this
	// asserts it for the charts that EMIT them, which is where a stray
	// multi-cell character would actually enter a row.
	let distinct = 0;
	const seen = new Set<string>();
	for (const preset of PRESETS) {
		for (const value of Object.values(glyphsFor(preset))) {
			for (const glyph of typeof value === "string" ? [value] : value) {
				if (glyph === " ") continue; // ascii `heatEmpty`, blank by design
				seen.add(glyph);
				expect(Bun.stringWidth(glyph), `${preset} ${JSON.stringify(glyph)}`).toBe(1);
			}
		}
	}
	distinct = seen.size;
	expect(distinct).toBeGreaterThan(10);
});

test("no rendered chart row exceeds the width it was given, swept hard", () => {
	// Swept 20..200 rather than a handful of widths, because an overflow usually
	// appears only at some widths. Every primitive, every preset.
	const values = Array.from({ length: 64 }, (_, i) => (i * 37) % 91);
	for (const preset of PRESETS) {
		const glyphs = glyphsFor(preset);
		for (let width = 20; width <= 200; width++) {
			for (const height of [1, 2, 7, 14]) {
				for (const row of renderDailyBars(values, barOpts(width, height, glyphs))) {
					expect(cells(row), `${preset}/${width}/${height}: ${JSON.stringify(row)}`).toBe(width);
				}
			}
			const composed = renderSeriesChart(
				[
					{ label: "Succeeded", values },
					{ label: "Failed", values: values.map(v => v % 3) },
				],
				{ width, height: 10, preset, theme: THEME, paint: (_c, text) => text },
			);
			for (const row of composed) {
				expect(cells(row), `${preset}/compose/${width}: ${JSON.stringify(row)}`).toBe(width);
			}
			const ranked = renderRankedBars(
				[
					{ label: "a-very-long-model-name-that-needs-truncation", value: 900 },
					{ label: "b", value: 0, unpriced: 4 },
				],
				{ width, preset, accent: identity },
			);
			for (const row of ranked) {
				expect(cells(row), `${preset}/ranked/${width}: ${JSON.stringify(row)}`).toBeLessThanOrEqual(width);
			}
			expect(
				cells(renderShareBar(0.37, { width, preset, accent: identity }, "37.0% 854M")),
				`${preset}/share/${width}`,
			).toBe(width);
			expect(cells(renderSparkline(values, { width, preset })), `${preset}/spark/${width}`).toBe(width);
		}
	}
});

test("no chart body emits a rule — G5 holds for the floor too", () => {
	// `test/band.test.ts` asserts this at the band level; this asserts it for
	// the primitives directly, so a new primitive cannot slip a rule past it.
	const RULE_RUN = /[─━═]{3,}/;
	for (const preset of PRESETS) {
		const glyphs = glyphsFor(preset);
		const width = 60;
		const rendered = [
			...renderDailyBars([0, 3, 9, 1], barOpts(width, 8, glyphs)),
			...renderSeriesChart(
				[
					{ label: "a", values: [1, 2, 3] },
					{ label: "b", values: [3, 2, 1] },
				],
				{ width, height: 8, preset, theme: THEME, paint: (_c, text) => text },
			),
			...renderRankedBars([{ label: "a", value: 3 }], { width, preset, accent: identity }),
			renderShareBar(0.5, { width, preset, accent: identity }, "50%"),
		];
		for (const row of rendered) expect(stripForTest(row), `${preset}: ${row}`).not.toMatch(RULE_RUN);
	}
});

// ─── 5. A cost chart still scales by cost, and still has a floor ─────────────

const COST_POINTS: readonly CostTimeSeriesPoint[] = [
	{
		timestamp: 1_700_000_000_000,
		model: "gpt-5.6-terra",
		provider: "openrouter",
		cost: 42,
		unpricedRequests: 0,
		costInput: 4,
		costOutput: 2,
		costCacheRead: 34,
		costCacheWrite: 2,
		requests: 900,
	},
	{
		timestamp: 1_700_000_000_000,
		model: "deepseek-v4-flash",
		provider: "deepseek",
		cost: 1,
		unpricedRequests: 3,
		costInput: 0.1,
		costOutput: 0.05,
		costCacheRead: 0.8,
		costCacheWrite: 0.05,
		requests: 4_000,
	},
];

test("renderModelCostBars loses the track without losing the cost invariant", () => {
	const glyphs = glyphsFor("unicode");
	const axis = glyph("unicode", "axisLine");
	const chart = splitChart(renderModelCostBars(COST_POINTS, barOpts(2, 6, glyphs)), axis);
	const filled = filledPerColumn(chart, glyph("unicode", "barFill"), 2);
	// The 42x token spender is still the shorter bar: scaling by cost, not tokens.
	expect(filled[0]).toBeGreaterThan(filled[1] ?? 0);
});
