import { expect, test } from "bun:test";
import { ensureThemeSync, theme } from "@oh-my-pi/pi-tui/theme";
import type { GainDashboardStats, ProviderDashboardStats, ProviderWindowInsight, UsageWindowSeries } from "@oh-my-pi/omp-stats/shared-types";
import type { FeatureContext, FeatureReader } from "../src/tui/features/types";
import { createProvidersFeature } from "../src/tui/features/providers";
import { createGainFeature } from "../src/tui/features/gain";
import { accountNames, accountReadings, resolveWindow, savingsHistory, utilization } from "../src/tui/features/provider-gain-data";
import { stripForTest } from "../src/tui/palette";

ensureThemeSync();
const now = Date.UTC(2026, 9, 5, 12);
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
function context(api: FeatureReader["api"]): FeatureContext {
	return { reader: { api, fetch: async () => ({}) }, theme, changed() {}, copy: async () => {}, openTrace() {}, openScreen() {}, now: () => now };
}
function insight(provider: string, windowKey: string, consumed = 1): ProviderWindowInsight {
	return { provider, windowKey, windowLabel: windowKey, accounts: 1, cycles: 0, fractionConsumed: consumed, estTokensPerWindow: 100, peakConcurrentFraction: 0.5, idealAccounts: 1, exhaustedEvents: 0 };
}
function account(provider: string, key: string, fraction = 0.5): UsageWindowSeries {
	return { provider, accountKey: key, accountLabel: "shared@example", windowKey: "day", windowLabel: "Daily", points: [{ timestamp: now, usedFraction: fraction, exhausted: fraction >= 1 }] };
}
const local: ProviderDashboardStats = {
	providers: [{ provider: "local-only", totalRequests: 9, failedRequests: 1, models: 2, totalInputTokens: 100, totalOutputTokens: 500, totalCacheReadTokens: 0, totalCacheWriteTokens: 0, totalTokens: 600, totalCost: 2, unpricedRequests: 1, totalPremiumRequests: 0, avgTokensPerSecond: null }],
	hourly: [{ provider: "local-only", hour: 12, totalTokens: 600, outputTokens: 500, requests: 9 }],
	series: [],
};
function gain(project: string | null, savedTokens: number, projects = ["/a", "/ab"]): GainDashboardStats {
	const totals = { savedTokens, savedBytes: savedTokens * 4, hits: 1, outputBytes: 0, originalBytes: 0, reductionPercent: null };
	return { project, projects, overall: totals, bySource: { snapcompact: totals }, timeSeries: [{ date: "2026-10-05", snapcompact: savedTokens, total: savedTokens }] };
}

test("windows resolve by provider + limit identity, then same provider, then highest burn", () => {
	const rows = [insight("a", "day", 1), insight("b", "day", 9), insight("a", "week", 2)];
	expect(resolveWindow(rows, { provider: "a", windowKey: "week" })).toEqual({ provider: "a", windowKey: "week" });
	expect(resolveWindow(rows, { provider: "a", windowKey: "gone" })).toEqual({ provider: "a", windowKey: "day" });
	expect(resolveWindow(rows, { provider: "gone", windowKey: "day" })).toEqual({ provider: "b", windowKey: "day" });
	expect(resolveWindow([], null)).toBeNull();
});

test("duplicate account labels retain stable sorted-key identities across windows", () => {
	const a = account("a", "key-a"), b = account("a", "key-b");
	const secondWindow = { ...a, windowKey: "week" };
	expect([...accountNames([b, secondWindow, a])]).toEqual([["key-a", "shared@example #1"], ["key-b", "shared@example #2"]]);
});

test("account readings ignore missing fractions, reset jitter, and six-hour history gaps", () => {
	const a = account("a", "one");
	a.points = [
		{ timestamp: now - 8 * 3_600_000, usedFraction: 0.8, exhausted: false },
		{ timestamp: now - 7 * 3_600_000, usedFraction: 0.78, exhausted: false },
		{ timestamp: now, usedFraction: null, exhausted: true },
	];
	const reading = accountReadings(a);
	expect(reading.resets).toBe(0);
	expect(reading.peak).toBe(0.8);
	expect(reading.latest?.fraction).toBe(0.78);
	const chart = utilization([a]);
	expect(chart.rows[0].values.at(-1)).toBeNull();
	expect(chart.exhausted.at(-1)).toEqual(["one"]);
});

test("local provider load resolves and stays interactive while broker windows are pending or fail", async () => {
	const windows = deferred<never>();
	const controller = createProvidersFeature(context(async <T>(path: string) => (path.endsWith("/providers") ? local : await windows.promise) as T));
	await controller.load("24h");
	expect(stripForTest(controller.render(110, 30).join("\n"))).toContain("local-only");
	expect(controller.handleInput("v")).toBe(true);
	windows.reject(new Error("broker offline"));
	await Promise.resolve(); await Promise.resolve();
	const text = stripForTest(controller.render(110, 30).join("\n"));
	expect(text).toContain("broker offline");
	expect(text).toContain("600 tokens");
	expect(controller.handleInput("q")).toBe(false);
	controller.dispose();
});

test("late account response never replaces the selected provider or duplicate account identity", async () => {
	const a = deferred<{ windowInsights: ProviderWindowInsight[]; usageSeries: UsageWindowSeries[] }>();
	const b = deferred<{ windowInsights: ProviderWindowInsight[]; usageSeries: UsageWindowSeries[] }>();
	const windows = [insight("a", "day", 2), insight("b", "day", 1)];
	const controller = createProvidersFeature(context(async <T>(path: string, params?: Record<string, string>) => {
		if (path.endsWith("/providers")) return local as T;
		if (!params?.provider) return { windowInsights: windows, usageSeries: [] } as T;
		return await (params.provider === "a" ? a.promise : b.promise) as T;
	}));
	await controller.load("24h");
	controller.handleInput("v"); controller.handleInput("v"); controller.handleInput("v"); controller.handleInput("v");
	controller.handleInput("p");
	b.resolve({ windowInsights: windows, usageSeries: [account("b", "b-first", 0.9), account("b", "b-second", 0.3)] });
	await Promise.resolve(); await Promise.resolve();
	a.resolve({ windowInsights: windows, usageSeries: [account("a", "wrong-provider", 1)] });
	await Promise.resolve(); await Promise.resolve();
	const text = stripForTest(controller.render(130, 50).join("\n"));
	expect(text).toContain("Provider b");
	expect(text).toContain("shared@example #1");
	expect(text).toContain("shared@example #2");
	expect(text).not.toContain("wrong-provider");
	controller.dispose();
});

test("gain scopes totals and history through server project requests, never local prefix matches", async () => {
	const first = deferred<GainDashboardStats>(), second = deferred<GainDashboardStats>();
	const queries: (string | null)[] = [];
	const controller = createGainFeature(context(async <T>(_path: string, params?: Record<string, string>) => {
		const project = params?.project ?? null; queries.push(project);
		return (project === null ? gain(null, 900) : await (project === "/a" ? first.promise : second.promise)) as T;
	}));
	await controller.load("24h");
	controller.handleInput("p"); // /a
	controller.handleInput("p"); // /ab
	second.resolve(gain("/ab", 17));
	await Promise.resolve(); await Promise.resolve();
	first.resolve(gain("/a", 800));
	await Promise.resolve(); await Promise.resolve();
	controller.handleInput("v");
	const text = stripForTest(controller.render(120, 50).join("\n"));
	expect(queries).toEqual([null, "/a", "/ab"]);
	expect(text).toContain("Gain · 24h · /ab");
	expect(text).toContain("Saved tokens 17");
	expect(text).toContain("saved 17 · cumulative 17");
	expect(text).not.toContain("Saved tokens 800");
	controller.dispose();
});

test("gain remembers selected project outside current range and shows unknown reduction explicitly", async () => {
	let selectedLoads = 0;
	const controller = createGainFeature(context(async <T>(_path: string, params?: Record<string, string>) => {
		if (!params?.project) return gain(null, 2, ["/remember"]) as T;
		selectedLoads++;
		return gain(params.project, selectedLoads === 1 ? 2 : 0, []) as T;
	}));
	await controller.load("24h"); controller.handleInput("p");
	await Promise.resolve(); await Promise.resolve();
	await controller.load("1h");
	const text = stripForTest(controller.render(120, 40).join("\n"));
	expect(text).toContain("▶ /remember");
	expect(text).toContain("original size not recorded");
	controller.handleInput("P");
	await Promise.resolve(); await Promise.resolve();
	expect(stripForTest(controller.render(120, 40).join("\n"))).toContain("All projects");
	controller.dispose();
});

test("gain history densifies UTC days and cumulative starts at the scoped range", () => {
	const history = savingsHistory([{ date: "2026-10-03", snapcompact: 2 }, { date: "2026-10-05", snapcompact: 7 }], "7d", now);
	expect(history.daily.slice(-3)).toEqual([2, 0, 7]);
	expect(history.cumulative.slice(-3)).toEqual([2, 2, 9]);
});

test("disposed controllers ignore late reads without changed callbacks", async () => {
	const pending = deferred<GainDashboardStats>();
	let changes = 0;
	const ctx = context(async <T>() => await pending.promise as T); ctx.changed = () => { changes++; };
	const controller = createGainFeature(ctx);
	const loading = controller.load("7d");
	controller.dispose();
	const before = changes;
	pending.resolve(gain(null, 500));
	await loading;
	expect(changes).toBe(before);
	expect(stripForTest(controller.render(110, 30).join("\n"))).not.toContain("Saved tokens 500");
});

test("old-range window failure cannot replace the newest empty-snapshot state", async () => {
	const old = deferred<{ windowInsights: ProviderWindowInsight[]; usageSeries: UsageWindowSeries[] }>();
	const current = deferred<{ windowInsights: ProviderWindowInsight[]; usageSeries: UsageWindowSeries[] }>();
	const controller = createProvidersFeature(context(async <T>(path: string, params?: Record<string, string>) => {
		if (path.endsWith("/providers")) return local as T;
		return await (params?.range === "24h" ? old.promise : current.promise) as T;
	}));
	await controller.load("24h");
	await controller.load("1h");
	current.resolve({ windowInsights: [], usageSeries: [] });
	await Promise.resolve(); await Promise.resolve();
	old.reject(new Error("obsolete broker failure"));
	await Promise.resolve(); await Promise.resolve();
	controller.handleInput("v"); controller.handleInput("v"); controller.handleInput("v");
	const text = stripForTest(controller.render(120, 40).join("\n"));
	expect(text).toContain("No usage snapshots in this range");
	expect(text).not.toContain("obsolete broker failure");
	expect(controller.handleInput("\x1b[C")).toBe(false);
	controller.dispose();
});
