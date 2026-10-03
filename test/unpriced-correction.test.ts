import { test, expect } from "bun:test";
import { catalogPriceCard, noCatalogCardCounts, withHonestUnpriced } from "../src/data/api";

/**
 * THE DISCRIMINATOR, proved in BOTH directions.
 *
 * Two populations render as `$0` and mean opposite things:
 *
 *   - an EXPLICIT ZERO price card — `space-bunny-free`, `big-pickle`. The price
 *     was determined and it is zero. That is a real, free price and must stay `$0`.
 *   - NO card at all — `gemini-3.7-flash-high`, `agnes-2.5-flash`. There is no
 *     price. That is unknown spend and must read `N/A`.
 *
 * A test covering only the second direction would pass while the first silently
 * broke, marking every free-tier model unknown. Both directions are asserted.
 */

test("a model with an explicit all-zero card is PRICED, not unknown", () => {
	// The cards measured live in @oh-my-pi/pi-catalog on 2026-10-03.
	expect(catalogPriceCard("space-bunny-free")).toBe(true);
	expect(catalogPriceCard("big-pickle")).toBe(true);
	expect(catalogPriceCard("muse-spark-1.3-contributor-free")).toBe(true);
	expect(catalogPriceCard("muse-spark-1.2-contributor-free")).toBe(true);
	expect(catalogPriceCard("deepseek-v4-flash-free")).toBe(true);
	expect(catalogPriceCard("poolside/laguna-s-2.1:free")).toBe(true);
	expect(catalogPriceCard("x-preview-f-free")).toBe(true);
	expect(catalogPriceCard("longcat-2.0-free")).toBe(true);
	expect(catalogPriceCard("ox-alpha-free")).toBe(true);
	expect(catalogPriceCard("longcat-2.5-preview-free")).toBe(true);
	expect(catalogPriceCard("cline-free/muse-spark-1.3-contributor")).toBe(true);
});

test("a model with no card at all is NOT priced", () => {
	// The 4,359 requests behind these two are the whole bug.
	expect(catalogPriceCard("gemini-3.7-flash-high")).toBe(false);
	expect(catalogPriceCard("agnes-2.5-flash")).toBe(false);
});

test("a priced non-zero card is priced too", () => {
	expect(catalogPriceCard("gpt-5.6-terra")).toBe(true);
	expect(catalogPriceCard("deepseek-v4-flash")).toBe(true);
});

test("noCatalogCardCounts keeps only no-card models", () => {
	// The SQL side is injected, so this pins the FILTER and nothing else: rows
	// arrive already restricted to zero-cost-with-tokens, and the catalog decides.
	const rows = [
		{ model: "gemini-3.7-flash-high", requests: 4197 },
		{ model: "agnes-2.5-flash", requests: 162 },
		{ model: "space-bunny-free", requests: 36305 },
		{ model: "big-pickle", requests: 3087 },
	];
	expect(noCatalogCardCounts(rows)).toEqual(
		new Map([
			["gemini-3.7-flash-high", 4197],
			["agnes-2.5-flash", 162],
		]),
	);
});

test("noCatalogCardCounts is empty when every zero-cost model has a card", () => {
	// Direction one: a free-tier-only account has no unknown spend, so nothing
	// is added and every $0 stays $0.
	const rows = [
		{ model: "space-bunny-free", requests: 36305 },
		{ model: "big-pickle", requests: 3087 },
	];
	expect(noCatalogCardCounts(rows).size).toBe(0);
});

/** A minimal OverviewPayload-shaped object for the correction to act on. */
function payload(overrides: Record<string, unknown> = {}) {
	return {
		overall: { unpricedRequests: 0, totalCost: 0, totalRequests: 10 },
		byAgentType: [],
		timeSeries: [],
		...overrides,
	};
}

test("a no-card model raises the overall unpriced count", () => {
	const counts = new Map([["gemini-3.7-flash-high", 4197]]);
	const out = withHonestUnpriced(payload(), counts) as { overall: { unpricedRequests: number } };
	expect(out.overall.unpricedRequests).toBe(4197);
});

test("an explicit-zero-card model does NOT raise the unpriced count", () => {
	const counts = new Map<string, number>();
	const out = withHonestUnpriced(payload(), counts) as { overall: { unpricedRequests: number } };
	expect(out.overall.unpricedRequests).toBe(0);
});

test("the correction ADDS to the package's own count rather than replacing it", () => {
	// The package already counts xai-oauth and cost_unpriced rows. Replacing its
	// number would lose those; adding keeps both populations visible.
	const counts = new Map([["gemini-3.7-flash-high", 4197]]);
	const out = withHonestUnpriced(payload({ overall: { unpricedRequests: 25, totalCost: 0, totalRequests: 10 } }), counts) as {
		overall: { unpricedRequests: number };
	};
	expect(out.overall.unpricedRequests).toBe(4222);
});

test("byModel rows get their own corrected counts", () => {
	const counts = new Map([["gemini-3.7-flash-high", 4197]]);
	const input = {
		byModel: [
			{ model: "gemini-3.7-flash-high", provider: "openai", unpricedRequests: 0, totalCost: 0 },
			{ model: "space-bunny-free", provider: "opencode-zen", unpricedRequests: 0, totalCost: 0 },
		],
	};
	const out = withHonestUnpriced(input, counts) as { byModel: { model: string; unpricedRequests: number }[] };
	expect(out.byModel[0]!.unpricedRequests).toBe(4197);
	// Direction one, on a per-model basis: the free model stays at zero.
	expect(out.byModel[1]!.unpricedRequests).toBe(0);
});

test("the correction does not mutate its input", () => {
	const counts = new Map([["gemini-3.7-flash-high", 4197]]);
	const input = payload();
	withHonestUnpriced(input, counts);
	expect((input.overall as { unpricedRequests: number }).unpricedRequests).toBe(0);
});

test("a payload with no overall and no byModel is returned untouched", () => {
	const counts = new Map([["gemini-3.7-flash-high", 4197]]);
	const empty = {};
	expect(withHonestUnpriced(empty, counts)).toEqual(empty);
});