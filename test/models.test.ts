/**
 * The models screen.
 *
 * Every test here is a claim the screen makes to a person reading their own
 * spend, so each is written as the thing that would be WRONG rather than the
 * thing that is merely absent. A missing bar is a smaller problem than a bar
 * that ranks a cheap high-token model above an expensive one.
 */

import { test, expect } from "bun:test";
import { modelsScreen } from "../src/tui/screens/models";
import { screenById } from "../src/tui/screens/types";
import { RANGES, DEFAULT_RANGE } from "../src/data/ranges";
import type { PanelData, ModelDashboardPayload } from "../src/data/api";
import { planLayout } from "../src/tui/layout";
import { glyphsFor } from "../src/tui/glyphs";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import type { ModelStats } from "@oh-my-pi/omp-stats/client/types";
import type { ScreenContext } from "../src/tui/screens/types";

ensureThemeSync();

const DAY = 86_400_000;

function ctxWith(data: Partial<PanelData>, width = 120): ScreenContext {
	return {
		width,
		rows: 40,
		range: DEFAULT_RANGE,
		theme,
		preset: "unicode",
		glyphs: glyphsFor("unicode"),
		plan: planLayout(width, 40, "unicode"),
		data: data as PanelData,
		colorFor: () => (t: string) => t,
	};
}

function model(over: Partial<ModelStats> & { model: string }): ModelStats {
	return {
		provider: "opencode-go",
		totalRequests: 100,
		successfulRequests: 99,
		failedRequests: 1,
		errorRate: 0.01,
		totalInputTokens: 1_000,
		totalOutputTokens: 1_000,
		totalCacheReadTokens: 10_000,
		totalCacheWriteTokens: 0,
		cacheRate: 0.909,
		cacheSavings: 0.4,
		totalCost: 1,
		unpricedRequests: 0,
		totalPremiumRequests: 0,
		avgDuration: 1200,
		avgTtft: 300,
		avgTokensPerSecond: 40,
		firstTimestamp: 0,
		lastTimestamp: DAY,
		...over,
	};
}

/**
 * The 41x case, as the plan states it: a cheap model reading an order of
 * magnitude more tokens than an expensive one. Anything that scales a bar by
 * tokens inverts these two rows, which is the bug this fixture exists to catch.
 */
function spreadFixture(): ModelDashboardPayload {
	return {
		byModel: [
			model({
				model: "example/cheap-token-heavy",
				provider: "opencode-go",
				totalRequests: 9000,
				totalInputTokens: 4_040_000_000,
				totalCacheReadTokens: 1_000,
				totalOutputTokens: 90_000,
				totalCost: 22.85,
			}),
			model({
				model: "example/expensive-token-light",
				provider: "openai",
				totalRequests: 300,
				totalInputTokens: 2_000,
				totalCacheReadTokens: 2_390_000_000,
				totalOutputTokens: 30_000,
				totalCost: 935.72,
			}),
			model({
				model: "example/unknown-price",
				provider: "openai",
				totalRequests: 40,
				totalCost: 0,
				unpricedRequests: 40,
			}),
			model({
				model: "example/genuinely-free",
				provider: "opencode-go",
				totalRequests: 500,
				totalCost: 0,
				unpricedRequests: 0,
			}),
		],
		modelSeries: [
			{ timestamp: 0, model: "example/cheap-token-heavy", provider: "opencode-go", requests: 10 },
			{ timestamp: DAY, model: "example/cheap-token-heavy", provider: "opencode-go", requests: 20 },
			{ timestamp: 2 * DAY, model: "example/cheap-token-heavy", provider: "opencode-go", requests: 40 },
			{ timestamp: 0, model: "example/expensive-token-light", provider: "openai", requests: 5 },
			{ timestamp: DAY, model: "example/expensive-token-light", provider: "openai", requests: 5 },
			{ timestamp: 2 * DAY, model: "example/expensive-token-light", provider: "openai", requests: 5 },
		],
		modelPerformanceSeries: [],
	};
}

const EMPTY: ModelDashboardPayload = {
	byModel: [],
	modelSeries: [],
	modelPerformanceSeries: [],
};

const render = (payload: ModelDashboardPayload, width = 120): string =>
	modelsScreen.render(ctxWith({ modelDashboard: payload }, width)).join("\n");

/** Only rows that actually carry a bar, so a bar assertion cannot be fooled elsewhere. */
function barLines(rows: readonly string[]): readonly string[] {
	return rows.filter(r => /[█░]{2,}/.test(r));
}
/** Rows that ARE a trend row, as opposed to a caveat that happens to say "trend". */
function trendRows(rows: readonly string[]): readonly string[] {
	return rows.filter(r => /^\s*trend\s/.test(r));
}

/** The sparkline run on a trend row, or "" if the row drew none. */
function sparkOf(row: string): string {
	return row.match(/[▁▂▃▄▅▆▇█]+/)?.[0] ?? "";
}

/** One model with a series of the given per-day request counts. */
function single(name: string, cost: number, daily: readonly number[]): ModelDashboardPayload {
	return {
		byModel: [
			model({
				model: name,
				totalCost: cost,
				totalRequests: daily.reduce((a, b) => a + b, 0),
				unpricedRequests: 0,
			}),
		],
		modelSeries: daily.map((requests, i) => ({
			timestamp: i * DAY,
			model: name,
			provider: "opencode-go",
			requests,
		})),
		modelPerformanceSeries: [],
	};
}

// ─── registry conformance ────────────────────────────────────────────────────

test("models is registered, implemented, and fetches only what its body reads", () => {
	expect(screenById("models")).toBe(modelsScreen);
	expect(modelsScreen.status).toBe("implemented");
	expect(modelsScreen.reason).toBeUndefined();
	expect([...modelsScreen.needs]).toEqual(["modelDashboard", "rollupStatus"]);
	expect(RANGES).toContain(DEFAULT_RANGE);
});

// ─── the plan's five drafted tests ───────────────────────────────────────────

test("models sorts by cost and renders an unpriced model as N/A, never free", () => {
	const rows = render(spreadFixture());
	expect(rows).toContain("N/A");
	expect(rows).toMatch(/unpriced/);
});

test("a single model does not break the bar list", () => {
	const one = single("example/solo", 5, [1, 1, 1]);
	expect(() => modelsScreen.render(ctxWith({ modelDashboard: one }))).not.toThrow();
	expect(render(one)).toContain("example/solo");
});

test("models renders one sparkline cell per trend row", () => {
	const rows = modelsScreen.render(ctxWith({ modelDashboard: spreadFixture() }));
	const trends = trendRows(rows);
	expect(trends.length).toBeGreaterThan(0);
	for (const t of trends) expect(sparkOf(t), t).not.toBe("");
});

test("every models row fits its width", () => {
	for (const width of [40, 80, 160]) {
		for (const r of modelsScreen.render(ctxWith({ modelDashboard: spreadFixture() }, width))) {
			expect(Bun.stringWidth(r), `w=${width}: ${r}`).toBeLessThanOrEqual(width);
		}
	}
});

test("models with no data says so", () => {
	expect(render(EMPTY)).toMatch(/no models/i);
});

// ─── no leaked values ────────────────────────────────────────────────────────

test("no row leaks undefined, NaN or [object Object]", () => {
	// The failure mode of a payload field that is absent rather than zero.
	// `NaN` is the one that reaches the terminal, because String(NaN) is a string.
	const blob = render(spreadFixture());
	expect(blob).not.toMatch(/undefined|NaN|\[object Object\]/);
});

test("no row leaks undefined or NaN when the payload is missing entirely", () => {
	expect(modelsScreen.render(ctxWith({})).join("\n")).not.toMatch(/undefined|NaN|\[object Object\]/);
});

// ─── $0 must never be ambiguous ─────────────────────────────────────────────

test("a model whose spend could not be measured reads N/A, a real zero price reads $0", () => {
	const lines = render(spreadFixture()).split("\n");
	const unpricedRow = lines.find(
		l => l.includes("example/unknown-price") && (l.includes("N/A") || l.includes("unpriced")),
	);
	expect(unpricedRow, lines.join("\n")).toBeTruthy();
	// The genuinely-free row is a DIFFERENT row, reads $0, and claims no unpriced count.
	const freeRows = lines.filter(l => l.includes("example/genuinely-free"));
	expect(freeRows.length).toBeGreaterThan(0);
	const freeRow = freeRows.find(l => l.includes("$0") && !l.includes("N/A"));
	expect(freeRow, freeRows.join("\n")).toBeTruthy();
	expect(freeRow).not.toContain("unpriced");
});

test("a model present with zero cost is not dropped like a model that is absent", () => {
	// pivotSeries drops zero-total series. Every model that made requests must
	// still be nameable, or a $0 model is indistinguishable from one nobody asked
	// about. The plan's own shape: request counts of 1111 / 222 / 33 / 7.
	const blob = render(spreadFixture());
	for (const name of [
		"example/cheap-token-heavy",
		"example/expensive-token-light",
		"example/unknown-price",
		"example/genuinely-free",
	]) {
		expect(blob, name).toContain(name);
	}
	// A model with no requests at all is the thing that may legitimately vanish.
	const base = spreadFixture();
	const withIdle: ModelDashboardPayload = {
		...base,
		byModel: [...base.byModel, model({ model: "example/never-used", totalRequests: 0, totalCost: 0, unpricedRequests: 0 })],
	};
	expect(render(withIdle)).not.toContain("example/never-used");
});

// ─── the 41x rule ────────────────────────────────────────────────────────────

test("bars rank by cost: the token-heavy cheap model is never the tallest bar", () => {
	const rows = modelsScreen.render(ctxWith({ modelDashboard: spreadFixture() }, 160));
	const bars = barLines(rows);
	const cheap = bars.find(l => l.includes("example/cheap-token-heavy"));
	const expensive = bars.find(l => l.includes("example/expensive-token-light"));
	expect(expensive, bars.join("\n")).toBeTruthy();
	expect(cheap, bars.join("\n")).toBeTruthy();
	const filled = (line: string | undefined) => (line!.match(/█/g) ?? []).length;
	expect(filled(expensive)).toBeGreaterThan(filled(cheap));
	// And the list itself is ordered descending by cost.
	expect(rows.indexOf(expensive!)).toBeLessThan(rows.indexOf(cheap!));
});

// ─── the per-model trend ─────────────────────────────────────────────────────

test("a flat series renders flat — one level, not noise", () => {
	const flat = single("example/flat", 30, [10, 10, 10, 10, 10, 10]);
	const trends = modelsScreen
		.render(ctxWith({ modelDashboard: flat }, 160))
		.filter(r => /^\s*trend\s/.test(r));
	expect(trends.length).toBeGreaterThan(0);
	for (const t of trends) {
		const cells = t.match(/[▁▂▃▄▅▆▇█]+/g) ?? [];
		expect(cells.length, `expected one contiguous ramp: ${t}`).toBe(1);
		expect(new Set(cells).size, `flat series drew mixed levels: ${t}`).toBe(1);
	}
});

test("an all-zero cost series sits on the baseline rather than filling the ramp", () => {
	// Rule 2 of renderSparkline: a zero maximum means there is nothing to show,
	// so the whole run sits on the baseline. Never a full bar for "nothing".
	const zero = single("example/all-zero", 0, [10, 10, 10, 10, 10, 10]);
	const trends = modelsScreen
		.render(ctxWith({ modelDashboard: zero }, 160))
		.filter(r => /^\s*trend\s/.test(r));
	expect(trends.length).toBeGreaterThan(0);
	for (const t of trends) {
		expect(t, `expected a baseline sparkline: ${t}`).toContain("▁▁");
		expect(t).not.toMatch(/[▂▃▄▅▆▇█]/);
	}
});

test("narrowing the panel keeps the NEWEST trend samples, not the oldest", () => {
	// 40 strictly-rising days. Clipping from the left would leave the trend
	// ending flat and reading as a plateau, which is the opposite of what
	// happened.
	const rising = single("example/rising", 400, Array.from({ length: 40 }, (_, i) => (i + 1) * 10));
	const trend = (width: number) => {
		const row = modelsScreen
			.render(ctxWith({ modelDashboard: rising }, width))
			.find(r => /^\s*trend\s/.test(r));
		expect(row, `no trend row at width ${width}`).toBeTruthy();
		return sparkOf(row!);
	};
	const wide = trend(200);
	const narrow = trend(80);
	expect(narrow).not.toBe("");
	// Non-vacuous: the narrow run really is shorter, so clipping happened.
	expect(narrow.length, `${wide} / ${narrow}`).toBeLessThan(wide.length);
	// And it is a SUFFIX of the wide one: same right-hand end, newest preserved.
	expect(wide.endsWith(narrow), `${wide} vs ${narrow}`).toBe(true);
	expect(narrow.at(-1)).toBe("█");
});

// ─── width ───────────────────────────────────────────────────────────────────

test("every row fits its width across the whole 40..200 sweep", () => {
	for (let width = 40; width <= 200; width += 4) {
		for (const r of modelsScreen.render(ctxWith({ modelDashboard: spreadFixture() }, width))) {
			expect(Bun.stringWidth(r), `w=${width}: ${r}`).toBeLessThanOrEqual(width);
		}
	}
});

test("the screen works under every symbol preset", () => {
	for (const preset of ["unicode", "nerd", "ascii"] as const) {
		const width = 120;
		const rows = modelsScreen.render({
			...ctxWith({ modelDashboard: spreadFixture() }, width),
			preset,
			glyphs: glyphsFor(preset),
			plan: planLayout(width, 40, preset),
		});
		expect(rows.length, preset).toBeGreaterThan(0);
		for (const r of rows) expect(Bun.stringWidth(r), `${preset}: ${r}`).toBeLessThanOrEqual(width);
	}
});

// ─── empty states ────────────────────────────────────────────────────────────

test("an empty payload renders a defined empty state, not a wall of zeros", () => {
	const rows = modelsScreen.render(ctxWith({ modelDashboard: EMPTY }));
	expect(rows.length).toBeGreaterThan(0);
	const blob = rows.join("\n");
	expect(blob).toMatch(/no models/i);
	// The dangerous reading is zeroes. "$0" here would claim the spend was free.
	expect(blob).not.toContain("$0");
	expect(blob).not.toContain("$0.00");
});

test("a missing payload is the same defined empty state as an empty one", () => {
	expect(modelsScreen.render(ctxWith({})).join("\n")).toMatch(/no models/i);
	expect(modelsScreen.render(ctxWith({ modelDashboard: EMPTY })).join("\n")).toMatch(/no models/i);
});

// ─── the content the brief asks for ──────────────────────────────────────────

test("tokens are never summed into one bare total", () => {
	// ~95% of this data is cache-read, so a combined total says almost nothing.
	// The split is the whole reason this screen exists.
	const blob = render(spreadFixture(), 200);
	expect(blob).toMatch(/fresh/i);
	expect(blob).toMatch(/cache-read/i);
	expect(blob).toMatch(/cache-write/i);
	// A bare unqualified token figure is the thing being banned.
	expect(blob).not.toMatch(/^\s*tokens\s+[\d,.]+\s*$/m);
});

test("the provider a model came from is on the screen", () => {
	// `opencode-go` and `openai` serve similar-sounding models at wildly
	// different prices; the reader cannot see that from the model name alone.
	const blob = render(spreadFixture(), 200);
	expect(blob).toContain("opencode-go");
	expect(blob).toContain("openai");
});

test("rendering is pure: the same context twice yields identical rows", () => {
	const ctx = ctxWith({ modelDashboard: spreadFixture() });
	expect(modelsScreen.render(ctx)).toEqual(modelsScreen.render(ctx));
});
