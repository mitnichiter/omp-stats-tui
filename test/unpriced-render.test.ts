import { test, expect } from "bun:test";
import { overviewScreen } from "../src/tui/screens/overview";
import { fetchModelDashboard, fetchOverview } from "../src/data/api";
import { planLayout } from "../src/tui/layout";
import { glyphsFor } from "../src/tui/glyphs";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import type { ScreenContext } from "../src/tui/screens/types";
import type { ModelDashboardPayload, PanelData } from "../src/data/api";
import type { ModelStats } from "@oh-my-pi/omp-stats/shared-types";
import { initDb } from "@oh-my-pi/omp-stats/db";

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

function ctx(data: PanelData): ScreenContext {
	return {
		width: 100,
		rows: 40,
		range: "all",
		theme,
		preset: "unicode",
		glyphs: glyphsFor("unicode"),
		plan: planLayout(100, 40, "unicode"),
		data,
		colorFor: () => (t: string) => t,
	};
}

/**
 * The shape the live database actually has: a priced model, a genuinely free
 * one, and a NO-CARD one whose spend is unknown. The no-card model is the bug;
 * the free one is the regression guard beside it.
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

test("a no-card model with unknown spend renders N/A in the model list", () => {
	const rows = overviewScreen.render(ctx(payload)).join("\n");
	const line = rows.split("\n").find(l => l.includes("gemini-3.7-flash-high"));
	expect(line, "the no-card model must be listed").toBeDefined();
	expect(line).toContain("N/A");
	expect(line).toContain("4,197 unpriced");
	expect(line).not.toContain("$0.00");
});

test("an explicit-zero-card model still renders $0 beside the same list", () => {
	// The regression guard. Without it, the fix above would mark every
	// free-tier model unknown and the test for N/A would pass anyway.
	const rows = overviewScreen.render(ctx(payload)).join("\n");
	const line = rows.split("\n").find(l => l.includes("space-bunny-free"))!;
	expect(line).toContain("$0");
	expect(line).not.toContain("N/A");
	expect(line).not.toContain("unpriced");
});

test("the headline cost carries the corrected unpriced count", () => {
	const rows = overviewScreen.render(ctx(payload)).join("\n");
	expect(rows).toMatch(/\$900\.00 · 4,197 unpriced/);
});

test("LIVE: the real database classifies both populations correctly", async () => {
	// Skipped unless a database is present, so this never fails in CI.
	if (!(await hasDb())) return;
	await initDb();
	const dashboard = await fetchModelDashboard("all");
	const byId = new Map(dashboard.byModel.map(m => [m.model, m]));

	// No card ⇒ unknown spend ⇒ N/A. These are the 4,359 requests.
	expect(byId.get("gemini-3.7-flash-high")?.unpricedRequests ?? 0).toBeGreaterThan(0);
	expect(byId.get("agnes-2.5-flash")?.unpricedRequests ?? 0).toBeGreaterThan(0);

	// Explicit zero card ⇒ really free ⇒ stays $0, no unpriced marker.
	for (const free of ["space-bunny-free", "big-pickle", "muse-spark-1.3-contributor-free"]) {
		expect(byId.get(free)?.unpricedRequests ?? -1, free).toBe(0);
	}

	const overview = await fetchOverview("all");
	expect(overview.overall.unpricedRequests).toBeGreaterThanOrEqual(4197);
});


/**
 * The live database's real shape: FIVE zero-cost models with more requests than
 * the no-card one. A restore list capped at 3 and ranked by request count alone
 * pushes the unknown-spend model off the panel entirely — and makes the
 * "+N more at $0, none of them spend money" note false, because folded models
 * are no longer all free.
 */
const crowdedPayload: PanelData = {
	...payload,
	modelDashboard: {
		byModel: [
			model("gpt-5.6-sol", 900, 0, 20_000),
			model("space-bunny-free", 0, 0, 36_496),
			model("muse-spark-1.2-contributor-free", 0, 0, 7_212),
			model("muse-spark-1.3-contributor-free", 0, 0, 6_213),
			model("deepseek-v4-flash-free", 0, 0, 4_263),
			// Fewer requests than every free model above it, but its spend is UNKNOWN.
			model("gemini-3.7-flash-high", 0, 4197, 4_205),
			model("agnes-2.5-flash", 0, 162, 162),
		],
		modelSeries: [],
		modelPerformanceSeries: [],
	},
} as PanelData;

test("an unknown-spend model outranks free ones when the restore list is capped", () => {
	// Ranking by request count alone put gemini fifth and dropped it. Unknown
	// spend is the row the user most needs, so it ranks first.
	const rows = overviewScreen.render(ctx(crowdedPayload)).join("\n");
	expect(rows, "the no-card model must survive a capped list").toContain("gemini-3.7-flash-high");
	expect(rows).toContain("N/A");
});

test("the folded-more note counts unpriced models instead of claiming all are free", () => {
	// Needs FOUR unpriced models, so that one is actually folded. Unpriced ranks
	// first now, so a folded unpriced model can only happen past the cap.
	const many: PanelData = {
		...crowdedPayload,
		modelDashboard: {
			byModel: [
				model("gpt-5.6-sol", 900, 0, 20_000),
				model("no-card-a", 0, 4000, 4000),
				model("no-card-b", 0, 3000, 3000),
				model("no-card-c", 0, 2000, 2000),
				model("no-card-d", 0, 1000, 1000),
				model("space-bunny-free", 0, 0, 36_496),
			],
			modelSeries: [],
			modelPerformanceSeries: [],
		},
	} as PanelData;
	const rows = overviewScreen.render(ctx(many)).join("\n");
	expect(rows).toMatch(/\+ \d+ more at \$0, [\d,]+ of them unpriced/);
	expect(rows).not.toMatch(/none of them spend money/);
});
/** True when a real stats database is present; keeps this out of CI. */
async function hasDb(): Promise<boolean> {
	return (await Bun.file(`${process.env.HOME}/.omp/stats.db`).size) > 0;
}
