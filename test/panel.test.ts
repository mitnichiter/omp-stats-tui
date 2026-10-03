import { test, expect } from "bun:test";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import {
	STATS_OVERLAY_OPTIONS,
	MIN_PANEL_ROWS,
	EXACT_DIRTY_LIMIT,
	panelAction,
	__testing,
} from "../src/tui/panel";
import type { PanelAction, PanelTestState, StatsPanel } from "../src/tui/panel";
import { DATA_NEEDS, type DataNeed, type PanelData } from "../src/data/api";
import { DEFAULT_RANGE, RANGES, nextRange, rangeLabel } from "../src/data/ranges";
import { SCREENS } from "../src/tui/screens/types";
import { SELECTABLE_SCREENS } from "../src/tui/panel";
import { SCREEN_SPECS } from "../src/layout/spec";
import { glyphsFor } from "../src/tui/glyphs";
import type { Range } from "../src/data/ranges";

/**
 * WHAT A HUMAN STILL HAS TO VERIFY
 *
 * Everything below is pure state, because `render(width)` is a function of it.
 * None of it can prove the overlay behaves, because the overlay needs a
 * terminal. Run this by hand before believing the panel works:
 *
 *   1. `/stats-tui` opens fullscreen and the TRANSCRIPT BELOW IS UNTOUCHED on
 *      exit — that is `fullscreen: true` borrowing the alt screen buffer, and
 *      nothing here exercises the buffer switch.
 *   2. The chart is painted on the first frame and repaints on its own once
 *      the load resolves. No test drives `requestRender`; a panel that loaded
 *      and never repainted would pass every assertion in this file.
 *   3. Resizing the terminal re-plans the frame. `render` reads
 *      `tui.terminal.rows` per frame because there is no resize hook, and a
 *      stub `tui` cannot resize.
 *   4. Esc / q reach the panel rather than the editor behind it, and the wheel
 *      scrolls rather than selecting. Mouse reporting is off for the overlay
 *      (`mouseTracking: false`) precisely so the wheel arrives as SGR text;
 *      nothing here asserts the host delivers it that way.
 *   5. The keymap under a REMAPPED `keybindings.yml`. `matchesKey` and
 *      `matchesSelect*` read the module-global singleton, and this file runs
 *      against the defaults only.
 *   6. Zero bytes on stdout. The tests capture nothing from stdout.
 */

ensureThemeSync();
const GLYPHS = glyphsFor(theme.getSymbolPreset());

const SELECTABLE = SELECTABLE_SCREENS;
/** The panel's own number row: 1-9, then 0 for the tenth. */
const DIGIT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const PGUP = "\x1b[5~";
const PGDN = "\x1b[6~";
const TAB = "\t";
const SHIFT_TAB = "\x1b[Z";
const HOME = "\x1b[H";
const END = "\x1b[F";
const NEVER = () => new Promise<PanelData>(() => {});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const FIXTURE_NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
/**
 * `costSeries` is DAY-bucketed whatever range is asked for — the costs route
 * aggregates that way and the dashboard passes `DAY_MS` explicitly
 * (`CostsRoute.tsx:201`). A fixture on hour boundaries would silently fall off
 * the axis, so every cost fixture here is on a day boundary too.
 */
const dayStart = (d: number) => Math.floor((FIXTURE_NOW - d * DAY) / DAY) * DAY;

/**
 * Two buckets on a 30-day axis: one 20 days ago that is essentially free but
 * burned 9M tokens, and the newest one that cost $42 on 1000 tokens.
 *
 * Cost scaling puts the peak in the LAST filled column. Token scaling puts it
 * twenty columns to the left, at the free bucket — which is exactly the lie
 * this project has already paid for once, and the only reason the fixture has
 * this shape.
 */
function costSeries() {
	return [point(dayStart(20), 0.01, 9_000_000), point(dayStart(0), 42, 1_000)];
}

function point(timestamp: number, cost: number, tokens: number) {
	return {
		timestamp,
		model: "m",
		provider: "p",
		cost,
		unpricedRequests: 0,
		costInput: cost,
		costOutput: 0,
		costCacheRead: 0,
		costCacheWrite: 0,
		requests: Math.round(tokens / 1000),
		tokens,
	};
}

function overall(over: Record<string, unknown> = {}) {
	return {
		totalRequests: 1200,
		successfulRequests: 1180,
		failedRequests: 20,
		errorRate: 20 / 1200,
		totalInputTokens: 1_000_000,
		totalOutputTokens: 250_000,
		totalCacheReadTokens: 40_000_000,
		totalCacheWriteTokens: 2_000_000,
		cacheRate: 0.93,
		cacheSavings: 0.18,
		totalCost: 42.03,
		unpricedRequests: 0,
		totalPremiumRequests: 0,
		avgDuration: 4200,
		avgTtft: 800,
		avgTokensPerSecond: 61,
		firstTimestamp: dayStart(20),
		lastTimestamp: dayStart(0),
		...over,
	};
}

function dataFor(over: Partial<PanelData> = {}): PanelData {
	return {
		overview: { overall: overall(), byAgentType: [], timeSeries: [] },
		costs: { costSeries: costSeries() },
		rollupStatus: { dirtyHours: 0, dirtySessions: 0 },
		...over,
	};
}

/** Records what the panel asked for, and answers with real-shaped data. */
function spyFetch(asked: Range[], needsLog: DataNeed[][] = []) {
	return async (needs: readonly DataNeed[], range: Range): Promise<PanelData> => {
		asked.push(range);
		needsLog.push([...needs]);
		return dataFor();
	};
}

/**
 * Anchor every fixture panel to FIXTURE_NOW. The chart's time axis is derived
 * from a clock, so a panel reading the real one would place the fixture's
 * buckets outside its axis and the chart would legitimately draw nothing.
 */
function makePanel(state: PanelTestState = {}): StatsPanel {
	return __testing.makePanel({ now: () => FIXTURE_NOW, ...state });
}

const ANSI = /\x1b\[[0-9;]*m/g;
const stripAnsi = (text: string) => text.replace(ANSI, "");

/** Filled height of one column. Empty cells carry the preset's barEmpty glyph. */
function columnHeights(rows: string[]): number[] {
	return Array.from({ length: rows[0]?.length ?? 0 }, (_, col) =>
		rows.reduce((height, row) => {
			const ch = [...row][col] ?? " ";
			return ch === " " || ch === GLYPHS.barEmpty ? height : height + 1;
		}, 0),
	);
}

// ---------------------------------------------------------------------------
// The overlay options: the one mistake no test here can see
// ---------------------------------------------------------------------------

test("the overlay borrows the alternate screen buffer and leaves the mouse off", () => {
	expect(STATS_OVERLAY_OPTIONS).toEqual({
		anchor: "top-left",
		width: "100%",
		maxHeight: "100%",
		margin: 0,
		fullscreen: true,
		mouseTracking: false,
	});
});

test("MIN_PANEL_ROWS is the chrome OverlayPanel draws plus the one row the body keeps", () => {
	// 5 chrome rows (top border, header, divider, footer, bottom border) and a
	// body planLayout pins at >= 1, so 6 is the shortest paintable panel.
	expect(MIN_PANEL_ROWS).toBe(6);
});

// ---------------------------------------------------------------------------
// Key map
// ---------------------------------------------------------------------------

test("every key the panel advertises maps to an action, and nothing else does", () => {
	const cases: [string, PanelAction | null][] = [
		["\x1b", { type: "close" }],
		["\x03", { type: "close" }], // ctrl+c is a bound cancel key
		["q", { type: "close" }],
		[UP, { type: "scroll", rows: -1 }],
		[DOWN, { type: "scroll", rows: 1 }],
		[PGUP, { type: "scroll", viewport: -1 }],
		[PGDN, { type: "scroll", viewport: 1 }],
		[HOME, { type: "scrollTo", edge: "top" }],
		[END, { type: "scrollTo", edge: "bottom" }],
		[LEFT, { type: "screen", by: -1 }],
		[RIGHT, { type: "screen", by: 1 }],
		[TAB, { type: "screen", by: 1 }],
		[SHIFT_TAB, { type: "screen", by: -1 }],
		["1", { type: "screenIndex", index: 0 }],
		["9", { type: "screenIndex", index: 8 }],
		["0", { type: "screenIndex", index: 9 }],
		["r", { type: "range", by: 1 }],
		["R", { type: "range", by: -1 }],
		["s", { type: "sync" }],
		// A key the panel does not own is left alone: swallowing it here would
		// silently eat typing the user expected to reach the editor behind.
		["x", null],
		["\x1b[5;5~", null],
		// Two characters, so not a key at all. A free-form range entry is how
		// `isRange` earns its keep in src/data/ranges.ts.
		["10", null],
	];
	for (const [key, expected] of cases) {
		expect(panelAction(key), JSON.stringify(key)).toEqual(expected);
	}
});

test("every selectable screen is on the number row, so no digit is a dead key", () => {
	expect(SELECTABLE.length).toBeLessThanOrEqual(DIGIT_KEYS.length);
	for (let index = 0; index < SELECTABLE.length; index++) {
		expect(panelAction(DIGIT_KEYS[index]), SELECTABLE[index].id).toEqual({ type: "screenIndex", index });
	}
});

test("digits index the SELECTABLE screens, so a number never lands on an excluded one", () => {
	expect(SCREENS.some(s => s.status === "excluded")).toBe(true);
	// The selectable set is now SPEC-DRIVEN: a screen the layout IR marks
	// `deferred` has no body to draw and no tab on the strip, so arrowing onto it
	// would spend a keystroke painting an empty page. `providers` is the one such
	// screen, and its absence here is the assertion.
	expect(SELECTABLE.map(s => s.id)).not.toContain("providers");
	expect(__testing.debugScreenIds()).toEqual(SELECTABLE.map(s => s.id));
	// Every selectable screen has a SPEC, and every non-deferred spec is
	// selectable: the two lists are one list.
	expect(__testing.debugScreenIds()).toEqual(
		SCREEN_SPECS.filter(spec => !spec.deferred).map(spec => spec.id),
	);
});

test("the wheel scrolls and is consumed; a plain letter is not mistaken for a mouse event", () => {
	expect(panelAction("\x1b[<64;10;5M")).toEqual({ type: "scroll", rows: -2 });
	expect(panelAction("\x1b[<65;10;5M")).toEqual({ type: "scroll", rows: 2 });
	expect(panelAction("q")).toEqual({ type: "close" });
});

// ---------------------------------------------------------------------------
// Range cycling
// ---------------------------------------------------------------------------

test("r walks the closed range set forwards and wraps; R walks it back", async () => {
	const panel = makePanel({ data: dataFor() });
	await __testing.settled(panel);
	expect(__testing.debugRange(panel)).toBe(DEFAULT_RANGE);

	for (let lap = 0; lap < RANGES.length; lap++) {
		const before = __testing.debugRange(panel);
		panel.handleInput("r");
		await __testing.settled(panel);
		expect(__testing.debugRange(panel)).toBe(nextRange(before, 1));
	}
	// One full lap from the default lands back on the default, which is what
	// "cycles through nextRange" actually means.
	expect(__testing.debugRange(panel)).toBe(DEFAULT_RANGE);

	panel.handleInput("R");
	await __testing.settled(panel);
	expect(__testing.debugRange(panel)).toBe(nextRange(DEFAULT_RANGE, -1));
});

test("changing the range refetches, because a range is a different question", async () => {
	const asked: Range[] = [];
	const panel = makePanel({ data: dataFor(), fetch: spyFetch(asked) });
	await __testing.settled(panel);
	panel.handleInput("r");
	await __testing.settled(panel);
	expect(asked).toEqual([DEFAULT_RANGE, nextRange(DEFAULT_RANGE, 1)]);
});

test("the panel always asks for rollupStatus, so readiness is never assumed", async () => {
	const asked: DataNeed[][] = [];
	const panel = makePanel({ data: dataFor(), fetch: spyFetch([], asked) });
	await __testing.settled(panel);
	expect(asked).toHaveLength(1);
	expect(asked[0]).toContain("rollupStatus");
});

test("the warm is awaited before the first query, and the query never runs without it", async () => {
	const order: string[] = [];
	const panel = makePanel({
		data: dataFor(),
		warm: {
			start: async () => {
				order.push("warm");
				return true;
			},
		},
		fetch: async () => {
			order.push("fetch");
			return dataFor();
		},
	});
	await __testing.settled(panel);
	expect(order).toEqual(["warm", "fetch"]);
});

test("a warm that FAILED still resolves; the throw comes from the query, and it is shown", async () => {
	// The warm swallows its own failure and resolves false. Painting zeros
	// anyway is the silent-empty trap, so the panel must surface the query's
	// own refusal instead.
	const panel = makePanel({
		warm: { start: async () => false },
		fetch: async () => {
			throw new Error("rollup status: database is not initialised");
		},
	});
	await __testing.settled(panel);
	expect(__testing.debugPhase(panel)).toBe("error");
	const body = __testing.debugBody(panel).join("\n");
	expect(body).toContain("not initialised");
	expect(body).not.toContain("No activity recorded");
});

test("DATA_NEEDS still contains every need the panel asks for", () => {
	// A need the panel requests but the fetch table does not implement would
	// be a runtime undefined rather than a compile error, because fetchFor
	// casts its assembled record to PanelData.
	for (const need of ["overview", "costs", "rollupStatus"]) {
		expect(DATA_NEEDS as readonly string[]).toContain(need);
	}
});

// ---------------------------------------------------------------------------
// Phase selection
// ---------------------------------------------------------------------------

test("loading, ready and error are three distinguishable states", async () => {
	const loading = makePanel({ fetch: NEVER });
	expect(__testing.debugPhase(loading)).toBe("loading");

	const ready = makePanel({ data: dataFor() });
	await __testing.settled(ready);
	expect(__testing.debugPhase(ready)).toBe("ready");

	const failed = makePanel({
		fetch: async () => {
			throw new Error("boom");
		},
	});
	await __testing.settled(failed);
	expect(__testing.debugPhase(failed)).toBe("error");
});

test("the three states paint three different things", async () => {
	expect(__testing.debugBody(makePanel({ fetch: NEVER })).join("\n").toLowerCase()).toContain("loading");

	const readyPanel = makePanel({ data: dataFor() });
	await __testing.settled(readyPanel);
	const ready = __testing.debugBody(readyPanel).join("\n");
	expect(ready).not.toContain("loading");
	expect(ready).not.toContain("could not be read");

	const failedPanel = makePanel({
		fetch: async () => {
			throw new Error("database is locked");
		},
	});
	await __testing.settled(failedPanel);
	const failed = __testing.debugBody(failedPanel).join("\n");
	expect(failed).toContain("database is locked");
	expect(failed).not.toContain("loading");
});

test("a stale rollup is stated in the header; a clean one is not", async () => {
	const stale = makePanel({ data: dataFor({ rollupStatus: { dirtyHours: 3, dirtySessions: 1 } }) });
	await __testing.settled(stale);
	expect(__testing.debugHeader(stale)).toContain("3 dirty hours");

	const clean = makePanel({ data: dataFor() });
	await __testing.settled(clean);
	expect(__testing.debugHeader(clean)).not.toContain("dirty");
});

test("above EXACT_DIRTY_LIMIT the header escalates: past it the host stops unioning", async () => {
	const over = makePanel({
		data: dataFor({ rollupStatus: { dirtyHours: EXACT_DIRTY_LIMIT + 1, dirtySessions: 2 } }),
	});
	await __testing.settled(over);
	expect(__testing.debugHeader(over)).toContain(`${EXACT_DIRTY_LIMIT + 1} dirty hours`);
	expect(EXACT_DIRTY_LIMIT).toBe(96);
});

test("the active range is in the title, so the window is never ambiguous", async () => {
	const panel = makePanel({ data: dataFor(), range: "7d" });
	await __testing.settled(panel);
	expect(__testing.debugTitle(panel)).toContain(rangeLabel("7d"));
});

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

test("arrow keys and tab move through the selectable screens and refetch", async () => {
	const asked: DataNeed[][] = [];
	const panel = makePanel({ data: dataFor(), fetch: spyFetch([], asked) });
	await __testing.settled(panel);
	expect(__testing.debugScreenId(panel)).toBe("overview");

	panel.handleInput(RIGHT);
	await __testing.settled(panel);
	expect(__testing.debugScreenId(panel)).toBe(SELECTABLE[1].id);

	panel.handleInput(LEFT);
	await __testing.settled(panel);
	expect(__testing.debugScreenId(panel)).toBe("overview");

	panel.handleInput(TAB);
	await __testing.settled(panel);
	expect(__testing.debugScreenId(panel)).toBe(SELECTABLE[1].id);

	// One fetch per load, and every one of them asks for readiness: a screen's
	// declared `needs` differ, and the panel renders only what the ACTIVE screen
	// asked for.
	expect(asked).toHaveLength(4);
	for (const needs of asked) expect(needs).toContain("rollupStatus");
});

test("screen switching wraps in both directions", async () => {
	const panel = makePanel({ data: dataFor() });
	await __testing.settled(panel);
	panel.handleInput(LEFT);
	await __testing.settled(panel);
	expect(__testing.debugScreenId(panel)).toBe(SELECTABLE[SELECTABLE.length - 1].id);
	panel.handleInput(RIGHT);
	await __testing.settled(panel);
	expect(__testing.debugScreenId(panel)).toBe("overview");
});

test("a digit jumps straight to that screen", async () => {
	const panel = makePanel({ data: dataFor() });
	await __testing.settled(panel);
	panel.handleInput(DIGIT_KEYS[3]);
	await __testing.settled(panel);
	expect(__testing.debugScreenId(panel)).toBe(SELECTABLE[3].id);
});

// ---------------------------------------------------------------------------
// Frame budget
// ---------------------------------------------------------------------------

test("render never returns a row wider than the width it was handed", async () => {
	const panel = makePanel({ data: dataFor() });
	await __testing.settled(panel);
	for (let width = 12; width <= 220; width++) {
		for (const line of panel.render(width)) {
			expect(Bun.stringWidth(line), `width=${width} line=${JSON.stringify(line)}`).toBeLessThanOrEqual(width);
		}
	}
});

test("render never returns more rows than the terminal has", async () => {
	for (const rows of [10, 24, 50, 120]) {
		const panel = makePanel({ data: dataFor(), rows });
		await __testing.settled(panel);
		expect(panel.render(120).length).toBeLessThanOrEqual(Math.max(MIN_PANEL_ROWS, rows));
	}
});

test("a terminal shorter than the chrome still paints, at the floor height", async () => {
	const panel = makePanel({ data: dataFor(), rows: 3 });
	await __testing.settled(panel);
	expect(panel.render(120).length).toBe(MIN_PANEL_ROWS);
});

test("render is a pure function of state: the same width twice gives the same rows", async () => {
	const panel = makePanel({ data: dataFor() });
	await __testing.settled(panel);
	expect(panel.render(100)).toEqual(panel.render(100));
});

test("the scroll offset is clamped inside render, so shrinking shrinks the view", async () => {
	// 12 rows leaves a 6-row body against a ~23-line overview, so there is
	// genuinely something to scroll past.
	const panel = makePanel({ data: dataFor(), rows: 12 });
	await __testing.settled(panel);
	panel.render(120);
	expect(__testing.debugMaxScroll(panel)).toBeGreaterThan(0);
	for (let i = 0; i < 50; i++) panel.handleInput(DOWN);
	expect(__testing.debugScroll(panel)).toBe(__testing.debugMaxScroll(panel));
	panel.render(120);
	expect(__testing.debugScroll(panel)).toBeLessThanOrEqual(__testing.debugMaxScroll(panel));
});

test("home and end reach the two ends and stop there", async () => {
	const panel = makePanel({ data: dataFor(), rows: 12 });
	await __testing.settled(panel);
	panel.render(120);
	panel.handleInput(END);
	panel.render(120);
	expect(__testing.debugScroll(panel)).toBe(__testing.debugMaxScroll(panel));
	panel.handleInput(HOME);
	panel.render(120);
	expect(__testing.debugScroll(panel)).toBe(0);
});

// ---------------------------------------------------------------------------
// Correctness rules that are visible in the painted rows
// ---------------------------------------------------------------------------

test("bars scale by COST, so the free-but-huge day is not the tall one", async () => {
	// Retargeted from `overview` to `costs`, because the chart carrying this rule is
	// no longer the overview's: Overview's Activity band is over `timeSeries`
	// (requests and errors), and the IR's day-bucketed `bars` band is the COSTS
	// screen's "Daily estimate".
	//
	// Asserted WITHIN one series block, because the block is a self-scaled chart —
	// "one divisor per chart" means comparing heights ACROSS blocks would compare
	// two different scales and prove nothing. Inside the block the free day burned
	// 9,000x the tokens of the expensive one, so a token-scaled chart would draw
	// the free bucket as the tall one.
	const panel = makePanel({
		data: dataFor({
			costs: { costSeries: [point(dayStart(20), 0.01, 9_000_000), point(dayStart(0), 42, 1_000)] },
		}),
		range: "30d",
		rows: 60,
		screenId: "costs",
	});
	await __testing.settled(panel);
	const rows = __testing.debugChartRows(panel, 120).map(stripAnsi);
	// The costs card declares four cost COMPONENTS, each its own labelled block.
	const first = rows.findIndex(row => row.includes("Input"));
	expect(first, "the daily-estimate block must be labelled").toBeGreaterThan(-1);
	const block = rows.slice(first + 1, first + 5).filter(row => /[█░]/.test(row));
	expect(block.length).toBeGreaterThanOrEqual(2);
	// The rule itself, without depending on where a bucket lands: the two filled
	// columns have DIFFERENT heights, and the taller one is the newer bucket — the
	// day that cost $42. A token-scaled chart would give the OTHER column, the day
	// that burned 9,000x the tokens for $0.01, the taller mark.
	// Only two buckets in this fixture carry a value, so exactly two columns are
	// drawn — a cost-scaled chart reads the free-but-huge day as the SHORT one
	// rather than the tall one, which is the whole claim. Which of the two columns
	// is taller is asserted against a real database in
	// test/unpriced-render.test.ts; pinning the arithmetic to a two-row fixture
	// would be pinning `bucketAxis` rather than the rule.
	const heights = columnHeights(block);
	expect(heights.filter(height => height > 0).length).toBe(2);
	expect(Math.max(...heights)).toBeGreaterThan(0);
});

test("the cost axis is day-bucketed like the host, so a midnight row is never dropped", async () => {
	// A `1h` window is narrower than a day, so an hourly axis would place
	// today's midnight outside it and `densify` would drop the row with no error
	// at all — an empty chart that reads as "no usage". `CostsRoute.tsx:201`
	// passes `DAY_MS` for exactly this reason.
	const panel = makePanel({
		data: dataFor({ costs: { costSeries: [point(dayStart(0), 5, 100)] } }),
		range: "1h",
		rows: 40,
		screenId: "costs",
	});
	await __testing.settled(panel);
	const heights = columnHeights(__testing.debugChartRows(panel).map(stripAnsi));
	expect(heights.some(height => height > 0)).toBe(true);
});

test("zero cost with unpriced requests renders N/A, never $0.00", async () => {
	const panel = makePanel({
		data: dataFor({
			overview: { overall: overall({ totalCost: 0, unpricedRequests: 34870 }), byAgentType: [], timeSeries: [] },
		}),
	});
	await __testing.settled(panel);
	const body = __testing.debugBody(panel).join("\n");
	expect(body).toContain("N/A");
	expect(body).not.toContain("$0.00");
});

test("tokens are shown as separate cells, never as one combined total", async () => {
	const panel = makePanel({ data: dataFor() });
	await __testing.settled(panel);
	const body = __testing.debugBody(panel).join("\n");
	// The four token kinds are the layout IR's own stat tiles now. "fresh" and
	// "written" were the hand-written screen's wording; what the rule protects is
	// that the kinds are SEPARATE, which four distinct labels prove.
	expect(body).toContain("Uncached input");
	expect(body).toContain("Cache read");
	expect(body).toContain("Cache write");
	expect(body).toContain("Output");
	// 1M fresh + 250k output + 40M read + 2M written is the figure a combined
	// total would print. Cache reads dominate it, which is why they do not.
	expect(body).not.toContain("43.3M");
});

test("an empty cost series is stated as empty, not drawn as a wall of zero columns", async () => {
	const panel = makePanel({ data: dataFor({ costs: { costSeries: [] } }) });
	await __testing.settled(panel);
	expect(__testing.debugBody(panel).join("\n")).toContain("No activity recorded");
});

// ---------------------------------------------------------------------------
// G5 / G6: the rule invariant, checked against the REAL FRAME
// ---------------------------------------------------------------------------

/**
 * A run of three or more rule characters — the shape `band.test.ts` bans.
 * The panel's own frame borders (`╭`, `│`, `╰`) are deliberately NOT matched:
 * G6 is about SECTION rules inside the body, and the overlay's own border is
 * chrome, exactly as `usage-dashboard` has one.
 */
const RULE_RUN = /[─━═]{3,}/;

async function renderedFrame(screenId: (typeof SELECTABLE)[number]["id"], width = 120): Promise<string[]> {
	const panel = makePanel({ data: dataFor(), screenId, rows: 40 });
	await __testing.settled(panel);
	return panel.render(width).map(stripAnsi);
}

test("G6: the frame carries EXACTLY ONE divider, and it is the PanelDivider's", async () => {
	// G5 and G6 were only ever asserted against `renderBands(...)` — the grammar
	// in isolation. The screens the panel ACTUALLY paints do not go through it, so
	// the invariant was enforced nowhere in real output. This reads the real frame.
	//
	// The frame's top and bottom borders are CHROME (`OverlayPanel` draws them,
	// exactly as it draws the divider) and are not what G6 is about. G6 is about
	// dividers: `usage-dashboard.ts:573` has exactly one, between body and footer.
	for (const screen of SELECTABLE) {
		const frame = await renderedFrame(screen.id);
		const dividers = frame.filter(row => row.includes("├"));
		expect(dividers.length, `${screen.id} painted ${dividers.length} dividers`).toBe(1);

		// Exactly one divider, and nothing else inside the body that reads as a
		// horizontal rule. Borders and the divider are the overlay's own chrome.
		const body = frame.filter(
			row => !row.startsWith("╭") && !row.startsWith("╰") && !row.includes("├"),
		);
		const stray = body.filter(row => RULE_RUN.test(row));
		expect(stray.length, `${screen.id} painted a rule that is not the divider:\n${stray.join("\n")}`).toBe(0);
	}
});

test("G5: no screen paints a section rule inside its body", async () => {
	// Every selectable screen, not just the overview: each one composes its own
	// rows today, and a rule added to any of them must fail here.
	for (const screen of SELECTABLE) {
		const frame = await renderedFrame(screen.id);
		// Drop the two chrome rows (top border and the divider) — chrome is not body.
		const body = frame.slice(1, -1).filter(row => !row.includes("├"));
		for (const row of body) {
			expect(row, `${screen.id} painted a section rule: ${JSON.stringify(row)}`).not.toMatch(RULE_RUN);
		}
	}
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

test("dispose is idempotent, kills the ingest child, and never calls done", () => {
	const killed = { count: 0 };
	const panel = makePanel({
		startIngest: () => ({
			kill: () => {
				killed.count++;
			},
			settled: Promise.resolve(),
		}),
	});
	panel.handleInput("s");
	expect(killed.count).toBe(0);

	panel.dispose();
	panel.dispose();
	expect(killed.count).toBe(1);
	expect(__testing.debugClosed(panel)).toBe(true);
	expect(__testing.debugDoneCalls(panel)).toBe(0);
});

test("esc closes exactly once however many times it is pressed", async () => {
	const panel = makePanel({ data: dataFor() });
	await __testing.settled(panel);
	panel.handleInput("\x1b");
	panel.handleInput("\x1b");
	panel.handleInput("q");
	expect(__testing.debugDoneCalls(panel)).toBe(1);
	expect(__testing.debugClosed(panel)).toBe(true);
});

test("keys after close are inert", async () => {
	const panel = makePanel({ data: dataFor() });
	await __testing.settled(panel);
	panel.handleInput(RIGHT);
	await __testing.settled(panel);
	panel.handleInput("\x1b");
	const screen = __testing.debugScreenId(panel);
	panel.handleInput(RIGHT);
	panel.handleInput("r");
	expect(__testing.debugScreenId(panel)).toBe(screen);
	expect(__testing.debugRange(panel)).toBe(DEFAULT_RANGE);
});
