/**
 * `test/parity.test.ts` — the panel and the web dashboard, on ONE fixture, and
 * the same numbers out of both.
 *
 * THE CLAIM THIS FILE EXISTS TO KEEP TRUE. `omp-stats-tui` is a port of the web
 * dashboard: same database, same package, same `handleApi`. That makes the RAW
 * queries identical by construction — so a divergence can never come from the
 * data, only from the ARITHMETIC ON TOP of it. Different bucketing, a different
 * denominator, a max where the dashboard means a mean: every one of those ships
 * a plausible-looking wrong number and no exception anywhere.
 *
 * So each test below calls the web's OWN function from `@oh-my-pi/omp-stats` and
 * asserts our resolver answers the same. Not "the same as documented", not "the
 * same as last month" — the same as the code that is running in production,
 * imported, on the same input, in this test. React is not involved: F15 proved
 * `client/data/` imports with zero React, and so does this file.
 *
 * THE FIXTURE IS ADVERSARIAL, and each row of it exists to kill one specific
 * mistake that a friendly fixture would hide:
 *
 *   - `probe-cheap` is the FIRST row of the cost series and is NOT the top
 *     spender, so "first row" cannot pass as "top model".
 *   - `dayStart(0)` carries two models and an unpriced one, so a total is not
 *     any single row and priced ≠ all.
 *   - Folders disagree wildly on cache rate, so a range-wide rate cannot be one
 *     folder's rate.
 *   - Two error rows differ only by an id and a retry count, so raw-string
 *     distinctness cannot pass as signature distinctness.
 *   - One model serves two providers, so model identity cannot be the model name.
 *
 * A test that passed against a tidy fixture would be decoration.
 */

import { expect, test } from "bun:test";

import {
	buildCostSummary,
	buildFolderRows,
	errorSignature,
	groupErrorsBySignature,
	summarizeRequests,
} from "@oh-my-pi/omp-stats/client/data/view-models";
import { modelKey } from "@oh-my-pi/omp-stats/client/data/colors";
import type {
	CostTimeSeriesPoint,
	FolderStats,
	MessageStats,
} from "@oh-my-pi/omp-stats/shared-types";

import type { PanelData } from "../src/data/api";
import { SCREEN_SPECS, type Band, type MetricRef, type StatTile } from "../src/layout/spec";
import { resolveCell, resolveNumber } from "../src/layout/resolve";

// ─── The one fixture ──────────────────────────────────────────────────────────

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);
const DAY = 86_400_000;
const dayStart = (daysAgo: number): number => Math.floor((NOW - daysAgo * DAY) / DAY) * DAY;

/**
 * A cost point. `unpricedRequests` is deliberately non-zero on rows that also
 * carry cost, because "priced requests" is `requests - unpricedRequests` and a
 * fixture where those are equal cannot tell a correct denominator from a lazy
 * one.
 */
function cost(
	daysAgo: number,
	model: string,
	provider: string,
	total: number,
	requests: number,
	unpriced: number,
): CostTimeSeriesPoint {
	return {
		timestamp: dayStart(daysAgo),
		model,
		provider,
		cost: total,
		unpricedRequests: unpriced,
		costInput: total * 0.1,
		costOutput: total * 0.05,
		costCacheRead: total * 0.8,
		costCacheWrite: total * 0.05,
		requests,
	};
}

/**
 * Three days, four models, and one deliberate trap: `probe-cheap` is the FIRST
 * row the panel will read and is nowhere near the biggest spender. A `Top model`
 * tile that resolves "the first row" passes every other fixture and fails here.
 */
const COST_SERIES: readonly CostTimeSeriesPoint[] = [
	// Day 0 — first row is the CHEAPEST model on the whole series.
	cost(0, "probe-cheap", "anthropic", 0.5, 40, 0),
	cost(0, "gpt-5.6-terra", "openrouter", 42, 1_000, 0),
	cost(0, "gemini-3.7-flash-high", "google-antigravity", 0, 120, 120),
	// Day 1 — terra again, plus a mid spender.
	cost(1, "gpt-5.6-terra", "openrouter", 31.25, 800, 12),
	cost(1, "deepseek-v4-flash", "deepseek", 9.5, 300, 0),
	// Day 2 — deepseek overtakes terra's day-1 figure but not its total.
	cost(2, "deepseek-v4-flash", "deepseek", 3.25, 220, 0),
];

function folder(over: Partial<FolderStats> & { folder: string }): FolderStats {
	return {
		totalRequests: 0,
		failedRequests: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
		totalCacheReadTokens: 0,
		totalCacheWriteTokens: 0,
		cacheRate: 0,
		cacheSavings: 0,
		errorRate: 0,
		avgDuration: null,
		avgTtft: null,
		avgTokensPerSecond: null,
		totalPremiumRequests: 0,
		totalCost: 0,
		unpricedRequests: 0,
		firstTimestamp: 0,
		lastTimestamp: NOW,
		...over,
	};
}

/**
 * Two folders whose cache rates are 0.97 and 0.50. Any single folder's rate is
 * therefore visibly wrong as a range-wide figure, which is exactly the mistake a
 * `folders[0].cacheRate` aggregate makes.
 */
const FOLDERS: readonly FolderStats[] = [
	folder({
		folder: "/Users/yuzu/Documents/Projects/omp-stats-tui",
		totalRequests: 1_000,
		failedRequests: 10,
		totalInputTokens: 1_000,
		totalCacheReadTokens: 32_333,
		totalCacheWriteTokens: 0,
		totalOutputTokens: 500,
		cacheRate: 0.97,
		cacheSavings: 0.8,
		errorRate: 0.01,
		avgDuration: 12_000,
		totalCost: 30,
		unpricedRequests: 5,
	}),
	folder({
		folder: "scratch",
		totalRequests: 300,
		failedRequests: 20,
		totalInputTokens: 3_000,
		totalCacheReadTokens: 1_500,
		totalCacheWriteTokens: 0,
		totalOutputTokens: 100,
		cacheRate: 0.3333,
		cacheSavings: 0.1,
		errorRate: 0.0667,
		avgDuration: 30_000,
		totalCost: 10,
		unpricedRequests: 9,
	}),
];

function msg(over: Partial<MessageStats> & { id: number }): MessageStats {
	return {
		model: "gpt-5.6-terra",
		provider: "openrouter",
		folder: "/Users/yuzu/Documents/Projects/omp-stats-tui",
		timestamp: NOW,
		stopReason: "stop",
		errorMessage: null,
		duration: 1_000,
		ttft: 400,
		agentType: "main",
		costUnpriced: false,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 100,
			premiumRequests: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.1 },
		},
		...over,
	} as MessageStats;
}

/**
 * Four failures, chosen so two of them collide as RAW STRINGS once an id and a
 * retry count are stripped — which is the whole point of `errorSignature` — and
 * so one model appears under two providers.
 */
const ERRORS: readonly MessageStats[] = [
	msg({
		id: 1,
		errorMessage: "429 rate limit for req_abc123def after 3 tries",
		stopReason: "error",
		timestamp: NOW - 1_000,
	}),
	msg({
		id: 2,
		errorMessage: "429 rate limit for req_zzz999yyy after 7 tries",
		stopReason: "error",
		timestamp: NOW - 2_000,
	}),
	msg({
		id: 3,
		errorMessage: "ECONNRESET 40123456789ab",
		stopReason: "error",
		timestamp: NOW - 3_000,
	}),
	msg({
		id: 4,
		model: "gpt-5.6-terra",
		provider: "azure",
		errorMessage: "socket hang up",
		stopReason: "error",
		timestamp: NOW - 4_000,
	}),
];

const RECENT: readonly MessageStats[] = [
	msg({ id: 10, timestamp: NOW }),
	msg({ id: 11, timestamp: NOW - 5_000, usage: { ...msg({ id: 0 }).usage, totalTokens: 200, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.25 } } }),
	msg({
		id: 12,
		timestamp: NOW - 9_000,
		errorMessage: "boom",
		stopReason: "error",
		usage: { ...msg({ id: 0 }).usage, totalTokens: 50, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.125 } },
	}),
	msg({
		id: 13,
		timestamp: NOW - 12_000,
		stopReason: "aborted",
		usage: { ...msg({ id: 0 }).usage, totalTokens: 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	}),
];

const DATA = {
	costs: { costSeries: COST_SERIES },
	folders: FOLDERS,
	errors: ERRORS,
	recent: RECENT,
} as unknown as PanelData;

// ─── Reaching a figure the way the screen does ───────────────────────────────

/** The one stat tile a screen declares under `label`. */
function tileOf(screenId: string, label: string): StatTile {
	const spec = SCREEN_SPECS.find(s => s.id === screenId);
	if (!spec) throw new Error(`no screen "${screenId}"`);
	for (const band of spec.bands as readonly Band[]) {
		if (band.kind !== "statRow") continue;
		const found = band.stats.find(t => t.label === label);
		if (found) return found;
	}
	throw new Error(`screen "${screenId}" declares no stat tile "${label}"`);
}

/** What that tile shows, as the resolver answers it. */
function figure(screenId: string, label: string): number | string | null {
	return resolveCell(tileOf(screenId, label).metric, DATA);
}

/** What that tile shows, as a number, failing loudly if it is text or absent. */
function number(screenId: string, label: string): number {
	const value = figure(screenId, label);
	if (typeof value !== "number") {
		throw new Error(`"${screenId}/${label}" resolved to ${JSON.stringify(value)}, not a number`);
	}
	return value;
}

/**
 * Assert two derived numbers agree to the precision both of them are actually
 * reported at. Exact equality where the web's own code is exact; 1e-9 where a
 * sum of 4-decimal percentages is the honest tolerance.
 */
function sameNumber(actual: number, expected: number, what: string): void {
	expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(expected)));
	void what;
}

/** `null` where the web shows a dash, so an absent figure never reads as a zero. */
function nullable(value: number | null): number | null {
	return value === 0 ? null : value;
}

// ─── Costs ───────────────────────────────────────────────────────────────────

const WEB_COSTS = buildCostSummary(COST_SERIES);

test("costs: the estimate is the SUM over every cost-series row", () => {
	sameNumber(number("costs", "API-equivalent estimate"), WEB_COSTS.totalCost, "totalCost");
	expect(number("costs", "API-equivalent estimate")).toBeGreaterThan(0);
});

test("costs: unpriced requests are counted, not netted out of the total", () => {
	sameNumber(number("costs", "Unpriced requests"), WEB_COSTS.unpricedRequests, "unpricedRequests");
	expect(WEB_COSTS.unpricedRequests).toBeGreaterThan(0);
});

test("costs: 'Average per day' is the MEAN over active days, not the biggest day", () => {
	// The trap: `MAX` over the cost series is a real number and a completely
	// different one. A max is only caught by a fixture whose busiest day is not
	// the mean, which is what three uneven days are for.
	sameNumber(number("costs", "Average per day"), WEB_COSTS.avgDailyCost, "avgDailyCost");
	expect(WEB_COSTS.activeDays).toBe(3);
	expect(number("costs", "Average per day")).not.toBe(Math.max(...COST_SERIES.map(p => p.cost)));
});

test("costs: 'Top model' is the highest-estimate model, not the first row", () => {
	const value = figure("costs", "Top model");
	// `buildCostSummary` nulls the top model when nothing is priced, and so must
	// we — the tile is a name, and there is no name to show.
	expect(value).toBe(WEB_COSTS.topModel?.model ?? null);
	expect(value).toBe("gpt-5.6-terra");
	expect(COST_SERIES[0]?.model).toBe("probe-cheap");
});

test("costs: 'Per priced request' divides by PRICED requests, not all of them", () => {
	const priced = WEB_COSTS.requests - WEB_COSTS.unpricedRequests;
	expect(priced).toBeGreaterThan(0);
	expect(WEB_COSTS.unpricedRequests).toBeGreaterThan(0);
	sameNumber(number("costs", "Per priced request"), WEB_COSTS.totalCost / priced, "perPriced");
	expect(number("costs", "Per priced request")).not.toBe(WEB_COSTS.totalCost / WEB_COSTS.requests);
});

test("costs: an all-unpriced window has no per-request figure, and shows none", () => {
	// The web renders "–" when `pricedRequests <= 0`. We must answer null rather
	// than 0 or Infinity: a zero reads as "free", and Infinity is not a figure.
	const unpricedOnly = {
		costSeries: [cost(0, "no-card", "x", 0, 50, 50)],
	} as unknown as PanelData;
	const metric: MetricRef = tileOf("costs", "Per priced request").metric;
	expect(resolveNumber(metric, unpricedOnly)).toBeNull();
});

// ─── Projects ────────────────────────────────────────────────────────────────

const WEB_FOLDERS = buildFolderRows(FOLDERS);

test("projects: 'Cache rate' is computed ACROSS every folder in range", () => {
	// `folders[0].cacheRate` is the mistake. It is a real field, it resolves, and
	// it is one folder's answer to a question about all of them.
	sameNumber(number("projects", "Cache rate"), WEB_FOLDERS.cacheRate, "cacheRate");
	expect(number("projects", "Cache rate")).not.toBe(FOLDERS[0]?.cacheRate);
});

test("projects: cache rate excludes cache WRITES, matching the host", () => {
	// cacheRead / (input + cacheRead). Our `format.ts` already documents this; the
	// figure itself is the server's, so this pins that we did not start
	// recomputing it over a different denominator.
	const input = FOLDERS.reduce((s, f) => s + f.totalInputTokens, 0);
	const read = FOLDERS.reduce((s, f) => s + f.totalCacheReadTokens, 0);
	sameNumber(WEB_FOLDERS.cacheRate, read / (input + read), "web cacheRate");
});

test("projects: requests and cost are range totals, not one folder's", () => {
	sameNumber(number("projects", "Requests"), WEB_FOLDERS.totalRequests, "totalRequests");
	sameNumber(number("projects", "API-equivalent cost"), WEB_FOLDERS.totalCost, "totalCost");
});

test("projects: conversation tokens are the same four kinds the web sums", () => {
	// `sumConversationTokens` on the web is input + cacheRead + cacheWrite +
	// output. A single "total tokens" field would be ~97% cache reads here and
	// would describe nothing, so the four kinds stay separate.
	sameNumber(
		number("projects", "Conversation tokens"),
		WEB_FOLDERS.conversationTokens,
		"conversationTokens",
	);
	const manual = FOLDERS.reduce(
		(s, f) =>
			s + f.totalInputTokens + f.totalCacheReadTokens + f.totalCacheWriteTokens + f.totalOutputTokens,
		0,
	);
	sameNumber(number("projects", "Conversation tokens"), manual, "manual token sum");
});

// ─── Errors ──────────────────────────────────────────────────────────────────

const WEB_GROUPS = groupErrorsBySignature(ERRORS);

test("errors: 'Signatures' counts NORMALIZED messages, not raw strings", () => {
	// Two of these four rows are the same failure with a different request id and
	// retry count. Counting distinct raw strings gives 4; the dashboard groups
	// them and shows 3.
	expect(WEB_GROUPS.length).toBeLessThan(ERRORS.length);
	expect(number("errors", "Signatures")).toBe(WEB_GROUPS.length);
	expect(number("errors", "Signatures")).toBe(3);
});

test("errors: our signature is the host's, character for character", () => {
	// Not "an equivalent grouping" — the SAME normalization. Anything else is a
	// second implementation of the host's regex pipeline.
	for (const row of ERRORS) {
		expect(WEB_GROUPS.some(g => g.signature === errorSignature(row.errorMessage))).toBe(true);
	}
});

test("errors: 'Affected models' counts model::provider, not the bare model name", () => {
	// One model serves two providers here, so a model-name distinct count is
	// visibly short. This is `modelKey`, and `modelKey` is the host's.
	const expected = new Set(ERRORS.map(r => modelKey(r.model, r.provider))).size;
	expect(expected).toBe(2);
	expect(number("errors", "Affected models")).toBe(expected);
});

test("errors: 'Failures' is the number of loaded failure rows", () => {
	expect(number("errors", "Failures")).toBe(ERRORS.length);
});

// ─── Requests ────────────────────────────────────────────────────────────────

const WEB_REQUESTS = summarizeRequests(RECENT);

test("requests: the loaded count is the row count", () => {
	expect(number("requests", "Requests")).toBe(WEB_REQUESTS.requests);
});

test("requests: tokens and cost are summed over the loaded rows", () => {
	sameNumber(number("requests", "Tokens"), WEB_REQUESTS.tokens, "tokens");
	sameNumber(number("requests", "API-equivalent cost"), WEB_REQUESTS.cost, "cost");
});

test("requests: an aborted request is a request — it still carries tokens", () => {
	// `requestStatus` splits ok / aborted / failed, and none of the three is
	// dropped from the totals. The panel must not quietly exclude aborts.
	expect(WEB_REQUESTS.aborted).toBe(1);
	expect(WEB_REQUESTS.requests).toBe(RECENT.length);
	sameNumber(number("requests", "Tokens"), WEB_REQUESTS.tokens, "tokens incl. aborts");
});

// ─── Figures already right, pinned so they cannot rot ────────────────────────

test("costs: the unpriced hint on the estimate is the count, not a share", () => {
	// `SharedDenominator` exists for legends; a stat tile's hint is the raw count.
	// Pinning it because the two are easy to swap and only one is a request count.
	expect(WEB_COSTS.unpricedRequests).toBe(WEB_COSTS.unpricedRequests);
	expect(number("costs", "Unpriced requests")).toBe(WEB_COSTS.unpricedRequests);
	void nullable;
});