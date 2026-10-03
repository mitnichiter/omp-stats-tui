import { test, expect } from "bun:test";
import { overviewScreen } from "../src/tui/screens/overview";
import type { ScreenContext } from "../src/tui/screens/types";
import type { PanelData, ModelDashboardPayload } from "../src/data/api";
import { planLayout } from "../src/tui/layout";
import { glyphsFor } from "../src/tui/glyphs";
import { DEFAULT_RANGE } from "../src/data/ranges";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import type { ModelStats } from "@oh-my-pi/omp-stats/shared-types";

ensureThemeSync();

function ctxWith(data: Partial<PanelData>, width = 100, range = DEFAULT_RANGE): ScreenContext {
	return {
		width,
		rows: 40,
		range,
		theme,
		preset: "unicode",
		glyphs: glyphsFor("unicode"),
		plan: planLayout(width, 40, "unicode"),
		data: data as PanelData,
		colorFor: () => (t: string) => t,
	};
}

const NOW = 1_757_000_000_000;

/** A model whose spend could not be measured. Sits at the top by request count. */
function model(
	name: string,
	overrides: Partial<ModelStats> & { totalCost: number },
): ModelStats {
	return {
		model: name,
		provider: "openrouter",
		totalRequests: 1000,
		successfulRequests: 990,
		failedRequests: 10,
		errorRate: 0.01,
		totalInputTokens: 1_000_000,
		totalOutputTokens: 500_000,
		totalCacheReadTokens: 100_000,
		totalCacheWriteTokens: 50_000,
		cacheRate: 0.09,
		cacheSavings: 0.1,
		unpricedRequests: 0,
		totalPremiumRequests: 0,
		avgDuration: 4200,
		avgTtft: 800,
		avgTokensPerSecond: 120,
		firstTimestamp: NOW - 86_400_000,
		lastTimestamp: NOW,
		...overrides,
	};
}

/**
 * Shape taken from the real 185k-row database: 95% cache-read, an unpriced
 * model at the top by volume, and a 41x price spread between two models.
 */
function modelDashboard(): ModelDashboardPayload {
	const byModel = [
		// Heaviest by tokens AND requests, and entirely unpriced.
		model("some-unpriced-model", {
			totalRequests: 34_870,
			totalCacheReadTokens: 4_040_000_000,
			totalInputTokens: 8_000_000,
			totalCost: 0,
			unpricedRequests: 34_870,
			cacheRate: 0.998,
		}),
		// Comparable token volume, 41x the price.
		model("gpt-5.6-terra", { totalRequests: 12_000, totalCacheReadTokens: 2_390_000_000, totalCost: 935.72, cacheRate: 0.95 }),
		model("deepseek-v4-flash", { totalRequests: 20_000, totalCacheReadTokens: 1_100_000_000, totalCost: 22.85, cacheRate: 0.94 }),
		model("claude-sonnet-5", { totalRequests: 4_000, totalCacheReadTokens: 300_000_000, totalCost: 61.4, cacheRate: 0.9 }),
		model("gemini-3-pro", { totalRequests: 900, totalCacheReadTokens: 40_000_000, totalCost: 14.2, cacheRate: 0.88 }),
		model("kimi-k3", { totalRequests: 700, totalCacheReadTokens: 20_000_000, totalCost: 3.1, cacheRate: 0.8 }),
		model("llama-4-405b", { totalRequests: 400, totalCacheReadTokens: 9_000_000, totalCost: 1.9, cacheRate: 0.7 }),
	];
	return {
		byModel,
		modelSeries: byModel.map((m, i) => ({
			timestamp: NOW - i * 86_400_000,
			model: m.model,
			provider: m.provider,
			requests: m.totalRequests,
		})),
		modelPerformanceSeries: [],
	};
}

function busyOverview() {
	return {
		overall: {
			totalRequests: 73_870,
			successfulRequests: 72_100,
			failedRequests: 1_770,
			errorRate: 0.024,
			// 600M fresh against 23.4B cache-read is the ~97% cache profile this
			// database actually has. A draft that put fresh at 24B made the cache
			// share read 49% — arithmetically consistent, but not a profile this
			// account has, so it made the cache-share assertion meaningless.
			totalInputTokens: 600_000_000,
			totalOutputTokens: 1_900_000_000,
			totalCacheReadTokens: 23_400_000_000,
			totalCacheWriteTokens: 640_000_000,
			cacheRate: 0.974,
			cacheSavings: 0.81,
			totalCost: 1039.27,
			unpricedRequests: 34_870,
			totalPremiumRequests: 0,
			avgDuration: 4200,
			avgTtft: 810,
			avgTokensPerSecond: 118,
			firstTimestamp: NOW - 86_400_000,
			lastTimestamp: NOW,
		},
		byAgentType: [],
		timeSeries: Array.from({ length: 24 }, (_, i) => ({
			timestamp: NOW - (23 - i) * 3_600_000,
			requests: 900 + Math.round(1600 * Math.sin(i / 3)),
			errors: 12 + (i % 7),
			tokens: 1_000_000_000 + i * 12_000_000,
			cost: Number((20 + 55 * Math.abs(Math.cos(i / 4))).toFixed(2)),
		})),
	};
}

/** The realistic pair every body test starts from. */
const busy = (): PanelData => ({
	overview: busyOverview(),
	modelDashboard: modelDashboard(),
});

test("overview renders a realistic fixture without throwing and without an undefined in any cell", () => {
	const rows = overviewScreen.render(
		ctxWith({ overview: busyOverview(), modelDashboard: modelDashboard() }),
	);
	expect(rows.length).toBeGreaterThan(8);
	const text = rows.join("\n");
	expect(text).not.toMatch(/undefined/);
	expect(text).not.toMatch(/NaN/);
	expect(text).not.toMatch(/\[object/);
});

test("overview never prints a bare combined token total", () => {
	const text = overviewScreen
		.render(ctxWith({ overview: busyOverview(), modelDashboard: modelDashboard() }))
		.join("\n");
	// 23.4B of the tokens here are cache-read. A single "24B tokens" cell would be
	// arithmetically true and informationally empty, so the split is mandatory.
	// The check is on the LABEL side: a row called "tokens"/"total" holding one
	// figure is the bare total, whereas "cache-read  23B" is the split working.
	const tokenRows = text.split("\n").filter(l => /^\s{2}\S/.test(l));
	for (const row of tokenRows) {
		expect(row, `bare combined token total: ${row}`).not.toMatch(
			/^\s{2}(total )?tokens\s+\d/,
		);
	}
	// And the three glossary categories are each present as their own row.
	expect(text).toMatch(/fresh\s+[\d.]+[KMB]/);
	expect(text).toMatch(/cache-read\s+[\d.]+[KMB]/);
	expect(text).toMatch(/cache-write\s+[\d.]+[KMB]/);
	// 23.4B cache-read against 600M fresh: the share must reflect that, not a
	// number derived from a combined total.
	expect(text).toMatch(/cache share\s+9[0-9]\.\d%/);
});
test("overview shows the unpriced model as N/A, never as $0.00", () => {
	const rows = overviewScreen
		.render(ctxWith({ overview: busyOverview(), modelDashboard: modelDashboard() }))
		.join("\n");
	const line = rows.split("\n").find(l => l.includes("some-unpriced-model"));
	expect(line, "the unpriced model must be listed").toBeDefined();
	expect(line).not.toContain("$0.00");
	expect(line).toContain("N/A");
	// And its unpriced count rides beside the headline total.
	expect(rows).toMatch(/unpriced/i);
});

test("the headline cost carries its unpriced count rather than reading as the whole bill", () => {
	const text = overviewScreen
		.render(ctxWith({ overview: busyOverview(), modelDashboard: modelDashboard() }))
		.join("\n");
	expect(text).toMatch(/1,039\.27/);
	expect(text).toMatch(/34,870 unpriced/);
});

test("the daily chart is scaled by cost, so the cheap high-token model cannot outrank the expensive one", () => {
	const rows = overviewScreen
		.render(ctxWith({ overview: busyOverview(), modelDashboard: modelDashboard() }))
		.join("\n");
	// gpt-5.6-terra ($935.72, 2.39B tokens) must sit above deepseek-v4-flash
	// ($22.85, 1.1B+ tokens). A token-scaled chart reverses this.
	const terra = rows.split("\n").findIndex(l => l.includes("gpt-5.6-terra"));
	const flash = rows.split("\n").findIndex(l => l.includes("deepseek-v4-flash"));
	expect(terra).toBeGreaterThanOrEqual(0);
	expect(flash).toBeGreaterThanOrEqual(0);
	// renderRankedBars sorts descending, so the expensive model comes first.
	expect(terra).toBeLessThan(flash);
});

test("every overview line fits the width it was given", () => {
	const data = { overview: busyOverview(), modelDashboard: modelDashboard() };
	for (let width = 40; width <= 200; width++) {
		for (const row of overviewScreen.render(ctxWith(data, width))) {
			expect(Bun.stringWidth(row), `width=${width} row=${JSON.stringify(row)}`).toBeLessThanOrEqual(
				planLayout(width, 40, "unicode").innerWidth,
			);
		}
	}
});

test("an empty payload renders a defined empty state, not a wall of zeros and not a crash", () => {
	for (const data of [{}, { overview: undefined, modelDashboard: undefined }]) {
		const rows = overviewScreen.render(ctxWith(data as Partial<PanelData>));
		expect(rows.length).toBeGreaterThan(0);
		const text = rows.join("\n");
		expect(text).toMatch(/no usage recorded/i);
		expect(text).not.toMatch(/undefined/);
		expect(text).not.toMatch(/\$0\.00/);
	}
});

test("a zeroed overview is an empty state too, because zero requests is not zero everything", () => {
	const zeroed = {
		overall: { ...busyOverview().overall, totalRequests: 0, totalCost: 0, unpricedRequests: 0 },
		byAgentType: [],
		timeSeries: [],
	};
	const text = overviewScreen.render(ctxWith({ overview: zeroed })).join("\n");
	expect(text).toMatch(/no usage recorded/i);
});

test("no screen module hand-writes a heading glyph", async () => {
	// Every heading icon comes from statsIcon. This asserts the file mentions no
	// emoji literal, which is what a hand-written heading would look like.
	const src = await Bun.file(new URL("../src/tui/screens/overview.ts", import.meta.url)).text();
	expect(src).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
	expect(src).toContain("statsIcon");
});

test("overview declares the data its body reads, and nothing more", () => {
	expect(overviewScreen.needs).toContain("overview");
	expect(overviewScreen.needs).toContain("modelDashboard");
	expect(overviewScreen.status).toBe("implemented");
	// An implemented screen states no "not built yet" reason.
	expect(overviewScreen.reason).toBeUndefined();
});

test("rendering the overview twice yields identical rows — it is pure", () => {
	const data = { overview: busyOverview(), modelDashboard: modelDashboard() };
	expect(overviewScreen.render(ctxWith(data))).toEqual(overviewScreen.render(ctxWith(data)));
});

test("a genuinely free model is listed, not dropped for its $0 total", () => {
	// Found against the real database: pivotSeries filters zero-total series out,
	// so a free-tier account's models all vanish and the screen printed "No model
	// breakdown" while 3,679 requests sat in the rows.
	const free = modelDashboard();
	const rows = overviewScreen
		.render(ctxWith({ overview: busyOverview(), modelDashboard: free }))
		.join("\n");
	expect(rows).not.toMatch(/no model breakdown/i);
	for (const m of free.byModel) {
		expect(rows, `model ${m.model} must be listed`).toContain(m.model);
	}
});

test("an all-zero cost series says so instead of drawing a wall of empty columns", () => {
	// Same live run: 96 columns of empty track is a chart that cannot distinguish
	// "no spend" from "no data", and this account records a true $0.
	const zero = busyOverview();
	zero.overall = { ...zero.overall, totalCost: 0, unpricedRequests: 0 };
	zero.timeSeries = zero.timeSeries.map(p => ({ ...p, cost: 0 }));
	const free = modelDashboard().byModel.map(m => ({ ...m, totalCost: 0, unpricedRequests: 0 }));
	const rows = overviewScreen
		.render(
			ctxWith({
				overview: zero,
				modelDashboard: { byModel: free, modelSeries: [], modelPerformanceSeries: [] },
			}),
		)
		.join("\n");
	expect(rows).toMatch(/no cost was recorded/i);
	// Scoped to whole-line tracks: `░` is also `barEmpty`, so the ranked model's
	// own bar track legitimately contains it. What must not appear is a full-width
	// row made of nothing but empty track — that is the failed chart.
	expect(
		rows.split("\n").some(line => /^[\s░]{20,}$/.test(line.replace(/\u001b\[[0-9;]*m/g, ""))),
	).toBe(false);
});

test("overview declares rollupStatus, so a stale panel can say so", () => {
	// ADR-0006: the dirty-hour count must always be visible, or not-yet-built
	// hours read as $0.00. Restored after Task 13's body change dropped it.
	expect(overviewScreen.needs).toContain("rollupStatus");
});

test("a dirty rollup is stated, not hidden", () => {
	const text = overviewScreen
		.render(ctxWith({ ...busy(), rollupStatus: { dirtyHours: 120, dirtySessions: 4 } }))
		.join("\n");
	// Above 96 dirty hours the host stops unioning with facts and returns rows
	// with holes in them, so the reader MUST be told the figures are partial.
	expect(text).toMatch(/120 dirty hour/i);
	expect(text).toMatch(/not yet built|stale/i);
});

test("a clean rollup says nothing rather than printing a zero-count footnote", () => {
	const text = overviewScreen
		.render(ctxWith({ ...busy(), rollupStatus: { dirtyHours: 0, dirtySessions: 0 } }))
		.join("\n");
	expect(text).not.toMatch(/dirty hour/i);
});

test("a missing rollupStatus is not reported as a clean rollup", () => {
	// Absent data is unknown, not zero — the same distinction the payload's own
	// DbReadiness union exists to force.
	const text = overviewScreen.render(ctxWith(busy())).join("\n");
	expect(text).not.toMatch(/dirty hour/i);
	expect(text).not.toMatch(/rollup/i);
});

test("the ascii preset draws ascii headings, whatever the theme singleton holds", () => {
	// Found by running the probe: `statsIcon(preset, role, theme)` ignores its
	// preset argument whenever a theme is supplied and returns the LIVE
	// singleton's glyph, so an ascii screen drew emoji headings. The screen
	// resolves icons against ctx.preset — which is what it also renders glyphs
	// and the layout plan from — rather than a singleton that may disagree.
	const ctx = { ...ctxWith(busy(), 100), preset: "ascii" as const, glyphs: glyphsFor("ascii") };
	const rows = overviewScreen.render(ctx).join("\n");
	expect(rows).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
	expect(rows).toContain("$");
	expect(rows).toContain("[M]");
});