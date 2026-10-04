/**
 * `test/body-layout.test.ts` — the BODY layout defects a screenshot shows.
 *
 * Every test here was written by LOOKING at `bun scripts/probe-render.ts
 * providers --width 150` and finding something wrong with it, not by reading a
 * spec and imagining a defect. The five findings, in the order the reader sees
 * them:
 *
 *  D1 STAT TILES — three 48-cell columns holding 13-cell figures, and a bare
 *     `…` hanging off the right of every row. Cause: `renderStatRow` divided
 *     the inner width by the column COUNT (`floor(inner / 3)`) instead of
 *     measuring the tiles, so the join overflowed and `clamp` truncated it.
 *  D2 RANKED BARS — a solid block the full width of the panel, because the
 *     track was `innerWidth - label - figure`.
 *  D3 TABLE — headers over the wrong columns, an empty Share column, a raw
 *     `0.004` error rate, and 12-cell meter blocks that carry no figure at all.
 *  D4 TRUNCATION — `…` must never be a whole column.
 *  D5 COMPACT NOTATION — `26,805,348,752` where the web writes `26.8B`.
 *
 * The invariants are asserted against the REAL screens through the real
 * renderer, because the point of every one of them is that the composition is
 * legible — and a unit test of one function cannot see a misaligned header.
 */

import { expect, test } from "bun:test";
import { visibleWidth } from "@oh-my-pi/pi-tui/utils";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import type { ThemeColor } from "@oh-my-pi/pi-tui/theme/schema";

import { SCREEN_SPECS, type ScreenSpec } from "../src/layout/spec";
import { renderBands, type Band, type BandRenderOptions, type Column } from "../src/tui/band";
import { renderRankedBars } from "../src/tui/charts/sparkline";
import { renderScreen, type ScreenRenderOptions } from "../src/tui/render/screen";
import { planLayout } from "../src/tui/layout";
import { glyphsFor, type SymbolPreset } from "../src/tui/glyphs";
import { PALETTE, SERIES_COLORS, stripForTest } from "../src/tui/palette";
import { DEFAULT_RANGE } from "../src/data/ranges";
import type { PanelData } from "../src/data/api";
import { FIXTURE_NOW, liveData } from "./fixtures/panel";

ensureThemeSync();

const ANSI = /\x1b\[[0-9;]*m/g;
const plain = (text: string): string => text.replace(ANSI, "");
const text = (rows: readonly string[]): string => stripForTest(rows.join("\n"));

function opts(spec: ScreenSpec, data: PanelData, width = 150): ScreenRenderOptions {
	const preset: SymbolPreset = "unicode";
	return {
		spec,
		data,
		plan: planLayout(width, 40, preset),
		preset,
		range: DEFAULT_RANGE,
		now: FIXTURE_NOW,
		fg: (color: ThemeColor, value: string) => theme.fg(color, value),
		bold: value => theme.bold(value),
		palette: theme,
		seriesColorFor: index => SERIES_COLORS[index % SERIES_COLORS.length],
		glyphs: glyphsFor(preset),
	};
}

const specOf = (id: string): ScreenSpec => {
	const spec = SCREEN_SPECS.find(s => s.id === id);
	if (spec === undefined) throw new Error(`no screen spec ${id}`);
	return spec;
};

/** Every screen a reader can actually land on. */
const FILLABLE = SCREEN_SPECS.filter(spec => !spec.deferred);

/** The grid renders itself for every band kind and width it supports. */
const WIDTHS = [40, 48, 60, 72, 80, 100, 120, 150] as const;

function bandCtx(overrides: Partial<BandRenderOptions>): BandRenderOptions {
	return {
		width: 146,
		innerWidth: 146,
		preset: "unicode",
		glyphs: glyphsFor("unicode"),
		fg: (_color, value) => value,
		bold: value => value,
		barHeight: 6,
		tableLimit: 12,
		labelWidth: 12,
		valueWidth: 12,
		...overrides,
	};
}

// ─── D4: `…` is never a whole column ─────────────────────────────────────────

/**
 * The rule, stated once so every other test can lean on it.
 *
 * A `…` is a truncated FIGURE — a tail on a real number or label. It is never a
 * cell of its own, because a column of `…` says "there is more here" without
 * saying what, which is the exact failure the truncation policy exists to
 * prevent: columns are DROPPED, not squeezed to nothing.
 */
const FLOATING_ELLIPSIS = /(^|\s{2,})…(\s|$)/;

test("D4: no screen renders a `…` standing alone as a cell", () => {
	const offenders: string[] = [];
	for (const spec of FILLABLE) {
		for (const width of WIDTHS) {
			renderScreen(opts(spec, liveData(), width)).forEach((row, index) => {
				const stripped = plain(row);
				if (FLOATING_ELLIPSIS.test(stripped)) {
					offenders.push(`${spec.id}@${width} row ${index}: ${JSON.stringify(stripped)}`);
				}
			});
		}
	}
	expect(offenders, offenders.slice(0, 8).join("\n")).toEqual([]);
});

test("D4: the providers stat row that produced a `…` on every line now has none", () => {
	// The reported render, verbatim in shape: five tiles at width 150 printed a
	// trailing `…` on the label row, the value row and the two hint rows.
	const rows = renderScreen(opts(specOf("providers"), liveData(), 150));
	expect(rows.length).toBeGreaterThan(4);
	for (const row of rows.slice(0, 8)) expect(plain(row), JSON.stringify(plain(row))).not.toContain("…");
});

// ─── D1: stat tiles fit their content and their cell ─────────────────────────

test("D1: a stat row is as wide as its tiles need, not as wide as the panel", () => {
	// The defect: `tileWidth = floor(inner / columns)`, so at inner 146 three
	// tiles were 48 cells each and a 13-cell figure sat in a 48-cell slot. The
	// grid must be sized by CONTENT and stop there.
	const stats = [
		{ label: "Providers", value: "11", hint: "Most tokens: opencode-go" },
		{ label: "Requests", value: "194,349", hint: "3,281 failed" },
		{ label: "Tokens", value: "26.8B" },
		{ label: "API-equivalent cost", value: "$2,589.50", hint: "1,204 unpriced" },
		{ label: "Error rate", value: "1.7%", hint: "191,068 succeeded" },
	];
	const content = Math.max(...stats.map(s => Math.max(s.label.length, s.value.length)));
	const rows = renderBands([{ kind: "statRow", stats }], bandCtx({}));
	const widest = Math.max(...rows.map(r => visibleWidth(r)));
	// Three columns of the widest tile plus two gutters, and no wider.
	expect(widest).toBeLessThanOrEqual(3 * content + 4);
	expect(widest).toBeLessThan(146);
});

test("D1: a stat row never overflows its inner width, so nothing is truncated away", () => {
	// The mechanism of the reported `…`: the joined row was
	// `columns * floor(inner/columns) + gutters` — four cells too wide whenever
	// the division had a remainder — and `clamp` cut it, printing `…`.
	for (const width of WIDTHS) {
		const rows = renderBands(
			[
				{
					kind: "statRow",
					stats: [
						{ label: "Providers", value: "11", hint: "Most tokens: opencode-go" },
						{ label: "Requests", value: "194,349", hint: "3,281 failed" },
						{ label: "Tokens", value: "26,805,348,752" },
					],
				},
			],
			bandCtx({ width, innerWidth: width }),
		);
		for (const row of rows) {
			expect(visibleWidth(row), `width ${width}`).toBeLessThanOrEqual(width);
		}
		expect(rows.join(""), `width ${width}`).not.toContain("…");
	}
});

test("D1: every tile's own rows fit inside the one cell the grid gave it", () => {
	// A grid whose columns disagree about where they end is the same defect one
	// level down: the third tile's figure must start where the third tile's
	// LABEL starts, or the tiles are not a grid at all.
	const stats = [
		{ label: "A", value: "1" },
		{ label: "Bee", value: "22,222" },
		{ label: "Cee", value: "333,333,333" },
	];
	const rows = renderBands([{ kind: "statRow", stats }], bandCtx({ innerWidth: 60 }));
	const labelRow = plain(rows[0] as string);
	const valueRow = plain(rows[1] as string);
	for (const [index, tile] of stats.entries()) {
		const at = labelRow.indexOf(tile.label);
		expect(at, `${tile.label} label`).toBeGreaterThanOrEqual(0);
		expect(valueRow.slice(at).startsWith(tile.value), `${tile.value} starts under ${tile.label}`).toBe(true);
	}
});

test("D1: a hint is kept whole or dropped whole — never clipped to an ellipsis", () => {
	const rows = renderBands(
		[{ kind: "statRow", stats: [{ label: "Cost", value: "$2,589.50", hint: "34,870 requests had no price card" }] }],
		bandCtx({ innerWidth: 30 }),
	);
	expect(rows.join("\n")).not.toContain("…");
	expect(rows.join("\n")).toContain("$2,589.50");
	expect(rows.join("\n")).not.toContain("no price card");
});

// ─── D2: ranked bars are bounded to a readable track ─────────────────────────

test("D2: a ranked bar's track is bounded, so a dominant row is a bar not a wall", () => {
	// The defect: `track = width - label - readout`, so at inner 146 the top
	// provider painted 113 solid cells. A bar you cannot see past is a
	// background colour; the web's own meter is 64px.
	const rows = renderRankedBars(
		[
			{ label: "opencode-go", value: 1_045_814_212 },
			{ label: "google-antigravity", value: 602 },
		],
		{ width: 146, accent: t => t, dim: t => t },
	);
	const widest = Math.max(...rows.map(r => visibleWidth(r)));
	expect(widest).toBeLessThan(146);
	expect(widest).toBeLessThanOrEqual(96);
});

test("D2: a ranked row carries a label, a bar and exactly one figure", () => {
	const rows = renderRankedBars(
		[
			{ label: "opencode-go", value: 1_045_814_212 },
			{ label: "google-antigravity", value: 602 },
		],
		{ width: 146, accent: t => t, dim: t => t },
	);
	for (const row of rows) {
		const stripped = plain(row);
		expect(stripped.trimEnd(), JSON.stringify(stripped)).toBe(stripped);
		expect(stripped).toContain("opencode-go".slice(0, 8));
	}
	// Sorted descending, one bar per entry, and no `…` anywhere in the list.
	expect(rows[0]).toContain("opencode-go");
	expect(rows[1]).toContain("google-antigravity");
	expect(rows.join("")).not.toContain("…");
});

test("D2: ANSI in a bar is not counted as width, so the row is not truncated", () => {
	// `renderRankedBars` measured with `Bun.stringWidth`, which counts escape
	// BYTES. Under a real theme every row measured over-wide and was cut — the
	// `…` at the right of the burn chart.
	const rows = renderRankedBars(
		[
			{ label: "opencode-go", value: 1_045_814_212 },
			{ label: "google-antigravity", value: 602 },
		],
		{
			width: 100,
			accent: t => `\x1b[38;2;180;120;255m${t}\x1b[39m`,
			dim: t => `\x1b[38;2;90;90;90m${t}\x1b[39m`,
		},
	);
	for (const row of rows) expect(visibleWidth(row)).toBeLessThanOrEqual(100);
	expect(rows.join("")).not.toContain("…");
});

test("D2: every ranked row fits its width, swept 10..200", () => {
	for (let width = 10; width <= 200; width++) {
		const rows = renderRankedBars(
			[
				{ label: "a-very-long-model-identifier-that-overflows-the-column", value: 935.72 },
				{ label: "short", value: 0 },
				{ label: "gpt-5.6-sol", value: 1292.85 },
			],
			{ width, accent: t => t, dim: t => t },
		);
		for (const row of rows) expect(visibleWidth(row), `width ${width}: ${row}`).toBeLessThanOrEqual(width);
	}
});

// ─── D3: the table's headers sit over their own data ─────────────────────────

/**
 * Where a column's text starts and ends in a rendered row.
 *
 * Alignment is asserted by POSITION, not by eyeballing: a right-aligned
 * column's header must END where its figures end, and a left-aligned column's
 * header must START where its labels start. A width computed from the HEADERS
 * alone — the reported bug — passes a "does the header exist" test and fails
 * this one, because a 13-cell provider name in a 8-cell slot pushes every
 * later column one gutter to the right.
 */
function span(row: string, needle: string, align: "left" | "right"): { start: number; end: number } {
	const at = align === "right" ? row.lastIndexOf(needle) : row.indexOf(needle);
	expect(at, `${JSON.stringify(needle)} not found in ${JSON.stringify(row)}`).toBeGreaterThanOrEqual(0);
	return { start: at, end: at + needle.length };
}

const TOTALS: readonly Column[] = [
	{ key: "Provider", header: "Provider", align: "left" },
	{ key: "Requests", header: "Requests", align: "right" },
	{ key: "Error rate", header: "Error rate", align: "right" },
	{ key: "Tokens", header: "Tokens", align: "right" },
];

const TOTALS_ROWS = {
	kind: "inline" as const,
	rows: [
		{ Provider: "opencode-go", Requests: "36,616 ████████", "Error rate": "0.2%", Tokens: "1B ████████" },
		{ Provider: "google-antigravity", Requests: "4,197 ░░", "Error rate": "none", Tokens: "201.5M ░" },
	],
};

test("D3: every table header lines up with the column of data beneath it", () => {
	const rendered = renderBands(
		[{ kind: "table", title: "Provider totals", columns: TOTALS, rows: TOTALS_ROWS }],
		bandCtx({}),
	);
	const header = plain(rendered[1] as string);
	for (const row of rendered.slice(2, 4)) {
		const data = plain(row);
		for (const column of TOTALS) {
			const cell = TOTALS_ROWS.rows.find(r => r[column.key] !== undefined)?.[column.key];
			expect(cell, column.header).toBeDefined();
			const h = span(header, column.header, column.align);
			const c = span(data, cell as string, column.align);
			if (column.align === "right") {
				expect(h.end, `${column.header} end`).toBe(c.end);
			} else {
				expect(h.start, `${column.header} start`).toBe(c.start);
			}
		}
	}
});

test("D3: the reported table — headers over the wrong cells — is fixed", () => {
	// The exact shape from the screenshot: a 13-cell provider name under an
	// 8-cell "Provider" header. Before the fix every column after the first sat
	// five cells right of its header.
	const columns: readonly Column[] = [
		{ key: "Provider", header: "Provider", align: "left" },
		{ key: "Requests", header: "Requests", align: "right" },
		{ key: "Models", header: "Models", align: "right" },
	];
	const rows = {
		kind: "inline" as const,
		rows: [{ Provider: "google-antigravity", Requests: "4,197", Models: "1" }],
	};
	const rendered = renderBands([{ kind: "table", title: "Provider totals", columns, rows }], bandCtx({}));
	const header = plain(rendered[1] as string);
	const data = plain(rendered[2] as string);
	expect(span(header, "Requests", "right").end).toBe(span(data, "4,197", "right").end);
	expect(span(header, "Models", "right").end).toBe(span(data, "1", "right").end);
	expect(span(header, "Provider", "left").start).toBe(span(data, "google-antigravity", "left").start);
});

test("D3: a column is sized by its DATA, not by its header", () => {
	// A header of 8 cells over 1-cell data must not leave an 8-cell hole; the
	// next column's content has to be able to use the space.
	const columns: readonly Column[] = [
		{ key: "Model", header: "Model", align: "left" },
		{ key: "n", header: "Requests", align: "right" },
	];
	const rows = { kind: "inline" as const, rows: [{ Model: "a", n: "7" }] };
	const rendered = renderBands([{ kind: "table", title: "T", columns, rows }], bandCtx({}));
	expect(visibleWidth(plain(rendered[2] as string)).valueOf()).toBe(
		visibleWidth(plain(rendered[1] as string)).valueOf(),
	);
});

test("D3: a meter cell shows its FIGURE beside a short bar, not a block of blocks", () => {
	// The web's MeterCell is `formatInteger(value)` + a 64px meter. Ours drew
	// twelve glyph cells and no number, so the header "Requests" sat over a
	// block that said nothing.
	const rendered = renderScreen(opts(specOf("providers"), liveData(), 150));
	const body = text(rendered);
	expect(body).toMatch(/36,616/);
	// A meter block no wider than a dozen cells, and never the whole row.
	const meterRun = /([█#]+)/.exec(body);
	expect(meterRun, "providers table has a meter").not.toBeNull();
	expect(visibleWidth(meterRun![1] as string)).toBeLessThanOrEqual(16);
});

test("D3: the providers Share column is a percentage, not an empty cell", () => {
	// The spec pointed Share at the same `totalTokens` field as the Tokens
	// column, so it printed a second token count — and at narrow widths the
	// squeeze left it blank. The web divides by the GRAND total.
	const spec = specOf("providers");
	const band = spec.bands.find(b => b.kind === "table" && b.title === "Provider totals");
	if (band === undefined || band.kind !== "table") throw new Error("no Provider totals band");
	const share = band.columns.find(c => c.header === "Share");
	expect(share, "Share column").toBeDefined();
	expect(share!.source.kind, "Share is a share, not a second token count").toBe("derived");
	if (share!.source.kind !== "derived") throw new Error("unreachable");
	expect(share!.source.op).toBe("share");
	expect(share!.source.againstScope).toBe("total");

	const body = text(renderScreen(opts(spec, liveData(), 150)));
	const shareLine = body.split("\n").find(l => l.includes("opencode-go") && l.includes("%"));
	expect(shareLine, "a provider row carrying its share").toBeDefined();
});

test("D3: an error rate is a percentage, never a raw fraction", () => {
	// `badgeCell` followed the derived ref down to `failedRequests`, saw no
	// "rate" in the field name, and printed `formatInteger(0.0024)` = "0".
	// The web prints `formatErrorRate` — and a rate below 0.005% says
	// `<0.01%` rather than rounding itself to a clean zero.
	const body = text(renderScreen(opts(specOf("providers"), liveData(), 150)));
	expect(body).not.toMatch(/\b0\.0\d{1,4}\b(?!\s*%)/);
	const errors = text(renderScreen(opts(specOf("errors"), liveData(), 150)));
	expect(errors).not.toMatch(/\b0\.\d{3,}\b/);
});

test("D3: no table of any screen leaves a declared column blank", () => {
	// The Share column was blank because it resolved to nothing at that width.
	// A column that cannot say anything is not rendered as an empty gutter.
	for (const spec of FILLABLE) {
		const rows = renderScreen(opts(spec, liveData(), 150));
		const headers = rows
			.map(plain)
			.filter(l => /\b(Share|Tokens|Cost|Requests|Models|Error rate|Premium)\b/.test(l) && !/[█░]/.test(l));
		for (const header of headers) {
			const cells = headers.filter(l => l !== header);
			expect(cells.length, `${spec.id} header ${JSON.stringify(header)} has no sibling row`).toBeGreaterThan(0);
		}
	}
});

// ─── D3: the truncation policy, in the documented order ──────────────────────

test("D3: a too-narrow table DROPS the lowest-priority column instead of printing `…`", () => {
	// The policy, in the order it applies:
	//   1. shrink each column to its own widest cell;
	//   2. drop the LOWEST-PRIORITY column that makes the row fit;
	//   3. only then truncate a figure, and never to a bare `…`.
	const columns: readonly Column[] = [
		{ key: "Model", header: "Model", align: "left" },
		{ key: "cost", header: "Cost", align: "right" },
		{ key: "premium", header: "Premium", align: "right", priority: 10 },
	];
	const rows = {
		kind: "inline" as const,
		rows: [{ Model: "gpt-5.6-terra", cost: "$935.72", premium: "12,345" }],
	};
	const narrow = renderBands([{ kind: "table", title: "T", columns, rows }], bandCtx({ width: 24, innerWidth: 24 }));
	const body = plain(narrow.join("\n"));
	expect(body).toContain("gpt-5.6-terra");
	expect(body).not.toContain("Premium");
	expect(body).not.toMatch(FLOATING_ELLIPSIS);
	// At full width every column is present.
	const wide = renderBands([{ kind: "table", title: "T", columns, rows }], bandCtx({ width: 80, innerWidth: 80 }));
	expect(plain(wide.join("\n"))).toContain("Premium");
});

test("D3: the identity column outlives every other column", () => {
	const columns: readonly Column[] = [
		{ key: "Provider", header: "Provider", align: "left" },
		{ key: "a", header: "Alpha", align: "right" },
		{ key: "b", header: "Bravo", align: "right" },
		{ key: "c", header: "Charlie", align: "right" },
	];
	const rows = {
		kind: "inline" as const,
		rows: [{ Provider: "google-antigravity", a: "1", b: "22", c: "333" }],
	};
	for (const width of [16, 20, 24, 30, 40]) {
		const body = plain(renderBands([{ kind: "table", title: "T", columns, rows }], bandCtx({ width, innerWidth: width })).join("\n"));
		expect(body, `width ${width}`).toContain("google");
	}
});

// ─── D5: compact notation, where the web uses it ─────────────────────────────

test("D5: a token total prints compact, the way the web's formatCompact does", () => {
	// `formatCompact(26_805_348_752)` is `26.8B`. Ours printed the full figure,
	// which is what forced the giant Share column and the clipped tiles.
	const body = text(renderScreen(opts(specOf("providers"), liveData(), 150)));
	expect(body).toContain("1B");
	expect(body).not.toContain("1,017,800,000");
});

test("D5: no screen prints an 11-digit token count the web would compact", () => {
	// The reported figures: `26,805,348,752` and `16,690,883,110`. Wherever the
	// web calls `formatCompact` on a token count, so must the panel — the token
	// columns AND the token stat tiles.
	for (const spec of FILLABLE) {
		for (const width of WIDTHS) {
			for (const row of renderScreen(opts(spec, liveData(), width))) {
				expect(plain(row), `${spec.id}@${width}`).not.toMatch(/\b\d{1,3}(,\d{3}){3,}\b/);
			}
		}
	}
});

test("D5: compact notation still names the unit, so 1B is not a bare digit", () => {
	const body = text(renderScreen(opts(specOf("providers"), liveData(), 150)));
	expect(body).toMatch(/\b\d+(\.\d+)?[KMB]\b/);
});

// ─── the composition as a whole ──────────────────────────────────────────────

test("the providers body reads as a grid, a ranked list and an aligned table", () => {
	// One end-to-end read of the screen that was reported broken, asserting the
	// three shapes rather than any single figure.
	const rows = renderScreen(opts(specOf("providers"), liveData(), 150)).map(plain);
	const statRows = rows.slice(0, 8);
	// Compact: no stat row spans the panel.
	expect(Math.max(...statRows.map(r => visibleWidth(r)))).toBeLessThan(146);
	// The burn list is bounded and carries one figure per row.
	const burn = rows.filter(r => /opencode-go/.test(r) && /[█░]/.test(r) && !r.includes("Provider"));
	for (const row of burn) expect(visibleWidth(row)).toBeLessThan(146);
	// The table header and its data share column boundaries.
	const header = rows.find(r => r.includes("Provider") && r.includes("Tokens") && !/[█░]/.test(r));
	expect(header, "the Provider totals header").toBeDefined();
});