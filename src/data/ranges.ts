/**
 * The range vocabulary.
 *
 * The valid set is closed and data-driven on purpose. The host's
 * `getTimeRangeConfig` resolves an unrecognised range to its 24h default rather
 * than erroring, so any free-form range input is a silent lie: a picker offering
 * "365 days" renders 24 hours of data and says nothing. `isRange` is the only
 * way a range reaches this layer, and every caller in the codebase goes through
 * it, so an unknown key cannot get in.
 *
 * The closed-set members (RANGES, isRange, nextRange, DEFAULT_RANGE) are OURS:
 * the host exports TIME_RANGES but no guard and no cycling helper, and the
 * validation is the entire point of this module. The RANGE METADATA is the
 * host's, imported rather than restated — see `bucketCountForRange` below for
 * why that distinction matters.
 */
import { rangeMeta } from "@oh-my-pi/omp-stats/client/data/range";

export const RANGES = ["1h", "24h", "7d", "30d", "90d", "all"] as const;

export type Range = (typeof RANGES)[number];

export const DEFAULT_RANGE: Range = "24h";

/**
 * How many buckets the HOST would produce for a range, before any width clamp.
 *
 * This used to be a hand-written `NATURAL_BUCKETS` table copied from the host's
 * `RANGE_META`, and it drifted: the copy claimed `all` was 53 weekly buckets
 * while the host buckets `all` by DAY. A restated copy of a host-owned table is
 * precisely the kind of duplication that rots silently — nothing fails, the
 * chart just resamples at the wrong width. So the numbers are DERIVED from
 * `rangeMeta` instead, and `test/ranges.test.ts` pins the agreement rather than
 * pinning a literal.
 *
 * `all` has `spanMs === null` — no span, therefore no natural count — so the
 * caller gets the width back. Inventing a number there is what the old table
 * did, and it was wrong.
 */
export function bucketCountForRange(range: Range, width: number): number {
	const { spanMs, bucketMs } = rangeMeta(range);
	if (spanMs === null) return Math.max(1, Math.floor(width));
	return Math.round(spanMs / bucketMs);
}

/** Bucket width in ms, straight from the host. Charts that build their own axis need it. */
export function bucketMsFor(range: Range): number {
	return rangeMeta(range).bucketMs;
}


/**
 * Type guard for the closed set. Deliberately strict: no trimming and no case
 * folding, because both would make the panel's idea of a range differ from the
 * host's. Rejecting is always safe here — the caller falls back to
 * DEFAULT_RANGE knowingly.
 */
export function isRange(value: string): value is Range {
	return typeof value === "string" && (RANGES as readonly string[]).includes(value);
}

/** Step through the list, wrapping at both ends. */
export function nextRange(current: Range, direction: 1 | -1): Range {
	const i = RANGES.indexOf(current);
	return RANGES[(i + direction + RANGES.length) % RANGES.length] as Range;
}

/** How a range reads in a heading or a filter label, not as its wire key. */
const RANGE_LABELS: Record<Range, string> = {
	"1h": "1 hour",
	"24h": "24 hours",
	"7d": "7 days",
	"30d": "30 days",
	"90d": "90 days",
	all: "All time",
};

export function rangeLabel(range: Range): string {
	return RANGE_LABELS[range];
}

/**
 * How many buckets to actually draw: the host's natural count for the range,
 * clamped to never exceed the available columns. Clamping rather than
 * downsampling-by-decimation is what keeps a narrow terminal showing the same
 * window at coarser buckets instead of a truncated series.
 */
export function bucketCountFor(range: Range, width: number): number {
	return Math.max(1, Math.min(bucketCountForRange(range, width), Math.max(1, Math.floor(width))));
}