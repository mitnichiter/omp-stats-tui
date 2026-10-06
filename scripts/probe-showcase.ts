/**
 * `scripts/probe-showcase.ts` — capture the SHOWCASE frame, ANSI stripped.
 *
 * Run: `bun scripts/probe-showcase.ts [widths…] [--section id] [--preset P]`
 *
 * WHY IT EXISTS, given `scripts/probe-frame.ts` already captures the panel.
 * The showcase is the artefact a DESIGNER reads, so its capture has to answer
 * design questions the panel's cannot:
 *
 *   - OVERWIDE must be 0 at every width, exactly as for the panel — a row that
 *     overflows is torn by `OverlayPanel.row`, not squeezed, so the control on the
 *     trailing edge is what disappears.
 *   - EVERY SECTION is captured, because each one demonstrates a different part of
 *     the grammar and a reviewer should never have to re-run to see the next.
 *   - G5 is reported per section: no body may contain a run of rule characters.
 *   - SCROLL-STABLE is checked for the nav column, because the sidebar is a FRAME
 *     region and scrolling the body must not move it.
 *
 * Every number printed is measured, never asserted into the prose.
 */

import { __testing, SHOWCASE_SECTIONS } from "../src/tui/showcase/panel";
import { SHOWCASE_NOW } from "../src/tui/showcase/spec";
import { visibleWidth } from "@oh-my-pi/pi-tui";

const ANSI = /\x1b\[[0-9;]*m/g;
const RULE_RUN = /[─━═]{3,}/;
const ROWS = 40;

const args = process.argv.slice(2);
const widths: number[] = [];
let only: string | null = null;
let preset: "unicode" | "nerd" | "ascii" = "unicode";

for (let i = 0; i < args.length; i++) {
	const arg = args[i];
	if (arg === "--section") only = args[++i] ?? null;
	else if (arg === "--preset") preset = (args[++i] ?? "unicode") as typeof preset;
	else if (arg !== undefined && /^\d+$/.test(arg)) widths.push(Number(arg));
}
if (widths.length === 0) widths.push(100, 60);

const sections = only ? SHOWCASE_SECTIONS.filter(section => section.id === only) : SHOWCASE_SECTIONS;
if (sections.length === 0) {
	console.error(`no showcase section "${only}". Known: ${SHOWCASE_SECTIONS.map(s => s.id).join(", ")}`);
	process.exit(1);
}

const summary: string[] = [];
const blocks: string[] = [];

/**
 * The nav column's cells for the nav rows of the last frame.
 *
 * RENDER FIRST: `debugFrame` reports the geometry recorded by the LAST render, so
 * reading it before rendering describes the PREVIOUS frame — which is how a naive
 * version of this probe reported the nav as hidden at every width, including 150.
 * `probe-frame.ts` carries the same warning for the same reason.
 */
const navColumn = (panel: ReturnType<typeof __testing.makePanel>, width: number): string[] | null => {
	panel.render(width);
	const frame = __testing.debugFrame(panel);
	if (!frame || frame.sidebarWidth === 0) return null;
	const start = frame.topbarRows + frame.stripRows;
	return panel
		.render(width)
		.slice(start, start + frame.sidebarRows)
		.map(row => row.replace(ANSI, "").slice(0, frame.sidebarWidth + 3));
};

for (const width of widths) {
	for (const section of sections) {
		const panel = __testing.makePanel({
			now: () => SHOWCASE_NOW,
			sectionId: section.id,
			rows: ROWS,
		});
		const atRest = navColumn(panel, width);
		const frame = panel.render(width);
		const plain = frame.map(line => line.replace(ANSI, ""));
		const over = plain.filter(row => visibleWidth(row) > width).length;
		const widest = Math.max(...plain.map(row => visibleWidth(row)));
		const dividers = plain.filter(row => row.includes("├")).length;
		// G5 COUNTS BODY RULES ONLY. `OverlayPanel` draws its own top and bottom
		// border and the `PanelDivider` is G6's one allowed rule, so all three are
		// excluded: what remains is a rule inside a band, which is the bug.
		const rules = plain.filter(row => RULE_RUN.test(row) && !row.includes("├") && !/^[╭╰]/.test(row)).length;
		const maxScroll = __testing.debugMaxScroll(panel);

		// Drive the real wheel path to the bottom, then confirm the nav did not move.
		while (__testing.debugScroll(panel) < maxScroll) panel.handleInput("\x1b[<65;50;10M");
		const scrolled = panel.render(width).map(line => line.replace(ANSI, ""));
		const after = navColumn(panel, width);
		const stable = atRest === null || after === null || atRest.join("\n") === after.join("\n");

		summary.push(
			`  ${section.id.padEnd(8)} @${String(width).padStart(3)} — ${plain.length} rows, widest ${widest}, ` +
				`dividers ${dividers}, OVERWIDE ${over}, G5 violations ${rules}, scroll 0..${maxScroll}, ` +
				`nav ${atRest === null ? "hidden" : "SCROLL-STABLE " + stable}`,
		);
		blocks.push(
			`--- ${section.id} @${width} preset=${preset}: rows=${plain.length} widest=${widest} ` +
				`dividers=${dividers} OVERWIDE=${over} G5=${rules} scroll 0..${maxScroll} nav=${atRest === null ? "hidden" : `stable=${stable}`}\n` +
				plain.join("\n"),
		);
		blocks.push(
			`--- ${section.id} @${width} @scroll${maxScroll} (the same frame scrolled to its end)\n${scrolled.join("\n")}`,
		);
	}
}

console.log(summary.join("\n"));
console.log(`\n${blocks.join("\n\n")}`);