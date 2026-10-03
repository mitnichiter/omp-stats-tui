import { expect, test } from "bun:test";
import {
	renderBands,
	type Band,
	type BandRenderOptions,
	type ChartSpec,
	type Column,
	type LegendItem,
	type StatTile,
} from "../src/tui/band";
import { glyphsFor, type SymbolPreset } from "../src/tui/glyphs";
import { PALETTE, SERIES_COLORS } from "../src/tui/palette";
import { visibleWidth } from "@oh-my-pi/pi-tui/utils";

const PRESETS: SymbolPreset[] = ["unicode", "nerd", "ascii"];

// ─── Fixtures ────────────────────────────────────────────────────────────────

const tiles: StatTile[] = [
	{ label: "Cost", value: "$2,582.33", emphasis: "primary" },
	{ label: "Requests", value: "185,240", hint: "0 failed" },
	{ label: "Cache rate", value: "95.5% cache", hint: "23.2B cache-read" },
	{ label: "Avg latency", value: "4.5s" },
];

const columns: Column[] = [
	{ key: "model", header: "Model", align: "left" },
	{ key: "cost", header: "Cost", align: "right" },
	{ key: "unpriced", header: "Unpriced", align: "right" },
];

const rows = {
	kind: "inline" as const,
	rows: [
		{ model: "gpt-5.6-terra", cost: "$935.72", unpriced: "0" },
		{ model: "space-bunny-free", cost: "$0.00", unpriced: "34,870" },
	],
};

const legendItems: LegendItem[] = [
	{ label: "Main agent", share: 0.72 },
	{ label: "Subagents", share: 0.28 },
];

const chart: ChartSpec = {
	type: "bars",
	axis: "Per day",
	render: () => ["███░░░", "██████"],
};

/** Every band kind, in one list, so a rule sweep covers the whole grammar. */
const ALL_KINDS: Band[] = [
	{ kind: "statRow", stats: tiles },
	{ kind: "chart", title: "Daily cost", chart, source: "all time" },
	{ kind: "table", title: "Models", columns, rows },
	{ kind: "legend", items: legendItems },
	{ kind: "note", text: "This is not a zero." },
	{ kind: "custom", id: "overview-extra", render: () => ["custom body"] },
];

/**
 * A fake theme that emits REAL zero-width ANSI, with one 256-colour code per
 * theme token so a test can decode which ROLE was used.
 *
 * Real escapes rather than `<token>` markers on purpose: `visibleWidth` counts
 * literal characters, so a marker-based fake would inflate every row's width
 * and quietly break the width assertions this file exists to make. Decoding
 * the escape back to a token name still lets the colour tests assert roles
 * rather than ANSI bytes.
 */
const TOKENS = [
	"accent",
	"muted",
	"dim",
	"text",
	"mdHeading",
	"error",
	"success",
	"warning",
	"borderAccent",
	"mdLink",
] as const;

const SET_FG = (i: number) => `\x1b[38;5;${20 + i}m`;
const RESET_FG = "\x1b[39m";
const SET_BOLD = "\x1b[1m";
const RESET_BOLD = "\x1b[22m";

function ctx(overrides: Partial<BandRenderOptions> = {}): BandRenderOptions {
	return {
		width: 80,
		innerWidth: 78,
		preset: "unicode",
		glyphs: glyphsFor("unicode"),
		fg: (color, text) => {
			const i = TOKENS.indexOf(color as (typeof TOKENS)[number]);
			if (i < 0) throw new Error(`unknown theme token ${color}`);
			return `${SET_FG(i)}${text}${RESET_FG}`;
		},
		bold: (t) => `${SET_BOLD}${t}${RESET_BOLD}`,
		barHeight: 6,
		tableLimit: 10,
		labelWidth: 12,
		valueWidth: 12,
		...overrides,
	};
}

/** Strip every ANSI escape, leaving plain text. */
function plain(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

/** The theme tokens this output asked for, deduped, in first-seen order. */
function tokensUsed(text: string): string[] {
	const found = [...text.matchAll(/\x1b\[38;5;([0-9]+)m/g)]
		.map((m) => TOKENS[Number(m[1]) - 20])
		.filter((t): t is (typeof TOKENS)[number] => t !== undefined);
	return [...new Set(found)];
}

/**
 * G5 verbatim from F23: "no band body may emit a full-width rule. `─`, `━`, `═`
 * in a band is a bug. This is the single invariant that kills the complaint."
 *
 * The whole reason this module exists: the panel read as stacked text blocks
 * with a `───` rule above every section. `/usage` draws ZERO rules inside its
 * body. So the assertion is written LITERALLY — match a run of rule characters
 * and assert none is produced — rather than trusting a rendering convention.
 */
const RULE_RUN = /[─━═]{3,}/;

test("G5: no band body emits a rule — for every kind, under every preset", () => {
	for (const preset of PRESETS) {
		const bands = ALL_KINDS.map((b) =>
			"preset" in b && b.preset === undefined ? ({ ...b, preset } as Band) : b,
		);
		const rendered = renderBands(bands, ctx({ preset, glyphs: glyphsFor(preset) }));
		for (const row of rendered) {
			expect(row, `${preset}: ${row}`).not.toMatch(RULE_RUN);
		}
	}
});

test("G5: a single band kind on its own emits no rule either", () => {
	for (const band of ALL_KINDS) {
		for (const preset of PRESETS) {
			const rendered = renderBands([band], ctx({ preset, glyphs: glyphsFor(preset) }));
			for (const row of rendered) expect(row, `${band.kind}/${preset}`).not.toMatch(RULE_RUN);
		}
	}
});

test("G5: a realistic screen of every kind emits no rule", () => {
	const screen: Band[] = [
		{ kind: "statRow", stats: tiles },
		{ kind: "note", text: "Cost is a floor: 34,870 requests could not be priced." },
		{ kind: "chart", title: "Daily cost", chart, source: "all time" },
		{ kind: "legend", items: legendItems },
		{ kind: "table", title: "Top models", columns, rows, source: "all time" },
	];
	const rendered = renderBands(screen, ctx());
	for (const row of rendered) expect(row).not.toMatch(RULE_RUN);
});

// ─── G4: exactly one blank line between consecutive bands ────────────────────

test("G4: exactly one blank line separates consecutive bands", () => {
	const rendered = renderBands([{ kind: "chart", title: "A", chart }, { kind: "note", text: "B" }], ctx());
	const joined = rendered.join("\n");
	expect(joined).toContain("\n\n");
	// Never two in a row, and never a leading or trailing blank.
	expect(joined).not.toContain("\n\n\n");
	expect(joined.startsWith("\n")).toBe(false);
	expect(joined.endsWith("\n")).toBe(false);
	expect(rendered[0]?.trim()).not.toBe("");
	expect(rendered[rendered.length - 1]?.trim()).not.toBe("");
});

test("G4: an empty band contributes nothing and leaves no gap", () => {
	const withEmpty = renderBands(
		[
			{ kind: "chart", title: "A", chart },
			{ kind: "table", title: "empty", columns, rows: { kind: "inline", rows: [] } },
			{ kind: "note", text: "B" },
		],
		ctx(),
	);
	const withoutEmpty = renderBands(
		[{ kind: "chart", title: "A", chart }, { kind: "note", text: "B" }],
		ctx(),
	);
	expect(withEmpty).toEqual(withoutEmpty);
});

test("G4: an empty band list renders nothing at all", () => {
	expect(renderBands([], ctx())).toEqual([]);
});

test("G4: a chart whose renderer returns nothing contributes nothing", () => {
	const rendered = renderBands(
		[
			{ kind: "note", text: "before" },
			{ kind: "chart", title: "empty chart", chart: { type: "bars", axis: "day", render: () => [] } },
			{ kind: "note", text: "after" },
		],
		ctx(),
	);
	// Exactly ONE blank line between the two notes: the empty chart contributes
	// nothing and leaves no gap of its own.
	expect(rendered).toHaveLength(3);
	expect(rendered[1]).toBe("");
	expect(plain(rendered[0] as string)).toBe("before");
	expect(plain(rendered[2] as string)).toBe("after");
});

// ─── G2: the heading line ────────────────────────────────────────────────────

test("G2: the heading is icon + bold accent title + dim meta on ONE line", () => {
	const [first] = renderBands([{ kind: "chart", title: "Daily cost", chart, source: "all time" }], ctx());
	expect(first).toBeDefined();
	// One line carries all three parts; a rule would have become a second line.
	expect(first?.includes("\n")).toBe(false);
	expect(first).toContain("Daily cost");
	expect(first).toContain("all time");
	expect(first?.startsWith(" ")).toBe(false);
	expect(first?.endsWith(" ")).toBe(false);
});

test("G2: a band with no meta still renders a heading", () => {
	const [first] = renderBands([{ kind: "chart", title: "Daily cost", chart }], ctx());
	expect(first).toContain("Daily cost");
});

test("G2: a chart with no source states its axis in the meta", () => {
	// The web puts the bucket unit in the card description ("Per hour",
	// "Per UTC day"); the renderer owns that, and stating it beats a chart that
	// silently picks one.
	const [first] = renderBands(
		[{ kind: "chart", title: "Activity", chart: { type: "bars", axis: "Per hour", render: () => ["x"] } }],
		ctx(),
	);
	expect(first).toContain("Per hour");
});

test("G2: table headings carry an icon and the band title", () => {
	const [first] = renderBands([{ kind: "table", title: "Models", columns, rows }], ctx());
	expect(first).toContain("Models");
	expect(first?.startsWith(" ")).toBe(false);
});

// ─── G3: statRow and note have no heading and no icon ───────────────────────

test("G3: a statRow is tiles only — no heading line, no icon", () => {
	const rendered = renderBands([{ kind: "statRow", stats: tiles }], ctx());
	expect(rendered.length).toBeGreaterThan(0);
	for (const row of rendered) {
		expect(row).not.toContain("Stats");
		expect(row).not.toMatch(RULE_RUN);
	}
	// The first line is a tile line: it carries a tile's label and value.
	expect(rendered[0]).toContain("Cost");
	expect(rendered[0]).toContain("$2,582.33");
});

test("G3: a note is one dim line with no heading and no icon", () => {
	const rendered = renderBands([{ kind: "note", text: "This is not a zero." }], ctx());
	expect(rendered).toHaveLength(1);
	expect(plain(rendered[0] as string)).toBe("This is not a zero.");
});

test("G3: statRow and note render identically without a preceding band", () => {
	// No heading means these two are the page's FIRST line and its inline
	// caveat — mirroring StatGrid sitting directly under PageHeader.
	const alone = renderBands([{ kind: "note", text: "x" }], ctx());
	const after = renderBands([{ kind: "note", text: "a" }, { kind: "note", text: "x" }], ctx());
	expect(plain(after[after.length - 1] as string)).toBe(plain(alone[0] as string));
});

// ─── legend: the deliberate G4 exception ────────────────────────────────────

test("legend produces NO blank line before it and exactly one after", () => {
	const rendered = renderBands(
		[
			{ kind: "chart", title: "Activity", chart },
			{ kind: "legend", items: legendItems },
			{ kind: "note", text: "after" },
		],
		ctx(),
	);
	const noteAt = rendered.findIndex((r) => plain(r) === "after");
	// The two legend rows sit directly beneath the chart's own rows — in the web
	// a legend lives INSIDE the card, so no blank line separates them. The only
	// blank line in the block is the one immediately before the note.
	const beforeNote = rendered.slice(0, noteAt - 1);
	expect(beforeNote.some((r) => r === "")).toBe(false);
	expect(beforeNote.some((r) => plain(r).includes("Main agent"))).toBe(true);
	expect(rendered[noteAt - 1]).toBe("");
	expect(noteAt).toBe(rendered.length - 1);
});

test("legend emits no heading of its own", () => {
	const [first] = renderBands([{ kind: "legend", items: legendItems }], ctx());
	expect(first).not.toContain("Legend");
	expect(first).toContain("Main agent");
});

test("legend renders a row per item with a right-aligned share", () => {
	const rendered = renderBands([{ kind: "legend", items: legendItems }], ctx());
	expect(rendered).toHaveLength(2);
	expect(rendered[0]).toContain("Main agent");
	expect(rendered[0]).toContain("72.0%");
	expect(rendered[1]).toContain("28.0%");
	// Shares are right-aligned in a fixed column so the decimals line up.
	expect(rendered.map(plain)[0]?.indexOf("72.0%")).toBe(rendered.map(plain)[1]?.indexOf("28.0%"));
});

test("an empty legend contributes nothing", () => {
	expect(renderBands([{ kind: "legend", items: [] }], ctx())).toEqual([]);
});

// ─── Per-kind layout, as specified ──────────────────────────────────────────

test("statRow lays tiles out in columns of at least 1 and fills the row", () => {
	const rendered = renderBands([{ kind: "statRow", stats: tiles }], ctx({ innerWidth: 78 }));
	// 78 / 34 = 2 columns → 2 tile rows for 4 tiles.
	expect(rendered).toHaveLength(2);
	for (const row of rendered) expect(row.trim()).not.toBe("");
});

test("statRow drops a hint that does not fit whole and never truncates one", () => {
	// F23 2.3 rule 2: hints are DROPPED, never truncated — "a half-printed
	// '34,870 unpr' is a worse claim than no hint".
	const wide: StatTile[] = [{ label: "Cost", value: "$935.72", hint: "34,870 unpriced requests" }];
	const narrow = renderBands([{ kind: "statRow", stats: wide }], ctx({ innerWidth: 34 }));
	expect(narrow[0]).toContain("$935.72");
	expect(narrow.join("")).not.toContain("34,870 unpriced requests");
	expect(narrow.join("")).not.toContain("…");
});

test("statRow keeps a hint that fits whole", () => {
	const rendered = renderBands([{ kind: "statRow", stats: [{ label: "Cost", value: "$935.72", hint: "0 unpriced" }] }], ctx({ innerWidth: 78 }));
	expect(rendered[0]).toContain("0 unpriced");
});

test("statRow truncates the VALUE, never the label, when a tile is too narrow", () => {
	// F23 2.3 rule 3: a truncated label is still a label.
	const rendered = renderBands(
		[{ kind: "statRow", stats: [{ label: "Cache rate", value: "a-very-long-value-that-cannot-fit" }] }],
		ctx({ innerWidth: 20 }),
	);
	expect(rendered[0]).toContain("Cache rate");
	expect(rendered[0]).not.toContain("cannot-fit");
	expect(visibleWidth(rendered[0] as string)).toBeLessThanOrEqual(20);
});

test("a chart body is the renderer's rows verbatim, with a heading and nothing else", () => {
	const rendered = renderBands([{ kind: "chart", title: "Daily", chart, source: "all time" }], ctx());
	expect(rendered).toHaveLength(3); // heading + the two chart rows
	expect(rendered[1]).toBe("███░░░");
	expect(rendered[2]).toBe("██████");
});

test("a table renders a header, its rows, and a count note when rows are dropped", () => {
	const rendered = renderBands([{ kind: "table", title: "Models", columns, rows, source: "x" }], ctx());
	// heading, header, two data rows.
	expect(rendered).toHaveLength(4);
	expect(rendered[1]).toContain("Model");
	expect(rendered[1]).toContain("Cost");
	expect(rendered[2]).toContain("gpt-5.6-terra");
	expect(rendered[3]).toContain("space-bunny-free");
});

test("a table that drops rows says so, rather than implying it showed everything", () => {
	const many = {
		kind: "inline" as const,
		rows: Array.from({ length: 25 }, (_, i) => ({ model: `m${i}`, cost: "$1.00", unpriced: "0" })),
	};
	const rendered = renderBands([{ kind: "table", title: "Models", columns, rows: many }], ctx({ tableLimit: 5 }));
	expect(rendered.some((r) => r.includes("5 of 25"))).toBe(true);
	expect(rendered).toHaveLength(8); // heading + header + 5 rows + count note
});

test("a table shows no count note when nothing was dropped", () => {
	const rendered = renderBands([{ kind: "table", title: "Models", columns, rows }], ctx());
	expect(rendered.some((r) => r.includes("of "))).toBe(false);
});

test("a custom band is the screen's own render, treated as one body", () => {
	const rendered = renderBands([{ kind: "custom", id: "x", render: () => ["line one", "line two"] }], ctx());
	expect(rendered.map(plain)).toEqual(["line one", "line two"]);
});

// ─── Robustness ─────────────────────────────────────────────────────────────

test("every band kind renders on an EMPTY payload without throwing", () => {
	for (const preset of PRESETS) {
		const empty: Band[] = [
			{ kind: "statRow", stats: [] },
			{ kind: "chart", title: "", chart: { type: "bars", axis: "", render: () => [] } },
			{ kind: "table", title: "", columns: [], rows: { kind: "inline", rows: [] } },
			{ kind: "legend", items: [] },
			{ kind: "note", text: "" },
			{ kind: "custom", id: "empty", render: () => [] },
		];
		expect(() => renderBands(empty, ctx({ preset, glyphs: glyphsFor(preset) }))).not.toThrow();
	}
});

test("every band kind renders a realistic fixture without throwing", () => {
	for (const preset of PRESETS) {
		expect(() => renderBands(ALL_KINDS, ctx({ preset, glyphs: glyphsFor(preset) }))).not.toThrow();
	}
});

test("no row exceeds the requested width, swept 40..200", () => {
	for (let width = 40; width <= 200; width++) {
		for (const preset of PRESETS) {
			const rendered = renderBands(ALL_KINDS, ctx({ width, innerWidth: width, preset, glyphs: glyphsFor(preset) }));
			for (const row of rendered) {
				expect(visibleWidth(row), `width ${width} ${preset}: ${row}`).toBeLessThanOrEqual(width);
			}
		}
	}
});

test("a zero or negative width does not throw", () => {
	expect(() => renderBands(ALL_KINDS, ctx({ width: 0, innerWidth: 0 }))).not.toThrow();
	expect(() => renderBands(ALL_KINDS, ctx({ width: -5, innerWidth: -5 }))).not.toThrow();
});

test("glyphs come from the glyph module: ascii differs and stays one cell wide", () => {
	const u = renderBands([{ kind: "legend", items: legendItems }], ctx({ preset: "unicode" }));
	const a = renderBands([{ kind: "legend", items: legendItems }], ctx({ preset: "ascii" }));
	expect(u.join("\n")).not.toBe(a.join("\n"));
	const fill = glyphsFor("ascii").barFill as string;
	expect(a.join("")).toContain(fill);
});
// ─── Colour: roles come from the palette, never from tokens chosen here ─────

test("colour: a primary tile is bold accent, secondary tiles are default text", () => {
	const [row] = renderBands([{ kind: "statRow", stats: tiles }], ctx({ innerWidth: 78 }));
	expect(tokensUsed(row as string)).toContain(PALETTE.primary);
	expect(tokensUsed(row as string)).toContain(PALETTE.label);
	// Weight is emphasis, not a colour, so `bold` wraps the accent token.
	expect(row).toContain(SET_BOLD);
});

test("colour: statRow labels are label-coloured and hints are dim", () => {
	const [row] = renderBands(
		[{ kind: "statRow", stats: [{ label: "Cost", value: "$935.72", hint: "0 unpriced" }] }],
		ctx({ innerWidth: 78 }),
	);
	expect(tokensUsed(row as string)).toContain(PALETTE.label);
	expect(tokensUsed(row as string)).toContain(PALETTE.dim);
});

test("colour: a note is entirely dim — it is prose, not data", () => {
	const [row] = renderBands([{ kind: "note", text: "This is not a zero." }], ctx());
	expect(tokensUsed(row as string)).toEqual([PALETTE.dim]);
});

test("colour: a table header is muted but its numbers are DEFAULT text", () => {
	const rendered = renderBands([{ kind: "table", title: "Models", columns, rows }], ctx());
	const header = rendered[1] as string;
	const firstRow = rendered[2] as string;
	// Header is scaffolding.
	expect(tokensUsed(header)).toContain(PALETTE.muted);
	// Data cells keep default text, deliberately NOT dimmed: a dimmed number
	// reads as less important, and a table of numbers is the entire point.
	expect(tokensUsed(firstRow)).not.toContain(PALETTE.dim);
	expect(tokensUsed(firstRow)).toContain(PALETTE.label);
});

test("colour: a chart heading title is the heading role and its meta is muted", () => {
	const [heading] = renderBands([{ kind: "chart", title: "Daily", chart, source: "all time" }], ctx());
	expect(tokensUsed(heading as string)).toContain(PALETTE.heading);
	expect(tokensUsed(heading as string)).toContain(PALETTE.meta);
});

test("colour: each legend swatch wears its own series colour", () => {
	const rendered = renderBands([{ kind: "legend", items: legendItems }], ctx());
	// Two items, two distinct series tokens.
	const first = tokensUsed(rendered[0] as string).filter((t) => SERIES_COLORS.includes(t as never));
	expect(first.length).toBeGreaterThan(0);
	expect(tokensUsed(rendered[0] as string)).not.toEqual(tokensUsed(rendered[1] as string));
	expect(tokensUsed(rendered[0] as string)).toContain(PALETTE.muted);
});

test("COLOUR LEAK: no literal colour escapes into the output", () => {
	// The hard rule: colour comes from the theme's `fg` with a NAMED token. A raw
	// hex or a hand-written escape would break every user theme and make the panel
	// stop looking like part of omp. Our fake `fg` is the ONLY source of escapes
	// here, so any escape that is not one of its codes would be a hardcoded one.
	const rendered = renderBands(ALL_KINDS, ctx());
	for (const row of rendered) {
		const escapes = [...row.matchAll(/\x1b\[([0-9;]+)m/g)].map((m) => m[1] as string);
		for (const code of escapes) {
			// Only the codes our fake theme emits: 38;5;N, 39, 1, 22.
			expect(code === "39" || code === "1" || code === "22" || /^38;5;[0-9]+$/.test(code), code).toBe(true);
		}
		// No hex literal in any band body.
		expect(row).not.toMatch(/#[0-9a-fA-F]{6}\b/);
	}
});

test("COLOUR LEAK: the source names palette roles, never theme tokens", () => {
	// A structural guard: `band.ts` may only name a token as a PALETTE lookup, so
	// a screen cannot hardcode its own token without the fake theme rejecting it
	// at runtime. This test proves the rejection actually happens.
	expect(() => ctx().fg("not-a-real-token" as never, "x")).toThrow();
});
