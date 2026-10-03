import { expect, test } from "bun:test";
import type { AggregatedStats } from "@oh-my-pi/omp-stats/shared-types";
import {
	cacheShare,
	cacheSavingsNote,
	compactTokens,
	costWithUnpriced,
	exactTokens,
	formatCost,
	formatElapsed,
	formatInteger,
	tokenCells,
} from "../src/tui/format";

/**
 * The shapes below are the real magnitudes from this machine's stats.db
 * (see `bun run scripts/probe-data.ts`): 95.47% cache-read, one model at
 * 4.30B cache-read tokens across 34,973 requests, 34,870 of them unpriced.
 * A formatter that is only ever tested on tidy numbers passes the tidy suite
 * and then lies about the actual data.
 */

test("a zero cost with unpriced requests is unknown-spend, never a free $0", () => {
	expect(formatCost(0)).toBe("$0");
	// The whole total is unpriced, so "N/A" alone already says it — but the
	// count is what tells the reader HOW MUCH is unmeasured, so it stays.
	expect(costWithUnpriced(0, 12)).toBe("N/A · 12 unpriced");
	expect(costWithUnpriced(0, 0)).toBe("$0");
	expect(costWithUnpriced(2582.33, 0)).toBe("$2,582.33");
	expect(costWithUnpriced(611.4, 3)).toBe("$611.40 · 3 unpriced");
});

test("a large unpriced count beside a real cost still reads as a floor, not a total", () => {
	// 34,870 unpriced requests against a real number: the figure is the money
	// actually recorded, and the panel must not present it as the whole bill.
	expect(costWithUnpriced(22.85, 34_870)).toBe("$22.85 · 34,870 unpriced");
});

test("cost adapts below one cent, at exactly zero, and above a dollar", () => {
	expect(formatCost(0.0000646324)).toBe("$0.0001");
	expect(formatCost(0.023)).toBe("$0.02");
	expect(formatCost(1292.85)).toBe("$1,292.85");
});

test("tokens are split four ways and never summed into one figure", () => {
	const cells = tokenCells({
		totalInputTokens: 115_284_971,
		totalOutputTokens: 64_071,
		totalCacheReadTokens: 23_208_537_877,
		totalCacheWriteTokens: 0,
		cacheRate: 0.9513,
	});
	expect(cells.fresh).toBe("115M");
	expect(cells.cacheRead).toBe("23B");
	expect(cells.cacheWrite).toBe("0");
	expect(cells.rate).toBe("95.1% cache");
	// The regression this assertion exists to prevent: a panel that collapses
	// the four cells back into one "24B tokens" figure.
	expect(Object.values(cells)).not.toContain("24B");
	expect(Object.keys(cells).sort()).toEqual(["cacheRead", "cacheWrite", "fresh", "rate"]);
});

test("a zero-token aggregate does not divide by zero", () => {
	const cells = tokenCells({
		totalInputTokens: 0,
		totalOutputTokens: 0,
		totalCacheReadTokens: 0,
		totalCacheWriteTokens: 0,
		cacheRate: 0,
	});
	expect(cells.rate).toBe("0.0% cache");
	expect(cells.fresh).toBe("0");
});

test("the cache rate excludes cache WRITES, so heavy writes still read low", () => {
	// 10M fresh, 20M cache-read, 500M cache-write. The rate is 20/(10+20) =
	// 66.7%, NOT something that accounts for the half-billion tokens written.
	// The denominator rule (CONTEXT.md: "Cache rate") is pinned twice: once on
	// the raw helper, and once through tokenCells, where bumping the writes by
	// 250x must leave the rate untouched. If writes ever entered the
	// denominator, that second assertion fails.
	expect(cacheShare(10_000_000, 20_000_000)).toBeCloseTo(2 / 3, 6);
	const withFewWrites = tokenCells({
		totalInputTokens: 10_000_000,
		totalOutputTokens: 0,
		totalCacheReadTokens: 20_000_000,
		totalCacheWriteTokens: 2_000_000,
		cacheRate: cacheShare(10_000_000, 20_000_000),
	});
	const withHugeWrites = tokenCells({
		totalInputTokens: 10_000_000,
		totalOutputTokens: 0,
		totalCacheReadTokens: 20_000_000,
		totalCacheWriteTokens: 500_000_000,
		cacheRate: cacheShare(10_000_000, 20_000_000),
	});
	expect(withFewWrites.rate).toBe(withHugeWrites.rate);
	expect(withFewWrites.rate).toBe("66.7% cache");
	// The writes are still VISIBLE — excluded from the rate, never hidden.
	expect(withFewWrites.cacheWrite).toBe("2M");
	expect(withHugeWrites.cacheWrite).toBe("500M");

	expect(cacheShare(0, 0)).toBe(0);
	expect(cacheShare(0, 5)).toBe(1);
});

test("cache savings render correctly when negative", () => {
	// Negative means cache writes cost more than the reads save. Hiding the sign
	// would turn a real loss into an apparent gain.
	expect(cacheSavingsNote(0.42)).toBe("cache saves 42.0% vs billing the same input uncached");
	expect(cacheSavingsNote(-0.13)).toBe("cache costs 13.0% MORE than billing the same input uncached");
	expect(cacheSavingsNote(0)).toBe("cache savings 0.0%");
	expect(cacheSavingsNote(null)).toBe("-");
});

test("elapsed crosses into minutes and hours, formatDurationMs alone does not", () => {
	expect(formatElapsed(8)).toBe("0.01s");
	expect(formatElapsed(4515)).toBe("4.5s");
	expect(formatElapsed(303_702)).toBe("5m 03s");
	expect(formatElapsed(1_582_747)).toBe("26m 22s");
	expect(formatElapsed(7_200_000)).toBe("2h 00m");
});

test("duration boundaries are asserted exactly, warts included", () => {
	expect(formatElapsed(999)).toBe("1.00s"); // rounds up inside the sub-second band
	expect(formatElapsed(1000)).toBe("1.0s");
	// 59.999 s renders as "60.0s" — correct arithmetic, slightly odd to read.
	// Pinned so a future change to the threshold is a deliberate act.
	expect(formatElapsed(59_999)).toBe("60.0s");
	expect(formatElapsed(60_000)).toBe("1m 00s");
	expect(formatElapsed(1_582_747)).toBe("26m 22s");
	expect(formatElapsed(0)).toBe("0.00s");
});

test("compact tokens at the real magnitudes of this database", () => {
	expect(compactTokens(4_300_000_000)).toBe("4.3B");
	expect(compactTokens(23_208_537_877)).toBe("23B");
	expect(compactTokens(115_284_971)).toBe("115M");
	expect(compactTokens(1_270_000)).toBe("1.3M");
	expect(compactTokens(999)).toBe("999");
	expect(compactTokens(0)).toBe("0");
});

test("exact tokens are available for detail rows, where credibility beats width", () => {
	// The judgement call: an axis label wants `23B`; a detail row wants the real
	// number, because 24,395,481,379 is what makes a figure checkable. Both are
	// offered, and neither is a SUM — the caller picks a bucket.
	expect(exactTokens(23_208_537_877)).toBe("23,208,537,877");
	expect(exactTokens(115_284_971)).toBe("115,284,971");
	expect(exactTokens(0)).toBe("0");
	expect(formatInteger(34_870)).toBe("34,870");
});

test("an aggregate type with the real field names satisfies the tokenCells input", () => {
	const agg: AggregatedStats = {
		totalRequests: 1,
		successfulRequests: 1,
		failedRequests: 0,
		errorRate: 0,
		totalInputTokens: 1,
		totalOutputTokens: 1,
		totalCacheReadTokens: 1,
		totalCacheWriteTokens: 0,
		cacheRate: 0.5,
		cacheSavings: 0,
		totalCost: 0,
		unpricedRequests: 0,
		totalPremiumRequests: 0,
		avgDuration: null,
		avgTtft: null,
		avgTokensPerSecond: null,
		firstTimestamp: 0,
		lastTimestamp: 1,
	};
	expect(tokenCells(agg).rate).toBe("50.0% cache");
});
