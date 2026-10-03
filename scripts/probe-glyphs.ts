/**
 * probe-glyphs — every glyph role, under every symbol preset, with its
 * codepoint and its measured cell width.
 *
 * WHY this is a script and not a test: the decision it exists to inform (the
 * heatmap's data ink — one glyph with colour, or a shade ramp) has to be made
 * by LOOKING at the ladders, not by reasoning about them. A test can prove a
 * ladder is one cell wide; only a rendered row can prove it is readable.
 *
 * It degrades gracefully: `src/tui/glyphs.ts` is Task 3's module. Until it
 * exists the script prints a notice and exits 0 rather than crashing, so a
 * checkout mid-plan still runs every other probe.
 *
 * Run: `bun run scripts/probe-glyphs.ts`
 */

import fs from "node:fs";
import path from "node:path";
import {
	KNOWN_TRAPS,
	codepoints,
	findWidthViolations,
	formatGlyphTable,
	type GlyphSample,
} from "./lib/glyph-width";
import {
	HEAT_VARIANTS,
	buildMatrix,
	renderGrid,
	stripAnsi,
	visibleWidth,
	type HeatCell,
} from "./lib/heatmap-ink";

const argv = process.argv.slice(2);
const wantsHeatmapOnly = argv.includes("--heatmap");
const wantsPlainText = argv.includes("--no-color");

/**
 * Colour is opt-in per run rather than probed from the environment.
 *
 * omp's symbol presets are user-selected and never auto-detected (F8), and a
 * terminal cannot be asked whether it honours SGR 38;2 without lying to itself
 * often enough to be useless. So: `--no-color` is an explicit human decision,
 * and piped output gets plain text automatically because escapes in a file are
 * just noise.
 */
const colour = !wantsPlainText && process.stdout.isTTY === true;

const PRESETS = ["unicode", "nerd", "ascii"] as const;
type Preset = (typeof PRESETS)[number];


const out = (line = "") => console.log(line);
const heading = (title: string) => {
	out();
	out(title);
	out("=".repeat(title.length));
};

function measure(glyph: string): number {
	return Bun.stringWidth(glyph);
}

/**
 * Flattens a glyph set into one sample per character, so a ramp appears as
 * `sparkRamp[3]` rather than as an unreadable joined string.
 */
function samplesFor(preset: Preset, glyphsFor: (p: Preset) => Record<string, unknown>): GlyphSample[] {
	const set = glyphsFor(preset);
	return Object.entries(set).flatMap(([role, value]) => {
		const marks = typeof value === "string" ? [value] : (value as readonly string[]);
		return marks.map((g, i) => ({
			preset,
			role: marks.length === 1 ? role : `${role}[${i}]`,
			glyph: g,
			// Every role in the glyph set IS data ink by construction: a ramp step,
			// a bar fill, a heat cell. Icons live in the other table and are not
			// width-constrained.
			dataInk: true,
		}));
	});
}

function printTrapSection(): void {
	heading("MEASURED TRAPS");
	out();
	const traps: [string, string, boolean][] = [
		['" │ " (sep.pipe, padded) — NEVER a column separator', KNOWN_TRAPS.sepPipe.padded, true],
		['"│" (boxRound.vertical, bare) — the safe separator', KNOWN_TRAPS.sepPipe.bare, false],
		["⚠️ (U+26A0 + VS16) — the emoji form is 2 cells", KNOWN_TRAPS.warningWithVariationSelector, true],
		["⚠ (U+26A0, bare) — theme.symbol('icon.warning') returns this", KNOWN_TRAPS.warningBare, false],
	];
	for (const [label, glyph, forbidden] of traps) {
		out(`${forbidden ? "FORBIDDEN" : "ok       "}  width ${String(measure(glyph)).padStart(2)}  ${label}`);
		out(`           codepoints ${codepoints(glyph)}`);
	}
	out();
	out("A separator is chrome, not data — but it still has to line up, so the padded");
	out("form triples the column gap on two presets and leaves the third correct.");
}

/**
 * Twenty-six weeks of deterministic activity, so every run shows the same grid
 * and a difference in what you see is a difference in the glyph, never in the
 * data.
 *
 * Shaped like a real usage history rather than random noise: a weekday rhythm,
 * a few genuinely quiet days, and one absent future date at the end so the
 * blank-vs-empty distinction is visible in the output rather than asserted.
 */
function syntheticWeeks(weeks: number): HeatCell[] {
	const cells: HeatCell[] = [];
	for (let week = 0; week < weeks; week++) {
		for (let day = 0; day < 7; day++) {
			const weekend = day >= 5;
			// A fixed multiplier keeps this deterministic; no RNG, so two runs
			// on two days produce byte-identical output.
			const seed = (week * 7 + day) * 2654435761;
			const roll = (seed >>> 8) % 100;
			const base = weekend ? 12 : 40;
			if (roll < 8) cells.push(0);
			else if (roll < base) cells.push(1);
			else if (roll < base + 24) cells.push(2);
			else if (roll < base + 38) cells.push(3);
			else cells.push(4);
		}
	}
	// The final three days have not happened yet. ABSENT must read as blank,
	// never as the empty cell — otherwise unspent money looks spent.
	cells[cells.length - 1] = null;
	cells[cells.length - 2] = null;
	return cells;
}

/** Print one variant's grid under its own heading, with its switch note. */
function printVariant(
	variant: (typeof HEAT_VARIANTS)[number],
	cells: readonly HeatCell[],
	weeks: number,
	labelWidth: number,
): void {
	out();
	out(variant.label);
	out("-".repeat(variant.label.length));
	out(`  glyphs.ts:  ${variant.switchNote}`);
	out();
	for (const row of renderGrid(buildMatrix(cells, weeks), {
		variant,
		labelWidth,
		colour,
		months: monthHeaders(weeks),
	})) {
		out(`  ${row}`);
	}
	out();
	const rows = renderGrid(buildMatrix(cells, weeks), { variant, labelWidth, months: monthHeaders(weeks) });
	const widths = new Set(rows.map(visibleWidth));
	out(
		`  ${rows.length} rows, all ${[...widths][0]} cells wide` +
			`${widths.size === 1 ? "" : ` — MISMATCHED: ${[...widths].join(", ")}`}`,
	);
}

/** Month labels every fourth column, blank elsewhere. */
function monthHeaders(weeks: number): (string | null)[] {
	const names = ["May", "Jun", "Jul", "Aug", "Sep", "Oct"];
	return Array.from({ length: weeks }, (_, week) =>
		week % 4 === 0 ? (names[Math.floor(week / 4) % names.length] ?? null) : null,
	);
}

/**
 * The decision this probe exists for: the same 26-week grid, rendered three
 * times, one screen. F19 argued from ink-coverage measurements that U+2588 beats
 * U+25A0 because a square leaves a gutter between neighbours — but a
 * measurement of coverage is not the same as seeing it, so all three are
 * rendered and a human picks.
 */
function printHeatmapComparison(): void {
	heading("HEATMAP CELL — A/B/C, SAME 26-WEEK GRID, THREE TIMES");
	out();
	out("Look at this in the terminal you actually use, at the font size you");
	out("actually read at. Specifically: can you see where one day ends and the");
	out("next begins? A gutter between cells turns a heatmap into scattered");
	out("dots, and that is the whole claim under test.");

	const weeks = 26;
	const labelWidth = 3;
	const cells = syntheticWeeks(weeks);

	for (const variant of HEAT_VARIANTS) {
		printVariant(variant, cells, weeks, labelWidth);
	}

	out();
	out("WHAT CHANGES TO SWITCH");
	out("=======================");
	out();
	out("All three write the same two roles in src/tui/glyphs.ts, so the choice");
	out("is a one-line table edit and nothing in heatmap.ts or any screen moves:");
	out("heatmap.ts already reads heatCell through glyph(preset, role, level).");
	out();
	for (const variant of HEAT_VARIANTS) {
		out(`  ${variant.id.padEnd(16)} ${variant.switchNote}`);
	}
	out();
	out(`  glyphs.ts is currently variant "${HEAT_VARIANTS[2]?.id}" (the shade ramp).`);
	out();
	out("THE TRADE, STATED PLAINLY");
	out("=========================");
	out();
	out("  A and B are the SAME encoding — one cell glyph, level carried by a");
	out("  truecolor foreground. They differ only in which cell that is. Under");
	out("  NO_COLOR, a monochrome terminal, or a colour a reader cannot");
	out("  distinguish, A and B both collapse to a flat grid: every day looks");
	out("  identical and the magnitude channel is gone entirely.");
	out();
	out("  C puts the level in the glyph as well, so it survives all three of");
	out("  those cases. It is the only one of the three that still reads when");
	out("  colour is unavailable — and omp never probes the terminal, so that");
	out("  case is always possible.");
	out();
	out(
		colour
			? "  (colour is ON for this run. Pass --no-color to see what A and B"
			: "  (colour is OFF for this run — piped, or --no-color. Run without a"
	);
	out(
		colour
			? "   collapse to: that is what A and B look like with no colour at all.)"
			: "   pipe, or without --no-color, to see the truecolor version.)"
	);
}

async function main(): Promise<number> {
	const glyphsModule = path.join(import.meta.dir, "..", "src", "tui", "glyphs.ts");

	// `--heatmap` is the whole point of this probe, so it must work without the
	// glyph module existing. Comparing cells by eye needs nothing but the
	// candidates, and it was exactly the run that had no glyphs.ts that used to
	// print nothing useful at all.
	if (wantsHeatmapOnly) {
		printHeatmapComparison();
		return 0;
	}
	if (!fs.existsSync(glyphsModule)) {
		heading("GLYPH MODULE NOT BUILT YET");
		out();
		out(`Expected ${path.relative(process.cwd(), glyphsModule)} — see Task 3 of`);
		out("docs/plans/2026-10-03-stats-tui-panel.md, which owns src/tui/glyphs.ts.");
		out("This probe was written first, against the measured widths, so that Task 3");
		out("inherits the constraints instead of rediscovering them.");
		out();
		out("Nothing else is blocked: the width assertions below are pinned by");
		out("test/probe-lib.test.ts and run with `bun test`.");
		return 0;
	}

	// Dynamic import is deliberate: `src/tui/glyphs.ts` is Task 3's module, and a
	// static import would crash this probe on a checkout where Task 3 has not
	// landed, instead of printing the notice above. This is a module-loading
	// boundary, not a runtime-selected dependency.
	const { glyphsFor } = (await import(glyphsModule)) as {
		glyphsFor: (preset: Preset) => Record<string, string | readonly string[]>;
	};

	heading("DATA INK — EVERY ROLE UNDER EVERY PRESET");
	out();
	const allSamples = PRESETS.flatMap((preset) => samplesFor(preset, glyphsFor));
	for (const line of formatGlyphTable(allSamples, measure)) out(line);

	printTrapSection();

	heading("WIDTH ASSERTIONS");
	const violations = findWidthViolations(allSamples, measure);
	if (violations.length === 0) {
		out();
		out(`PASS  ${allSamples.length} data-ink samples, every one exactly 1 cell wide.`);
		out("      No compensation is needed anywhere, and a preset regression would show");
		out("      up here rather than as a one-cell misalignment in a screenshot.");
	} else {
		out();
		for (const v of violations) {
			out(`FAIL  ${v.sample.preset}/${v.sample.role} ${codepoints(v.sample.glyph)} — ${v.reason}`);
		}
		out();
		out(`${violations.length} STOP-THE-LINE violation(s). Emoji and any width-2 codepoint are`);
		out("categorically forbidden in a repeated data cell.");
		return 1;
	}

	printHeatmapComparison();
	return 0;
}

process.exit(await main());