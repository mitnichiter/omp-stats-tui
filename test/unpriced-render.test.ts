/**
 * `test/unpriced-render.test.ts` — unknown spend reads N/A, real zero reads $0.
 *
 * The no-card-vs-free distinction is asserted at render level in
 * `test/models-screen.test.ts` (Cost column) and `test/overview-screen.test.ts`
 * (cost tile + hint). This file checks the headline-cost pipeline on isolated
 * fixture data; it never reads or initializes the user's database.
 */

import { test, expect } from "bun:test";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import type { ThemeColor } from "@oh-my-pi/pi-tui";

import { SCREEN_SPECS } from "../src/layout/spec";
import { screenBands, type ScreenRenderOptions } from "../src/tui/render/screen";
import { planLayout } from "../src/tui/layout";
import { glyphsFor } from "../src/tui/glyphs";
import { SERIES_COLORS, stripForTest } from "../src/tui/palette";
import { DEFAULT_RANGE } from "../src/data/ranges";
import type { PanelData } from "../src/data/api";
import type { ModelStats } from "@oh-my-pi/omp-stats/shared-types";

ensureThemeSync();

function model(name: string, cost: number, unpriced: number, requests: number): ModelStats {
	return {
		model: name,
		provider: "openai",
		totalRequests: requests,
		successfulRequests: requests,
		failedRequests: 0,
		errorRate: 0,
		totalInputTokens: 1000,
		totalOutputTokens: 1000,
		totalCacheReadTokens: 1000,
		totalCacheWriteTokens: 0,
		cacheRate: 0.5,
		cacheSavings: 0,
		totalCost: cost,
		unpricedRequests: unpriced,
		totalPremiumRequests: 0,
		avgDuration: 1,
		avgTtft: 1,
		avgTokensPerSecond: 1,
		firstTimestamp: 0,
		lastTimestamp: 1,
	};
}

/**
 * A priced model, a genuinely free one, and a NO-CARD one whose spend is
 * unknown. The no-card model is the bug; the free one is the regression guard
 * beside it.
 */
const payload: PanelData = {
	overview: {
		overall: {
			totalRequests: 50_000,
			successfulRequests: 50_000,
			failedRequests: 0,
			errorRate: 0,
			totalInputTokens: 1e8,
			totalOutputTokens: 1e8,
			totalCacheReadTokens: 1e8,
			totalCacheWriteTokens: 0,
			cacheRate: 0.5,
			cacheSavings: 0,
			totalCost: 900,
			unpricedRequests: 4197,
			totalPremiumRequests: 0,
			avgDuration: 1,
			avgTtft: 1,
			avgTokensPerSecond: 1,
			firstTimestamp: 0,
			lastTimestamp: 1,
		},
		byAgentType: [],
		timeSeries: [],
	},
	modelDashboard: {
		byModel: [
			model("gpt-5.6-sol", 900, 0, 20_000),
			// NO catalog card, spend unknown. Must read N/A.
			model("gemini-3.7-flash-high", 0, 4197, 4205),
			// EXPLICIT all-zero card, spend really free. Must stay $0.
			model("space-bunny-free", 0, 0, 36_496),
		],
		modelSeries: [],
		modelPerformanceSeries: [],
	},
} as PanelData;

const overviewSpec = SCREEN_SPECS.find(s => s.id === "overview")!;

test("the headline cost carries the corrected unpriced count", () => {
	// The pipeline cost tile reads its unpriced count from its own hint, so
	// "$900.00" beside "4,197 unpriced" is one honest figure, never a total
	// that silently excludes the unmeasured requests.
	const bands = screenBands({
		spec: overviewSpec,
		data: payload,
		plan: planLayout(100, 40, "unicode"),
		preset: "unicode",
		range: DEFAULT_RANGE,
		now: Date.now(),
		fg: (color: ThemeColor, text: string) => theme.fg(color, text),
		bold: text => theme.bold(text),
		palette: theme,
		seriesColorFor: index => SERIES_COLORS[index % SERIES_COLORS.length],
		glyphs: glyphsFor("unicode"),
	} satisfies ScreenRenderOptions);
	const first = bands.find(b => b.kind === "statRow");
	expect(first, "overview has no statRow band").toBeTruthy();
	if (first === undefined || first.kind !== "statRow") throw new Error("first band is not a statRow");
	const cost = first.stats.find(t => t.label === "API-equivalent cost")!;
	expect(stripForTest(cost.value)).toBe("$900.00");
	expect(stripForTest(cost.hint ?? "")).toBe("4,197 unpriced");
});

