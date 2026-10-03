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

const PRESETS = ["unicode", "nerd", "ascii"] as const;
type Preset = (typeof PRESETS)[number];

/**
 * The candidate heat ladders, kept HERE as data because the plan deliberately
 * does not decide between them. Swapping the chosen ladder in `glyphs.ts` must
 * be a one-line table edit, and this script must show that edit side by side
 * with the alternative.
 */
const HEAT_CANDIDATES = [
	{ name: "single ■ + colour (ADR 0005 / F10)", ladder: ["■", "■", "■", "■"] },
	{ name: "shade ramp (ratatui symbols::shade)", ladder: ["░", "▒", "▓", "█"] },
	{ name: "ascii ladder", ladder: ["·", ":", "o", "#"] },
	{ name: "ascii ladder (solid alternative)", ladder: [" ", ".", "*", "#"] },
] as const;

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
 * Renders each candidate ladder as an actual heatmap row so the choice can be
 * judged by looking at it under a real terminal, which is the only way to see
 * whether an empty step reads as "no activity" or as "a hole".
 */
function printHeatmapSamples(): void {
	heading("HEATMAP INK — CANDIDATE LADDERS (decision deliberately open)");
	out();
	const levels = HEAT_CANDIDATES[0].ladder.length;
	const sampleDays = [
		0, 0, 1, 3, 0, 2, 3,
		1, 0, 0, 2, 0, 3, 1,
		0, 2, 1, 0, 3, 0, 2,
		3, 1, 0, 0, 2, 3, 0,
		1, 1, 3, 0, 0, 2, 0,
	];
	for (const candidate of HEAT_CANDIDATES) {
		const row = sampleDays.map((level) => candidate.ladder[level % levels]).join("");
		out(`${candidate.name}`);
		out(`  ${row}`);
		out(`  width ${measure(row)} cells for ${sampleDays.length} days, ${levels} levels`);
		out();
	}
	out("Look at these in the terminal you actually use. The ramp survives NO_COLOR and a");
	out("monochrome font; the single-glyph-plus-colour option does not, and it loses the");
	out("magnitude channel entirely when colour is unavailable or when a level is missing");
	out("because its rollup hour was never built.");
}

async function main(): Promise<number> {
	const glyphsModule = path.join(import.meta.dir, "..", "src", "tui", "glyphs.ts");

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

	printHeatmapSamples();
	return 0;
}

process.exit(await main());