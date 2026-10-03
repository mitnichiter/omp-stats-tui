/**
 * Number and time vocabulary.
 *
 * This module owns every number the panel is allowed to say, because three of
 * the rules here exist to stop the panel from stating something true but
 * useless, or false, about money. They are load-bearing:
 *
 *  1. **Tokens are never one figure.** This database is 95.5% cache-read by
 *     token; a single "24B tokens" line is arithmetically true and tells the
 *     reader nothing about what they spent. `tokenCells` returns four separate
 *     cells and there is deliberately no exported function that sums them.
 *
 *  2. **A zero cost is not a free cost.** An unpriced request is one whose
 *     price could not be determined. `costWithUnpriced` marks it, because a
 *     `$0.00` sitting next to a real number reads as a bargain or a bug, when
 *     it is in fact money nobody has measured yet.
 *
 *  3. **The cache rate excludes cache writes.** `cacheShare` divides
 *     cache-read by (fresh + cache-read) and nothing else — matching the
 *     package's own `cacheRate`. A write is an investment in future reads, not
 *     a hit, so counting it would inflate the rate; but a panel that shows only
 *     the rate also understates what the writes cost. Hence the separate
 *     cache-write cell.
 *
 * Pure: no I/O, no theme, no database. Every function here is trivially
 * testable, which is why they live behind a module instead of inline in a
 * render function.
 *
 * The number primitives are PORTED, not imported. They come from
 * `@oh-my-pi/omp-stats/src/client/data/formatters.ts`, which the stats
 * dashboard uses for exactly these fields and which was written against this
 * same data. Importing it directly is not an option: that path sits outside the
 * package's public barrel and drags React into a terminal process. The port
 * keeps the host's conventions — the `en-US` locale, the sub-cent digit rule,
 * the 60-second elapsed switch — so the panel and the dashboard never disagree
 * about what the same number looks like.
 */

/**
 * Every number on the panel uses one fixed locale, exactly as the dashboard
 * does: labels, percents, durations and dates are English, so following the
 * browser locale would mix conventions (`1,4 Mr` beside `97.0%`).
 */
const NUMBER_LOCALE = "en-US";

export function formatInteger(value: number): string {
	return value.toLocaleString(NUMBER_LOCALE);
}

/**
 * Compact notation for axis labels and chart cells. `4.3B` is readable where
 * `4,300,000,000` would wrap the row; `exactTokens` is for the detail rows
 * where the full figure is what makes the number credible.
 */
export function compactTokens(value: number): string {
	return value.toLocaleString(NUMBER_LOCALE, { notation: "compact" });
}

/** Full precision for detail rows, where credibility beats fitting the row. */
export function exactTokens(value: number): string {
	return formatInteger(value);
}

/**
 * A money figure. Sub-cent amounts get four digits rather than rounding to a
 * misleading `$0.00`; `0` renders as `$0` and is only ever reached through a
 * path that has already established the spend is genuinely zero (see
 * `costWithUnpriced`).
 */
export function formatCost(value: number, digits?: number): string {
	if (value === 0) return "$0";
	const fractionDigits = digits !== undefined ? digits : value > 0 && value < 0.01 ? 4 : 2;
	return `$${value.toLocaleString(NUMBER_LOCALE, {
		minimumFractionDigits: fractionDigits,
		maximumFractionDigits: fractionDigits,
	})}`;
}

/**
 * A cost plus what could not be priced.
 *
 * The rule, and the reason it is a single function rather than a convention:
 *
 * - `unpricedRequests > 0` and `cost === 0` → the entire total is unmeasured.
 *   `$0.00` would read as "this was free", which is a claim the data cannot
 *   support. `N/A` says the spend is unknown.
 * - `unpricedRequests > 0` with a non-zero cost → the figure is real but
 *   partial, so the count of unmeasured requests rides beside it. Without the
 *   suffix, `$22.85` for a model whose other 34,870 requests were unpriced
 *   reads as the whole bill.
 * - `unpricedRequests === 0` → the figure stands alone; a suffix here would be
 *   noise on almost every row in the panel.
 */
export function costWithUnpriced(cost: number, unpricedRequests: number, digits?: number): string {
	const base = cost === 0 && unpricedRequests > 0 ? "N/A" : formatCost(cost, digits);
	if (unpricedRequests === 0) return base;
	return `${base} · ${formatInteger(unpricedRequests)} unpriced`;
}

/**
 * The four token cells. `cacheRate` is passed through from the aggregate rather
 * than recomputed, so the panel shows the host's own number and cannot drift
 * from the dashboard; `cacheShare` is the pure form for callers holding raw
 * counts.
 */
export interface TokenCells {
	/** Input tokens billed at the full input price. */
	fresh: string;
	/** Input tokens the cache supplied. */
	cacheRead: string;
	/** Input tokens written into the cache — NOT a cache hit. */
	cacheWrite: string;
	/** The cache share, as a percentage string with its unit. */
	rate: string;
}

export interface TokenCounts {
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens: number;
	totalCacheWriteTokens: number;
	cacheRate: number;
}

export function tokenCells(counts: TokenCounts): TokenCells {
	return {
		fresh: compactTokens(counts.totalInputTokens),
		cacheRead: compactTokens(counts.totalCacheReadTokens),
		cacheWrite: compactTokens(counts.totalCacheWriteTokens),
		rate: `${formatPercent(counts.cacheRate)} cache`,
	};
}

/**
 * Cache-read tokens as a share of fresh + cache-read input tokens.
 *
 * CACHE WRITES ARE DELIBERATELY EXCLUDED from the denominator, matching the
 * package's `cacheRate` (CONTEXT.md: "Cache rate"). A write buys future reads;
 * counting it as a hit would report a rate the pricing does not support. The
 * cost of that choice is that a panel showing ONLY this number understates a
 * write-heavy month — which is why `tokenCells` renders cache writes as their
 * own cell rather than leaving them implicit here.
 *
 * Returns 0 for an empty aggregate rather than NaN.
 */
export function cacheShare(freshTokens: number, cacheReadTokens: number): number {
	const denominator = freshTokens + cacheReadTokens;
	return denominator > 0 ? cacheReadTokens / denominator : 0;
}

export function formatPercent(value: number, digits = 1): string {
	return `${(value * 100).toFixed(digits)}%`;
}

/**
 * Cache savings as a plain-language sentence.
 *
 * This is a dollar-savings RATIO, not a token count, and it goes in a footnote
 * — never in the token cells, where a reader would take it for a quantity of
 * tokens. It is negative when cache writes cost more than the reads save, and
 * the sign is what makes that readable: dropping it would turn a real loss into
 * an apparent gain.
 */
export function cacheSavingsNote(cacheSavings: number | null): string {
	if (cacheSavings === null) return "-";
	if (cacheSavings === 0) return "cache savings 0.0%";
	const percent = Math.abs(cacheSavings * 100).toFixed(1);
	return cacheSavings > 0
		? `cache saves ${percent}% vs billing the same input uncached`
		: `cache costs ${percent}% MORE than billing the same input uncached`;
}

/** Raw seconds with an adaptive precision — the sub-second band needs two digits. */
export function formatDurationMs(value: number | null, digits?: number): string {
	if (value === null) return "-";
	const sec = value / 1000;
	const d = digits !== undefined ? digits : sec < 1 ? 2 : 1;
	return `${sec.toFixed(d)}s`;
}

/**
 * Wall-clock length for a span that is not a per-request latency:
 * seconds below a minute, then `17m 41s` / `2h 05m`.
 *
 * The 60-second switch is the point. A single figure of 1,582.7 s for a 26
 * minute session is precise and unreadable; `26m 22s` is the shape a person
 * holds in their head.
 */
export function formatElapsed(ms: number): string {
	if (ms < 60_000) return formatDurationMs(ms);
	const totalMin = Math.floor(ms / 60_000);
	if (totalMin < 60) return `${totalMin}m ${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}s`;
	return `${Math.floor(totalMin / 60)}h ${String(totalMin % 60).padStart(2, "0")}m`;
}
