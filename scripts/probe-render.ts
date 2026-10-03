/**
 * Render any screen to stdout at any width, without launching a terminal.
 *
 * This is how a screen gets reviewed. The panel only exists inside an overlay on
 * someone else's terminal, which makes "does this look right" an expensive
 * question to answer; this script makes it a command. It builds a real
 * `ScreenContext` — real `planLayout`, real `glyphsFor`, real `theme` — fetches
 * the screen's declared needs through the same `fetchFor` the panel uses, and
 * prints the rows.
 *
 * Usage:
 *   bun scripts/probe-render.ts [screenId] [--width N] [--width N] [--range 24h]
 *
 * Defaults to the overview at width 100 and width 60, which is the pair the plan
 * asks for: 100 is the common terminal, 60 is where the layout has to start
 * dropping things.
 */

import { initDb } from "@oh-my-pi/omp-stats/db";

import { fetchFor, type PanelData } from "../src/data/api";
import { RANGES, DEFAULT_RANGE, isRange, type Range } from "../src/data/ranges";
import { SCREENS, screenById, type ScreenContext, type ScreenId } from "../src/tui/screens/types";
import { planLayout } from "../src/tui/layout";
import { glyphsFor } from "../src/tui/glyphs";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import type { SymbolPreset } from "@oh-my-pi/pi-tui";

ensureThemeSync();

const args = process.argv.slice(2);
const widths: number[] = [];
let screenId = "overview";
let range: Range = DEFAULT_RANGE;
let preset: SymbolPreset = "unicode";

for (let i = 0; i < args.length; i++) {
	const arg = args[i];
	if (arg === "--width" || arg === "-w") {
		widths.push(Number(args[++i]));
	} else if (arg === "--range" || arg === "-r") {
		const next = args[i + 1] ?? "";
		if (!isRange(next)) {
			console.error(`unknown range "${next}"; expected one of ${RANGES.join(", ")}`);
			process.exit(1);
		}
		range = next;
		i++;
	} else if (arg === "--preset" || arg === "-p") {
		const next = args[i + 1] ?? "";
		if (next !== "unicode" && next !== "nerd" && next !== "ascii") {
			console.error(`unknown preset "${next}"; expected unicode, nerd or ascii`);
			process.exit(1);
		}
		preset = next;
		i++;
	} else if (!arg.startsWith("-")) {
		screenId = arg;
	} else {
		console.error(`unknown flag ${arg}`);
		process.exit(1);
	}
}

if (widths.length === 0) widths.push(100, 60);

const known = SCREENS.map(s => s.id);
if (!known.includes(screenId as ScreenId)) {
	console.error(`unknown screen "${screenId}"; expected one of ${known.join(", ")}`);
	process.exit(1);
}

const screen = screenById(screenId as ScreenId);
const ROWS = 40;

// The extension inits the database at LOAD (src/index.ts, F16), before any
// screen is selectable. A standalone script has to do that itself: `rollupStatus`
// reads `currentDb()` directly rather than through a route, so without a warm it
// throws "database is not initialised" while the route-backed fetches would have
// succeeded — the throw is correct behaviour, and standing in for the load-time
// warm here is what makes this probe match what the panel actually sees.
await initDb();

// The same seam the panel uses: fetch exactly what the screen declared.
const started = performance.now();
const data: PanelData = await fetchFor(screen.needs, range);
const elapsed = Math.round(performance.now() - started);

for (const width of widths) {
	const ctx: ScreenContext = {
		width,
		rows: ROWS,
		range,
		theme,
		preset,
		glyphs: glyphsFor(preset),
		plan: planLayout(width, ROWS, preset),
		data,
		// Index-stable colours, so two runs of the same screen are diffable. The
		// panel substitutes its live palette here.
		colorFor: () => (text: string) => text,
	};

	const rendered = screen.render(ctx);
	const over = rendered.filter(r => Bun.stringWidth(r) > ctx.plan.innerWidth);

	console.log(`\n${"═".repeat(width)}`);
	console.log(`${screen.id}  width=${width}  range=${range}  preset=${preset}  inner=${ctx.plan.innerWidth}`);
	console.log(`${"─".repeat(width)}`);
	console.log(rendered.join("\n"));
	console.log(`${"─".repeat(width)}`);
	console.log(`${rendered.length} rows${over.length === 0 ? "" : `, ${over.length} OVER WIDE`}`);
}

console.log(`\nfetched ${screen.needs.length} route(s) in ${elapsed}ms for ${screen.id}`);