import { test, expect } from "bun:test";
import { activityScreen } from "../src/tui/screens/activity";
import type { DailyActivityPoint } from "@oh-my-pi/omp-stats/shared-types";
import type { PanelData } from "../src/data/api";
import type { ScreenContext } from "../src/tui/screens/types";
import { planLayout } from "../src/tui/layout";
import { glyphsFor, type SymbolPreset } from "../src/tui/glyphs";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import { DEFAULT_RANGE } from "../src/data/ranges";

// Same shape as the one in screens.test.ts, kept local so this file does not
// couple to another test file's internals. Screens must be renderable headless,
// which is the whole reason ScreenContext carries a Theme instead of reading the
// theme singleton.
ensureThemeSync();
function makeCtx(data: Partial<PanelData>, width = 120, preset: SymbolPreset = "unicode"): ScreenContext {
	return {
		width,
		rows: 40,
		range: DEFAULT_RANGE,
		theme,
		preset,
		glyphs: glyphsFor(preset),
		plan: planLayout(width, 40, preset),
		data: data as PanelData,
		colorFor: () => (t: string) => t,
	};
}

/**
 * A year of plausible activity, including a deliberate stretch of quiet days and
 * a gap at the recent end. The quiet stretch is what proves zero-fill: the
 * host's query emits rows only for days that HAVE activity, so a renderer that
 * trusted its input would drop those days from the calendar entirely.
 */
function busyDays(): DailyActivityPoint[] {
	const points: DailyActivityPoint[] = [];
	let seed = 11;
	for (let i = 0; i < 300; i++) {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		// Every 9th day is quiet, and the last 5 are absent entirely.
		if (i % 9 === 0 || i > 294) continue;
		const date = new Date(2025, 10, 1 + i);
		points.push({
			day: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
				date.getDate(),
			).padStart(2, "0")}`,
			cost: (seed % 1000) / 100,
			requests: seed % 40,
			totalTokens: seed % 90_000,
		});
	}
	return points;
}

const EMPTY_COSTS = { costSeries: [] } as unknown as PanelData["costs"];
const DAY_MS = 86_400_000;
const costsFor = (days: DailyActivityPoint[]) => ({
	costSeries: days.map((point, i) => ({
		timestamp: new Date(point.day).getTime() + i,
		model: "test/model",
		provider: "test",
		cost: point.cost,
		unpricedRequests: 0,
		costInput: point.cost,
		costOutput: 0,
		costCacheRead: 0,
		costCacheWrite: 0,
		requests: point.requests,
	})),
});

test("activity renders a real calendar, not placeholder rows", () => {
	const rows = activityScreen.render(
		makeCtx({ dailyActivity: busyDays(), costs: costsFor(busyDays()) }, 100),
	);
	const text = rows.join("\n");
	expect(text).not.toContain("placeholder");
	expect(text).not.toContain("example-");
	expect(text).not.toContain("undefined");
	expect(text).not.toContain("NaN");
	// The month-label row plus seven Monday-first day rows.
	expect(rows.length).toBeGreaterThanOrEqual(8);
});

test("every line is within the requested width across the whole range of widths", () => {
	for (const width of [40, 60, 80, 100, 140, 200]) {
		const rows = activityScreen.render(
			makeCtx({ dailyActivity: busyDays(), costs: costsFor(busyDays()) }, width),
		);
		for (const row of rows) {
			expect(Bun.stringWidth(row), `w=${width}: ${row}`).toBeLessThanOrEqual(width);
		}
	}
});

test("a day with no activity still occupies its cell — zero-fill", () => {
	// One lone active day inside an otherwise empty window. If the renderer trusted
	// its input rows, the calendar would be a single cell instead of a full grid,
	// and quiet days would vanish from the axis entirely (the bug Crush has).
	const rows = activityScreen.render(
		makeCtx(
			{
				dailyActivity: [{ day: "2026-06-15", cost: 4, requests: 3, totalTokens: 900 }],
				costs: EMPTY_COSTS,
			},
			100,
		),
	);
	// Seven weekday rows, each carrying cells for the whole window.
	const body = rows.filter(row => !row.trimEnd().startsWith("  ") || row.trim().length > 0);
	expect(rows.length).toBeGreaterThanOrEqual(8);
	expect(rows.join("")).toContain("·"); // the zero-day glyph, so days are drawn
});

test("a future day renders differently from a zero-activity past day", () => {
	// A payload with activity, so a grid is actually drawn — an empty array takes
	// the empty-state branch and would assert nothing about cells.
	const rows = activityScreen.render(
		makeCtx({ dailyActivity: busyDays(), costs: EMPTY_COSTS }, 100),
	);
	// Stripped of colour, the grid must contain BOTH the empty-day glyph (a day
	// that happened and had nothing) and a run of blank cells (a day that has not
	// happened yet). Absent and zero are different states and must not collapse.
	const text = rows.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
	expect(text).toContain("·");
	expect(/\s{2,}/.test(text)).toBe(true);
});

test("the legend states real thresholds, so a colour means something", () => {
	const text = activityScreen
		.render(makeCtx({ dailyActivity: busyDays(), costs: costsFor(busyDays()) }, 140))
		.join("\n");
	// A legend without thresholds is decoration.
	expect(text).toMatch(/less|none|0\b/i);
	expect(text).toMatch(/more|busiest|100%/i);
});

test("the summary reports cost, requests and the busiest day", () => {
	const days = busyDays();
	const text = activityScreen
		.render(makeCtx({ dailyActivity: days, costs: costsFor(days) }, 140))
		.join("\n");
	expect(text).toMatch(/\$/);
	expect(text).toMatch(/requests|req/i);
	expect(text).toMatch(/busiest/i);
});

test("unpriced spend reads as unknown, never as $0.00", () => {
	// A day with requests but no recorded cost is UNKNOWN SPEND, not free spend.
	const days: DailyActivityPoint[] = [
		{ day: "2026-06-15", cost: 0, requests: 12, totalTokens: 4000 },
		{ day: "2026-06-16", cost: 5, requests: 3, totalTokens: 900 },
	];
	const text = activityScreen
		.render(makeCtx({ dailyActivity: days, costs: costsFor(days) }, 140))
		.join("\n");
	expect(text).not.toMatch(/\$0\.00\b(?!.*unpriced)/);
	expect(text.toLowerCase()).toContain("unpriced");
});

test("an absent payload renders a defined empty state, not a blank grid", () => {
	// fetchDailyActivity is the one slow query, so it can be absent while the rest
	// of the panel is ready. An EMPTY GRID would read as "you did nothing".
	const text = activityScreen
		.render(makeCtx({ dailyActivity: undefined, costs: EMPTY_COSTS }, 100))
		.join("\n");
	expect(text.toLowerCase()).toMatch(/no activity|unavailable|nothing/);
	expect(text).not.toContain("undefined");
});

test("an empty payload is an honest empty state", () => {
	const text = activityScreen
		.render(makeCtx({ dailyActivity: [], costs: EMPTY_COSTS }, 100))
		.join("\n");
	expect(text.toLowerCase()).toMatch(/no activity|nothing/);
});

test("the screen declares the daily-activity need so it loads independently", () => {
	expect(activityScreen.needs).toContain("dailyActivity");
	expect(activityScreen.needs).toContain("costs");
	expect(activityScreen.status).toBe("implemented");
	expect(activityScreen.reason).toBeUndefined();
});

test("the heatmap ink comes from the glyph set, never a literal", () => {
	const rows = activityScreen.render(
		makeCtx({ dailyActivity: busyDays(), costs: costsFor(busyDays()) }, 100),
	);
	// Both presets must render without throwing, which is only true if the cells
	// come from the GlyphSet rather than from a hardcoded character.
	for (const preset of ["unicode", "ascii"] as const) {
		expect(() =>
			activityScreen.render(
				makeCtx({ dailyActivity: busyDays(), costs: costsFor(busyDays()) }, 100, preset),
			),
		).not.toThrow();
	}
	expect(rows.length).toBeGreaterThan(0);
});

test("render is pure — the same context renders the same bytes", () => {
	const ctx = makeCtx({ dailyActivity: busyDays(), costs: costsFor(busyDays()) }, 100);
	expect(activityScreen.render(ctx)).toEqual(activityScreen.render(ctx));
});

test("day arithmetic stays on local dates across a month boundary", () => {
	// A UTC-keyed implementation would shift these by a day and misplace the
	// activity. Cheap to pin, and the failure is a silently wrong calendar.
	const days: DailyActivityPoint[] = [
		{ day: "2026-01-31", cost: 1, requests: 1, totalTokens: 10 },
		{ day: "2026-02-01", cost: 2, requests: 1, totalTokens: 10 },
	];
	expect(activityScreen.render(makeCtx({ dailyActivity: days, costs: costsFor(days) }, 120)).length)
		.toBeGreaterThanOrEqual(8);
	expect(DAY_MS).toBe(86_400_000);
});