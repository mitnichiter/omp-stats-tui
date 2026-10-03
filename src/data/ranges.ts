/**
 * The range vocabulary.
 *
 * The valid set is closed and data-driven on purpose. The host's
 * `getTimeRangeConfig` resolves an unrecognised range to its 24h default rather
 * than erroring, so any free-form range input is a silent lie: a picker offering
 * "365 days" renders 24 hours of data and says nothing. `isRange` is the only
 * way a range reaches this layer, and every caller in the codebase goes through
 * it, so an unknown key cannot get in.
 */
export const RANGES = ["1h", "24h", "7d", "30d", "90d", "all"] as const;

export type Range = (typeof RANGES)[number];

export const DEFAULT_RANGE: Range = "24h";

/**
 * Natural bucket count per range — how many buckets the host's own TIME_RANGES
 * would produce before any width clamping. `1h` is 5-minute buckets (12),
 * everything else is hourly or daily, and `all` has no span at all so it is drawn
 * as weeks, the width of a calendar heatmap.
 *
 * Kept here rather than read from the host so a chart can size its level domain
 * synchronously, without a round trip, and so a drift is pinned by a test rather
 * than discovered as a mislabelled axis.
 */
export const NATURAL_BUCKETS: Record<Range, number> = {
	"1h": 12,
	"24h": 24,
	"7d": 7,
	"30d": 30,
	"90d": 90,
	all: 53,
};

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
 * How many buckets to actually draw: the range's natural count, never more than
 * there are columns. Clamping rather than downsampling-by-decimation is what
 * keeps a narrow terminal showing the same window with coarser buckets instead
 * of a truncated series.
 */
export function bucketCountFor(range: Range, width: number): number {
	return Math.max(1, Math.min(NATURAL_BUCKETS[range], Math.max(1, Math.floor(width))));
}